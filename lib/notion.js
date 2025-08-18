import { Client } from "@notionhq/client";

// Создание клиента для Edge Runtime
export const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

export const MATRIX_DB_ID = process.env.MATRIX_DB_ID;
export const EMPLOYEES_DB_ID = process.env.EMPLOYEES_DB_ID;

// Проверяем наличие обязательных переменных
function validateEnvironment() {
  const required = {
    NOTION_TOKEN: process.env.NOTION_TOKEN,
    MATRIX_DB_ID: process.env.MATRIX_DB_ID,
    EMPLOYEES_DB_ID: process.env.EMPLOYEES_DB_ID,
    JWT_SECRET: process.env.JWT_SECRET
  };
  
  const missing = Object.entries(required)
    .filter(([key, value]) => !value)
    .map(([key]) => key);
    
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
}

// Вызываем проверку при импорте
try {
  validateEnvironment();
} catch (error) {
  console.error('[ENV ERROR]', error.message);
}

export const PROP = {
  // БД "Оценки компетенций" (Matrix)
  employee: "Сотрудник",
  cycle: "Цикл",
  skill: "Навык",
  role: "Роль",
  skillDescription: "Описание навыка",
  
  // Поля оценивающих (People)
  selfScorer: "Self_scorer",
  p1Peer: "P1_peer",
  p2Peer: "P2_peer",
  managerScorer: "Manager_scorer",
  
  // Поля оценок (Number)
  selfScore: "Self_score",
  p1Score: "P1_score",
  p2Score: "P2_score",
  managerScore: "Manager_score",
  
  // Комментарии
  comment: "Комментарий",
  
  // БД "Сотрудники"
  team: "Команда",
  empAccount: "Учетка",
  empTitle: "Сотрудник",
};

export const ROLE_TO_FIELD = {
  self: "Self_score",
  p1_peer: "P1_score", 
  p2_peer: "P2_score",
  manager: "Manager_score",
  peer: "P1_score", // fallback для совместимости
};

export const ROLE_TO_SCORER_FIELD = {
  self: "Self_scorer",
  p1_peer: "P1_peer",
  p2_peer: "P2_peer", 
  manager: "Manager_scorer",
};

// Упрощенный Performance Tracker для Edge Runtime
export class PerformanceTracker {
  static operations = new Map();
  
  static start(operationName) {
    this.operations.set(operationName, Date.now());
    console.log(`[PERF] Started: ${operationName}`);
  }
  
  static end(operationName) {
    const startTime = this.operations.get(operationName);
    if (startTime) {
      const duration = Date.now() - startTime;
      this.operations.delete(operationName);
      console.log(`[PERF] Completed: ${operationName} in ${duration}ms`);
      return duration;
    }
    return 0;
  }
}

// Упрощенный cache для Edge Runtime
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 минут

function getCached(key) {
  const item = cache.get(key);
  if (item && Date.now() - item.timestamp < CACHE_TTL) {
    return item.data;
  }
  cache.delete(key);
  return null;
}

function setCached(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// СИСТЕМА КОНТРОЛЯ ЗАПРОСОВ для предотвращения "Too many subrequests"
let requestCount = 0;
const REQUEST_LIMIT = 80; // Лимит запросов для Cloudflare Edge Runtime
const RESET_INTERVAL = 60000; // Сброс счетчика каждую минуту

// ОПТИМИЗИРОВАННАЯ обертка для API вызовов с защитой от превышения лимитов
async function notionApiCall(apiCall, maxRetries = 2) {
  // Проверяем лимит запросов
  if (requestCount >= REQUEST_LIMIT) {
    console.warn('[RATE LIMIT] Request limit reached, rejecting request');
    throw new Error('Too many requests - rate limit exceeded');
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      requestCount++;
      console.log(`[NOTION API] Request ${requestCount}/${REQUEST_LIMIT}, attempt ${attempt + 1}`);
      
      const result = await apiCall();
      return result;
    } catch (error) {
      console.error(`[NOTION API] Attempt ${attempt + 1} failed:`, error.message);
      
      if (error?.status === 429) {
        // При rate limiting увеличиваем задержку значительно
        const delay = Math.min(2000 * Math.pow(2, attempt), 10000);
        console.log(`[NOTION API] Rate limited, waiting ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      if (error?.status >= 500 && error?.status < 600 && attempt < maxRetries - 1) {
        // Короткая пауза при серверных ошибках
        const delay = 1000 * (attempt + 1);
        console.log(`[NOTION API] Server error, retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      throw error;
    }
  }
}

// ОПТИМИЗИРОВАННАЯ Query с минимальным количеством запросов
async function queryAllPages(params) {
  const pageSize = Math.min(params.page_size || 100, 100);
  let start_cursor = undefined;
  let results = [];
  let pageCount = 0;
  const maxPages = 20; // УМЕНЬШЕНО для предотвращения превышения лимитов
  
  console.log(`[QUERY ALL] Starting optimized query, max pages: ${maxPages}`);
  
  do {
    pageCount++;
    
    // Проверяем лимит запросов перед каждым запросом
    if (requestCount >= REQUEST_LIMIT - 5) {
      console.warn(`[QUERY ALL] Approaching request limit, stopping at page ${pageCount}`);
      break;
    }
    
    console.log(`[QUERY ALL] Loading page ${pageCount}, requests used: ${requestCount}/${REQUEST_LIMIT}`);
    
    const res = await notionApiCall(() => 
      notion.databases.query({ 
        ...params, 
        start_cursor, 
        page_size: pageSize 
      })
    );
    
    const newResults = res.results || [];
    results.push(...newResults);
    start_cursor = res.has_more ? res.next_cursor : undefined;
    
    console.log(`[QUERY ALL] Page ${pageCount}: ${newResults.length} items, has_more: ${res.has_more}, total: ${results.length}`);
    
    if (pageCount >= maxPages) {
      console.warn(`[QUERY ALL] Reached maximum page limit (${maxPages}), stopping pagination`);
      break;
    }
    
  } while (start_cursor);
  
  console.log(`[QUERY ALL] Query completed: ${results.length} total results across ${pageCount} pages`);
  return results;
}

// Utility функции
function getTitleFromProps(props) {
  for (const key in props) {
    const v = props[key];
    if (v?.type === "title" && v.title?.length) {
      return v.title.map(t => t.plain_text).join("");
    }
  }
  return null;
}

// Получение свойств БД с кэшированием
async function getDbProps(dbId) {
  const cacheKey = `db_props_${dbId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  
  const db = await notionApiCall(() => 
    notion.databases.retrieve({ database_id: dbId })
  );
  
  setCached(cacheKey, db.properties);
  return db.properties;
}

// Поиск сотрудников по команде
export async function findEmployeesByTeam(teamName) {
  if (!teamName || typeof teamName !== 'string') {
    throw new Error('Team name is required');
  }
  
  console.log(`[SEARCH] Looking for team: "${teamName}"`);
  
  try {
    const teamProps = await getDbProps(EMPLOYEES_DB_ID);
    const def = teamProps[PROP.team];
    if (!def) {
      console.error(`[SEARCH] Team property "${PROP.team}" not found in employees database`);
      console.log('[SEARCH] Available properties:', Object.keys(teamProps));
      return [];
    }
    
    const norm = (s) => (s || "").toString().trim().toLowerCase().replace(/\s+/g, " ");
    const q = norm(teamName);
    
    let filter = null;
    
    if (def.type === "select") {
      const opts = def.select?.options || [];
      let match = opts.find(o => norm(o.name) === q);
      
      if (!match) {
        const cand = opts.filter(o => norm(o.name).includes(q));
        if (cand.length === 1) match = cand[0];
      }
      
      if (match) {
        filter = { property: PROP.team, select: { equals: match.name } };
      }
    } else if (def.type === "multi_select") {
      const opts = def.multi_select?.options || [];
      let match = opts.find(o => norm(o.name) === q);
      
      if (!match) {
        const cand = opts.filter(o => norm(o.name).includes(q));
        if (cand.length === 1) match = cand[0];
      }
      
      if (match) {
        filter = { property: PROP.team, multi_select: { contains: match.name } };
      }
    } else if (def.type === "rich_text") {
      filter = { property: PROP.team, rich_text: { contains: teamName } };
    } else if (def.type === "title") {
      filter = { property: PROP.team, title: { contains: teamName } };
    }
    
    if (!filter) {
      console.warn(`[SEARCH] Could not create filter for team "${teamName}", property type: ${def.type}`);
      return [];
    }
    
    console.log(`[SEARCH] Created filter:`, JSON.stringify(filter, null, 2));
    
    const rows = await queryAllPages({
      database_id: EMPLOYEES_DB_ID,
      filter,
      page_size: 100
    });

    const list = [];
    for (const row of rows) {
      const props = row.properties || {};
      const name = getTitleFromProps(props) || row.id;
      const acct = props[PROP.empAccount];
      const ppl = acct?.people || [];
      const userIds = ppl.map(u => u?.id).filter(Boolean);
      list.push({ pageId: row.id, name, userIds });
    }
    
    console.log(`[SEARCH] Found ${list.length} employees for team "${teamName}"`);
    return list;
    
  } catch (error) {
    console.error(`[SEARCH] Error searching for team "${teamName}":`, error);
    throw error;
  }
}

// ОПТИМИЗИРОВАННАЯ функция получения имен сотрудников
export async function getEmployeeNamesByUserIds(userIds) {
  const unique = Array.from(new Set((userIds || []).filter(Boolean)));
  if (!unique.length) return new Map();
  
  // Проверяем лимит запросов
  if (requestCount >= REQUEST_LIMIT - 5) {
    console.warn('[EMPLOYEE NAMES] Request limit reached, returning empty map');
    return new Map();
  }
  
  const props = await getDbProps(EMPLOYEES_DB_ID);
  if (props[PROP.empAccount]?.type !== "people") return new Map();

  const out = new Map();
  
  // Уменьшаем размер чанка для снижения нагрузки
  const chunkSize = Math.min(10, unique.length);
  
  for (let i = 0; i < unique.length; i += chunkSize) {
    // Проверяем лимит запросов перед каждым чанком
    if (requestCount >= REQUEST_LIMIT - 3) {
      console.warn('[EMPLOYEE NAMES] Approaching request limit, stopping name lookup');
      break;
    }
    
    const chunk = unique.slice(i, i + chunkSize);
    const filter = { 
      or: chunk.map(uid => ({ 
        property: PROP.empAccount, 
        people: { contains: uid } 
      })) 
    };
    
    try {
      const rows = await queryAllPages({ 
        database_id: EMPLOYEES_DB_ID, 
        filter, 
        page_size: 50 // Уменьшено
      });
      
      for (const row of rows) {
        const rp = row.properties || {};
        const title = getTitleFromProps(rp) || row.id;
        const ppl = rp[PROP.empAccount]?.people || [];
        
        for (const u of ppl) {
          const uid = u?.id;
          if (uid && !out.has(uid)) out.set(uid, title);
        }
      }
    } catch (error) {
      console.error('[EMPLOYEE NAMES] Error in chunk processing:', error.message);
      break; // Прерываем при ошибке
    }
  }
  
  return out;
}

// Сбор ревьюеров для сотрудников
export async function listReviewersForEmployees(employees) {
  if (!employees?.length) return [];

  try {
    const matrixProps = await getDbProps(MATRIX_DB_ID);
    const reviewersSet = new Set();

    const empDef = matrixProps?.[PROP.employee];
    if (!empDef) {
      console.error(`[REVIEWERS] Employee property "${PROP.employee}" not found in matrix database`);
      console.log('[REVIEWERS] Available properties:', Object.keys(matrixProps));
      return [];
    }
    
    let employeeOrFilters = [];
    if (empDef.type === "relation") {
      employeeOrFilters = employees.map(e => ({ 
        property: PROP.employee, 
        relation: { contains: e.pageId } 
      }));
    } else if (empDef.type === "people") {
      const allUserIds = Array.from(new Set(employees.flatMap(e => e.userIds || []))).filter(Boolean);
      employeeOrFilters = allUserIds.map(uid => ({ 
        property: PROP.employee, 
        people: { contains: uid } 
      }));
    }

    if (!employeeOrFilters.length) {
      console.warn('[REVIEWERS] No valid employee filters created');
      return [];
    }

    const rows = await queryAllPages({ 
      database_id: MATRIX_DB_ID, 
      filter: { or: employeeOrFilters }, 
      page_size: 100 
    });

    console.log(`[REVIEWERS] Found ${rows.length} matrix rows`);

    // Собираем всех оценивающих
    for (const row of rows) {
      const props = row.properties || {};
      
      [PROP.selfScorer, PROP.p1Peer, PROP.p2Peer, PROP.managerScorer].forEach(field => {
        const people = props[field]?.people || [];
        people.forEach(u => u?.id && reviewersSet.add(u.id));
      });
    }

    const uniqueReviewerIds = Array.from(reviewersSet);
    console.log(`[REVIEWERS] Found ${uniqueReviewerIds.length} unique reviewers`);
    
    if (uniqueReviewerIds.length === 0) {
      console.warn('[REVIEWERS] No reviewers found');
      return [];
    }
    
    const nameMap = await getEmployeeNamesByUserIds(uniqueReviewerIds);
    
    // Fallback к Notion users API для недостающих имен
    const missing = uniqueReviewerIds.filter(uid => !nameMap.has(uid));
    const nameCache = new Map(nameMap);
    
    if (missing.length > 0 && requestCount < REQUEST_LIMIT - missing.length) {
      console.log(`[REVIEWERS] Loading ${missing.length} missing names from Notion API`);
      
      for (const uid of missing) {
        if (requestCount >= REQUEST_LIMIT - 2) {
          console.warn('[REVIEWERS] Request limit reached, stopping name lookup');
          break;
        }
        
        try {
          const u = await notionApiCall(() => notion.users.retrieve({ user_id: uid }));
          nameCache.set(uid, (u && u.name) || uid);
        } catch (error) { 
          console.warn(`[REVIEWERS] Failed to get name for user ${uid}:`, error.message);
          nameCache.set(uid, uid); 
        }
      }
    }

    return uniqueReviewerIds.map(uid => ({ 
      reviewerUserId: uid, 
      name: nameCache.get(uid) || uid,
      role: 'peer'
    }));
    
  } catch (error) {
    console.error('[REVIEWERS] Error in listReviewersForEmployees:', error);
    throw error;
  }
}

// Определение роли ревьюера на строке
export function computeRoleOnRow(row, reviewerCtx, matrixProps) {
  if (!row?.properties || !reviewerCtx?.userId || !matrixProps) {
    console.warn('[ROLE] Missing required parameters for role computation');
    return null;
  }
  
  const p = row.properties;
  const userId = reviewerCtx.userId;
  const pageIds = reviewerCtx.pageIds || [];
  
  // 1. Проверяем Self (самооценка)
  const empDef = matrixProps[PROP.employee];
  if (empDef?.type === "people") {
    const empPeople = p[PROP.employee]?.people || [];
    if (empPeople.some(u => u?.id === userId)) {
      return "self";
    }
  } else if (empDef?.type === "relation") {
    const empRelations = p[PROP.employee]?.relation || [];
    if (pageIds.length > 0 && empRelations.some(r => pageIds.includes(r?.id))) {
      return "self";
    }
  }
  
  // 2. Проверяем Manager
  const managerPeople = p[PROP.managerScorer]?.people || [];
  if (managerPeople.some(u => u?.id === userId)) {
    return "manager";
  }
  
  // 3. Проверяем P1 Peer
  const p1People = p[PROP.p1Peer]?.people || [];
  if (p1People.some(u => u?.id === userId)) {
    return "p1_peer";
  }
  
  // 4. Проверяем P2 Peer
  const p2People = p[PROP.p2Peer]?.people || [];
  if (p2People.some(u => u?.id === userId)) {
    return "p2_peer";
  }
  
  return null;
}

// ОПТИМИЗИРОВАННАЯ функция получения страниц сотрудника
export async function getEmployeePagesByUserId(userId) {
  console.log(`[EMPLOYEE PAGES] Looking for pages for user: ${userId}`);
  
  // Проверяем лимит запросов
  if (requestCount >= REQUEST_LIMIT - 3) {
    console.warn('[EMPLOYEE PAGES] Request limit reached, returning empty array');
    return [];
  }
  
  try {
    const props = await getDbProps(EMPLOYEES_DB_ID);
    if (props[PROP.empAccount]?.type !== "people") {
      console.warn(`[EMPLOYEE PAGES] Employee account field is not of type 'people'`);
      return [];
    }
    
    const res = await notionApiCall(() => 
      notion.databases.query({
        database_id: EMPLOYEES_DB_ID,
        filter: { property: PROP.empAccount, people: { contains: userId } },
        page_size: 10 // Уменьшено
      })
    );
    
    const pages = res.results.map(row => ({
      pageId: row.id,
      name: getTitleFromProps(row.properties || {}) || row.id
    }));
    
    console.log(`[EMPLOYEE PAGES] Found ${pages.length} pages for user ${userId}`);
    return pages;
    
  } catch (error) {
    console.error(`[EMPLOYEE PAGES] Error getting pages for user ${userId}:`, error.message);
    return [];
  }
}

// ИСПРАВЛЕННАЯ функция поиска сотрудников для оценки ревьюером
export async function listEvaluateesForReviewerUser(userId) {
  console.log(`[EVALUATEES] Starting COMPREHENSIVE search for reviewer: ${userId}`);
  
  try {
    // Проверяем доступность матрицы и её структуру
    let matrixProps;
    try {
      matrixProps = await getDbProps(MATRIX_DB_ID);
      console.log(`[EVALUATEES] Matrix DB properties loaded, available:`, Object.keys(matrixProps));
    } catch (error) {
      console.error(`[EVALUATEES] Failed to load matrix database properties:`, error.message);
      throw new Error(`Cannot access matrix database: ${error.message}`);
    }
    
    // Получаем информацию о ревьюере
    const myPages = await getEmployeePagesByUserId(userId);
    const myPageIds = myPages.map(x => x.pageId);
    const reviewerCtx = { userId, pageIds: myPageIds };

    console.log(`[EVALUATEES] Reviewer context:`, { userId, myPageIds: myPageIds.length, myPages: myPages.map(p => p.name) });

    // Собираем ВСЕ возможные фильтры для максимального покрытия
    const allFilters = [];
    
    // Добавляем фильтры для ролей scorer
    const scorerFields = [PROP.selfScorer, PROP.p1Peer, PROP.p2Peer, PROP.managerScorer];
    for (const field of scorerFields) {
      const def = matrixProps[field];
      if (def?.type === "people") {
        allFilters.push({ 
          property: field, 
          people: { contains: userId },
          _debugFieldName: field
        });
        console.log(`[EVALUATEES] Added filter for ${field} (people)`);
      }
    }
    
    // Добавляем фильтр для employee (для самооценки)
    const empDef = matrixProps[PROP.employee];
    console.log(`[EVALUATEES] Employee field type: ${empDef?.type}`);
    
    if (empDef?.type === "people") {
      allFilters.push({ 
        property: PROP.employee, 
        people: { contains: userId },
        _debugFieldName: PROP.employee + '_people'
      });
      console.log(`[EVALUATEES] Added employee people filter`);
    } else if (empDef?.type === "relation" && myPageIds.length > 0) {
      myPageIds.forEach((pageId, index) => {
        allFilters.push({ 
          property: PROP.employee, 
          relation: { contains: pageId },
          _debugFieldName: `${PROP.employee}_relation_${index}`
        });
      });
      console.log(`[EVALUATEES] Added ${myPageIds.length} employee relation filters`);
    }

    if (!allFilters.length) {
      console.error('[EVALUATEES] No valid filters created - this should not happen');
      throw new Error('Cannot create valid filters for matrix search. Check database structure.');
    }

    console.log(`[EVALUATEES] Created ${allFilters.length} comprehensive filters`);

    // Выполняем поиск - используем более агрессивную стратегию
    let allRows = [];
    
    // Стратегия 1: Попытка объединенного запроса
    try {
      console.log(`[EVALUATEES] Strategy 1: Executing combined OR filter with ${allFilters.length} conditions`);
      
      const cleanFilters = allFilters.map(f => {
        const { _debugFieldName, ...cleanFilter } = f;
        return cleanFilter;
      });
      
      const combinedFilter = cleanFilters.length === 1 ? cleanFilters[0] : { or: cleanFilters };
      
      allRows = await queryAllPages({
        database_id: MATRIX_DB_ID,
        filter: combinedFilter,
        page_size: 100
      });
      
      console.log(`[EVALUATEES] Strategy 1 SUCCESS: Combined filter found ${allRows.length} rows`);
      
    } catch (filterError) {
      console.error(`[EVALUATEES] Strategy 1 FAILED:`, filterError.message);
      
      // Стратегия 2: Fallback к индивидуальным запросам (ОГРАНИЧЕННОЕ количество)
      console.log(`[EVALUATEES] Strategy 2: Fallback to individual filter execution`);
      
      const maxFilters = Math.min(allFilters.length, 3); // Ограничиваем количество фильтров
      
      for (let i = 0; i < maxFilters; i++) {
        if (requestCount >= REQUEST_LIMIT - 5) {
          console.warn('[EVALUATEES] Request limit reached, stopping filter execution');
          break;
        }
        
        const filter = allFilters[i];
        const { _debugFieldName, ...cleanFilter } = filter;
        
        console.log(`[EVALUATEES] Executing filter ${i + 1}/${maxFilters} (${_debugFieldName})`);
        
        try {
          const filterRows = await queryAllPages({
            database_id: MATRIX_DB_ID,
            filter: cleanFilter,
            page_size: 50 // Уменьшено
          });
          
          console.log(`[EVALUATEES] Filter ${i + 1} (${_debugFieldName}) found ${filterRows.length} rows`);
          allRows.push(...filterRows);
        } catch (individualError) {
          console.error(`[EVALUATEES] Filter ${i + 1} (${_debugFieldName}) failed:`, individualError.message);
        }
      }
    }

    // Удаляем дубликаты по ID
    const uniqueRows = Array.from(new Map(allRows.map(row => [row.id, row])).values());
    console.log(`[EVALUATEES] Total unique rows found: ${uniqueRows.length} (from ${allRows.length} total)`);

    if (!uniqueRows.length) {
      console.warn(`[EVALUATEES] No matrix rows found for reviewer ${userId}`);
      return [];
    }

    // Группируем по сотрудникам с улучшенной логикой
    const employeesMap = new Map();
    
    for (const row of uniqueRows) {
      try {
        const role = computeRoleOnRow(row, reviewerCtx, matrixProps);
        
        if (!role) {
          continue;
        }

        // Получаем ID сотрудника
        let employeeId = null, employeeName = null;
        const p = row.properties;
        
        if (empDef?.type === "relation") {
          const rel = p[PROP.employee]?.relation;
          employeeId = rel?.[0]?.id;
          
          if (employeeId && !employeesMap.has(employeeId)) {
            if (requestCount < REQUEST_LIMIT - 3) {
              try {
                const page = await notionApiCall(() => notion.pages.retrieve({ page_id: employeeId }));
                employeeName = getTitleFromProps(page.properties || {}) || employeeId;
                console.log(`[EVALUATEES] Loaded employee name from relation: ${employeeName}`);
              } catch (error) {
                console.error(`[EVALUATEES] Failed to load employee ${employeeId}:`, error.message);
                employeeName = employeeId;
              }
            } else {
              employeeName = employeeId;
            }
          }
        } else if (empDef?.type === "people") {
          const ppl = p[PROP.employee]?.people;
          employeeId = ppl?.[0]?.id;
          
          if (employeeId && !employeesMap.has(employeeId)) {
            try {
              const nameMap = await getEmployeeNamesByUserIds([employeeId]);
              employeeName = nameMap.get(employeeId) || employeeId;
              console.log(`[EVALUATEES] Loaded employee name from people: ${employeeName}`);
            } catch (error) {
              console.error(`[EVALUATEES] Failed to get employee name for ${employeeId}:`, error.message);
              employeeName = employeeId;
            }
          }
        }

        if (employeeId) {
          if (!employeesMap.has(employeeId)) {
            const employee = {
              employeeId,
              employeeName: employeeName || employeeId,
              role
            };
            employeesMap.set(employeeId, employee);
            console.log(`[EVALUATEES] ✅ Added employee:`, employee);
          }
        }
      } catch (rowError) {
        console.error(`[EVALUATEES] Error processing row ${row.id}:`, rowError.message);
        continue;
      }
    }

    const result = Array.from(employeesMap.values());
    console.log(`[EVALUATEES] 🎉 FINAL RESULT: ${result.length} employees found for evaluation`);
    
    if (result.length === 0) {
      console.warn(`[EVALUATEES] ⚠️ WARNING: No employees found despite ${uniqueRows.length} matrix rows`);
      console.log(`[EVALUATEES] Debug info:`, {
        reviewerUserId: userId,
        myPageIds: myPageIds.length,
        matrixRowsFound: uniqueRows.length,
        filtersUsed: allFilters.length
      });
    } else {
      console.log(`[EVALUATEES] ✅ SUCCESS: Found employees:`, result.map(e => `${e.employeeName} (${e.role})`));
    }
    
    return result;
    
  } catch (error) {
    console.error(`[EVALUATEES] CRITICAL ERROR:`, {
      message: error.message,
      stack: error.stack,
      userId
    });
    throw error;
  }
}

// ОПТИМИЗИРОВАННАЯ функция загрузки навыков с минимальными запросами
export async function fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId) {
  console.log(`[SKILLS] Starting OPTIMIZED skill loading for ${employees.length} employees, reviewer: ${reviewerUserId}`);
  
  try {
    const matrixProps = await getDbProps(MATRIX_DB_ID);
    const myPages = await getEmployeePagesByUserId(reviewerUserId);
    const reviewerCtx = { userId: reviewerUserId, pageIds: myPages.map(x => x.pageId) };

    console.log(`[SKILLS] Reviewer context:`, { 
      userId: reviewerUserId, 
      pageIds: reviewerCtx.pageIds.length
    });

    const result = [];
    
    // Обрабатываем только первых 2 сотрудников для предотвращения превышения лимитов
    const limitedEmployees = employees.slice(0, 2);
    console.log(`[SKILLS] Processing limited employee list: ${limitedEmployees.length} of ${employees.length}`);
    
    for (const employee of limitedEmployees) {
      console.log(`[SKILLS] Processing employee: ${employee.employeeName} (${employee.employeeId})`);
      
      // Проверяем лимит запросов
      if (requestCount >= REQUEST_LIMIT - 10) {
        console.warn(`[SKILLS] Approaching request limit, stopping at employee: ${employee.employeeName}`);
        break;
      }
      
      try {
        // Строим фильтр для конкретного сотрудника
        let employeeFilter;
        const empDef = matrixProps[PROP.employee];
        
        if (empDef?.type === "relation") {
          employeeFilter = { property: PROP.employee, relation: { contains: employee.employeeId } };
        } else if (empDef?.type === "people") {
          employeeFilter = { property: PROP.employee, people: { contains: employee.employeeId } };
        } else {
          console.warn(`[SKILLS] Unsupported employee field type: ${empDef?.type}`);
          continue;
        }

        console.log(`[SKILLS] Using filter for employee:`, JSON.stringify(employeeFilter));

        // Получаем строки для этого сотрудника (ОГРАНИЧЕННОЕ количество)
        const employeeRows = await queryAllPages({
          database_id: MATRIX_DB_ID,
          filter: employeeFilter,
          page_size: 50 // УМЕНЬШЕНО
        });

        console.log(`[SKILLS] Found ${employeeRows.length} rows for employee ${employee.employeeName}`);

        if (!employeeRows.length) {
          console.warn(`[SKILLS] No matrix rows found for employee ${employee.employeeName}`);
          continue;
        }

        // Определяем роль ревьюера и собираем навыки
        const relevantRows = [];
        let detectedRole = null;
        
        for (const row of employeeRows) {
          const role = computeRoleOnRow(row, reviewerCtx, matrixProps);
          if (role) {
            relevantRows.push(row);
            if (!detectedRole) detectedRole = role;
          }
        }

        if (!detectedRole) {
          console.warn(`[SKILLS] No role found for reviewer ${reviewerUserId} for employee ${employee.employeeName}`);
          continue;
        }

        console.log(`[SKILLS] Detected role: ${detectedRole} for employee ${employee.employeeName}`);
        console.log(`[SKILLS] Found ${relevantRows.length} relevant rows for this role`);

        // Собираем уникальные навыки (ОГРАНИЧЕННОЕ количество)
        const uniqueSkills = new Map();
        const field = ROLE_TO_FIELD[detectedRole];
        
        if (!field) {
          console.error(`[SKILLS] No field mapping found for role: ${detectedRole}`);
          continue;
        }
        
        console.log(`[SKILLS] Using score field: ${field} for role: ${detectedRole}`);
        
        // Ограничиваем количество навыков для предотвращения превышения лимитов
        const limitedRows = relevantRows.slice(0, 15);
        console.log(`[SKILLS] Processing limited skills: ${limitedRows.length} of ${relevantRows.length}`);
        
        for (const row of limitedRows) {
          const props = row.properties;
          const skillRel = props[PROP.skill]?.relation;
          const skillId = skillRel?.[0]?.id;
          
          if (!skillId) {
            console.warn(`[SKILLS] No skill ID found in row ${row.id}`);
            continue;
          }
          
          if (!uniqueSkills.has(skillId)) {
            const current = props[field]?.number ?? null;
            
            uniqueSkills.set(skillId, {
              pageId: row.id,
              skillId,
              current,
              field,
              matrixRowProps: props
            });
          }
        }

        console.log(`[SKILLS] Found ${uniqueSkills.size} unique skills for ${employee.employeeName}`);

        // Загружаем информацию о навыках ПОСЛЕДОВАТЕЛЬНО с ограничениями
        const items = [];
        const skillEntries = Array.from(uniqueSkills.values());
        
        for (let i = 0; i < skillEntries.length; i++) {
          // Проверяем лимит запросов
          if (requestCount >= REQUEST_LIMIT - 5) {
            console.warn(`[SKILLS] Approaching request limit, stopping skill loading at ${i}/${skillEntries.length}`);
            break;
          }
          
          const skillEntry = skillEntries[i];
          
          try {
            // Пытаемся получить информацию из rollup поля сначала
            let skillName = "Неизвестный навык";
            let skillDescription = "";
            
            if (skillEntry.matrixRowProps && skillEntry.matrixRowProps[PROP.skillDescription]) {
              const rollupField = skillEntry.matrixRowProps[PROP.skillDescription];
              
              if (rollupField?.type === "rollup" && rollupField.rollup?.array?.length > 0) {
                for (const value of rollupField.rollup.array) {
                  if (value?.rich_text?.length > 0) {
                    skillDescription = value.rich_text.map(t => t.plain_text).join("");
                    break;
                  } else if (value?.title?.length > 0) {
                    skillName = value.title.map(t => t.plain_text).join("");
                    break;
                  }
                }
              } else if (rollupField?.rollup?.rich_text?.length > 0) {
                skillDescription = rollupField.rollup.rich_text.map(t => t.plain_text).join("");
              }
              
              if (skillDescription) {
                const lines = skillDescription.split('\n');
                if (lines.length > 0 && lines[0].trim().length > 0 && lines[0].length < 100) {
                  skillName = lines[0].trim();
                }
              }
            }
            
            // Если нет информации в rollup, попробуем загрузить страницу навыка
            if (skillName === "Неизвестный навык" && requestCount < REQUEST_LIMIT - 3) {
              try {
                console.log(`[SKILLS] Loading skill page: ${skillEntry.skillId}`);
                
                const skillPage = await notionApiCall(() => 
                  notion.pages.retrieve({ page_id: skillEntry.skillId })
                );
                
                const props = skillPage.properties || {};
                const pageTitle = getTitleFromProps(props);
                if (pageTitle && pageTitle.trim() && pageTitle !== "Untitled") {
                  skillName = pageTitle.trim();
                }
                
                // Ищем описание в свойствах
                for (const [key, value] of Object.entries(props)) {
                  if (value?.type === "rich_text" && value.rich_text?.length > 0) {
                    const keyLower = key.toLowerCase();
                    if (keyLower.includes("описан") || 
                        keyLower.includes("description") ||
                        keyLower.includes("дескрипш") ||
                        keyLower.includes("content") ||
                        keyLower.includes("детал") ||
                        keyLower.includes("text")) {
                      skillDescription = value.rich_text.map(t => t.plain_text).join("");
                      break;
                    }
                  }
                }
                
                console.log(`[SKILLS] ✅ Loaded skill from page: ${skillName}`);
                
              } catch (pageError) {
                console.warn(`[SKILLS] Failed to load skill page ${skillEntry.skillId}:`, pageError.message);
                skillName = `Навык ${skillEntry.skillId.substring(-8)}`;
              }
            }
            
            items.push({
              pageId: skillEntry.pageId,
              name: skillName,
              description: skillDescription,
              current: skillEntry.current,
              comment: ""
            });
            
            console.log(`[SKILLS] ✅ Processed skill: ${skillName}`);
            
          } catch (skillError) {
            console.error(`[SKILLS] Error loading skill ${skillEntry.skillId}:`, skillError.message);
            
            items.push({
              pageId: skillEntry.pageId,
              name: `Навык ${skillEntry.skillId.substring(-8)}`,
              description: `Ошибка загрузки: ${skillError.message}`,
              current: skillEntry.current,
              comment: ""
            });
          }
          
          // Небольшая задержка между запросами
          if (i < skillEntries.length - 1) {
            await new Promise(r => setTimeout(r, 50));
          }
        }

        if (items.length > 0) {
          result.push({
            employeeId: employee.employeeId,
            employeeName: employee.employeeName,
            role: detectedRole,
            items
          });
          
          console.log(`[SKILLS] ✅ Added ${items.length} skills for ${employee.employeeName} (role: ${detectedRole})`);
        } else {
          console.warn(`[SKILLS] No skills found for ${employee.employeeName}`);
        }
      } catch (employeeError) {
        console.error(`[SKILLS] Error processing employee ${employee.employeeName}:`, employeeError.message);
        continue;
      }
    }

    console.log(`[SKILLS] ✅ Final result: ${result.length} employees with skills`);
    console.log(`[SKILLS] Total requests used: ${requestCount}/${REQUEST_LIMIT}`);
    
    return result;
    
  } catch (error) {
    console.error(`[SKILLS] Critical error in fetchEmployeeSkillRowsForReviewerUser:`, error.message);
    throw error;
  }
}

// Обновление оценки
export async function updateScore(pageId, field, value, comment, commentProp) {
  const properties = {
    [field]: { number: value }
  };
  
  if (commentProp && comment !== undefined) {
    properties[commentProp] = { 
      rich_text: [{ text: { content: comment || "" } }] 
    };
  }
  
  return await notionApiCall(() =>
    notion.pages.update({
      page_id: pageId,
      properties
    })
  );
}

// Определение поля комментария
export async function detectCommentProp() {
  try {
    const props = await getDbProps(MATRIX_DB_ID);
    
    if (props[PROP.comment]?.type === "rich_text") {
      return PROP.comment;
    }
    
    const candidate = Object.keys(props).find((k) => {
      const v = props[k];
      if (v?.type !== "rich_text") return false;
      const name = (k || "").toLowerCase();
      return name.includes("коммент") || 
             name.includes("comment") || 
             name.includes("примеч") || 
             name.includes("note");
    });
    
    return candidate || null;
  } catch {
    return null;
  }
}

// Дополнительные функции для совместимости
export async function batchUpdateScores(items, scoreField) {
  console.log(`[BATCH UPDATE] Начинаем пакетное обновление ${items.length} записей`);
  
  let successful = 0;
  let failed = 0;
  const errors = [];
  
  // Последовательное обновление для избежания превышения лимитов
  for (const [index, item] of items.entries()) {
    if (requestCount >= REQUEST_LIMIT - 2) {
      console.warn(`[BATCH UPDATE] Request limit reached, stopping at ${index}/${items.length}`);
      break;
    }
    
    try {
      await notionApiCall(() =>
        notion.pages.update({
          page_id: item.pageId,
          properties: {
            [scoreField]: { number: item.value }
          }
        })
      );
      successful++;
      
      // Небольшая задержка между запросами
      if (index < items.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
    } catch (error) {
      console.error(`[BATCH UPDATE] Ошибка обновления ${item.pageId}:`, error.message);
      failed++;
      errors.push({ pageId: item.pageId, error: error.message });
    }
  }
  
  console.log(`[BATCH UPDATE] ✅ Завершено: ${successful} успешно, ${failed} ошибок`);
  
  return {
    successful,
    failed,
    errors: errors.length > 0 ? errors : undefined
  };
}