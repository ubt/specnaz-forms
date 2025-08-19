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
  skillName: "Навык - название",
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

// УЛУЧШЕННЫЙ cache для Edge Runtime с TTL
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 минут для навыков
const DB_CACHE_TTL = 30 * 60 * 1000; // 30 минут для структур БД

function getCached(key, customTTL) {
  const item = cache.get(key);
  const ttl = customTTL || CACHE_TTL;
  if (item && Date.now() - item.timestamp < ttl) {
    return item.data;
  }
  cache.delete(key);
  return null;
}

function setCached(key, data, customTTL) {
  cache.set(key, { data, timestamp: Date.now() });
  
  // Автоочистка старых записей каждые 100 записей
  if (cache.size > 100) {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
      if (now - v.timestamp > (customTTL || CACHE_TTL)) {
        cache.delete(k);
      }
    }
  }
}

// Оптимизированный rate limiter
let lastRequest = 0;
const requestQueue = [];
let isProcessing = false;

async function optimizedRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequest;
  
  // Адаптивная задержка в зависимости от нагрузки
  const minDelay = requestQueue.length > 5 ? 200 : 100;
  
  if (timeSinceLastRequest < minDelay) {
    await new Promise(resolve => setTimeout(resolve, minDelay - timeSinceLastRequest));
  }
  lastRequest = Date.now();
}

// Обертка для API вызовов с retry логикой
async function notionApiCall(apiCall, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await optimizedRateLimit();
      const result = await apiCall();
      return result;
    } catch (error) {
      console.error(`[NOTION API] Attempt ${attempt + 1} failed:`, error.message);
      
      if (error?.status === 429) {
        const delay = Math.min(500 * Math.pow(2, attempt), 5000); // Уменьшены задержки
        console.log(`[NOTION API] Rate limited, waiting ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      if (error?.status >= 500 && error?.status < 600 && attempt < maxRetries - 1) {
        const delay = 500 * (attempt + 1); // Уменьшены задержки
        console.log(`[NOTION API] Server error, retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      throw error;
    }
  }
}

// ОПТИМИЗИРОВАННАЯ Query всех страниц
async function queryAllPages(params) {
  const pageSize = Math.min(params.page_size || 100, 100);
  let start_cursor = undefined;
  let results = [];
  let pageCount = 0;
  const maxPages = 20; // Уменьшено для ускорения
  
  console.log(`[QUERY ALL] Starting query with filters:`, JSON.stringify(params.filter, null, 2));
  
  do {
    pageCount++;
    console.log(`[QUERY ALL] Loading page ${pageCount}, cursor: ${start_cursor ? start_cursor.substring(0, 10) + '...' : 'none'}`);
    
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
    
    console.log(`[QUERY ALL] Page ${pageCount}: ${newResults.length} items, has_more: ${res.has_more}, total so far: ${results.length}`);
    
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
  const cached = getCached(cacheKey, DB_CACHE_TTL);
  if (cached) return cached;
  
  const db = await notionApiCall(() => 
    notion.databases.retrieve({ database_id: dbId })
  );
  
  setCached(cacheKey, db.properties, DB_CACHE_TTL);
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

// Получение имен сотрудников по User IDs
export async function getEmployeeNamesByUserIds(userIds) {
  const unique = Array.from(new Set((userIds || []).filter(Boolean)));
  if (!unique.length) return new Map();
  
  const props = await getDbProps(EMPLOYEES_DB_ID);
  if (props[PROP.empAccount]?.type !== "people") return new Map();

  const out = new Map();
  const chunkSize = 20;
  
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const filter = { 
      or: chunk.map(uid => ({ 
        property: PROP.empAccount, 
        people: { contains: uid } 
      })) 
    };
    
    const rows = await queryAllPages({ 
      database_id: EMPLOYEES_DB_ID, 
      filter, 
      page_size: 100 
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
    
    if (missing.length > 0) {
      console.log(`[REVIEWERS] Loading ${missing.length} missing names from Notion API`);
      
      for (const uid of missing) {
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

// ИСПРАВЛЕННАЯ функция определения роли ревьюера
export function computeRoleOnRow(row, reviewerCtx, matrixProps) {
  if (!row?.properties || !reviewerCtx?.userId || !matrixProps) {
    console.warn('[ROLE] Missing required parameters for role computation');
    return null;
  }
  
  const p = row.properties;
  const userId = reviewerCtx.userId;
  const pageIds = reviewerCtx.pageIds || [];
  
  console.log(`[ROLE] Computing role for userId: ${userId}, pageIds: ${pageIds.length}`);
  
  // 1. Проверяем Manager (высший приоритет)
  const managerPeople = p[PROP.managerScorer]?.people || [];
  if (managerPeople.some(u => u?.id === userId)) {
    console.log(`[ROLE] Found manager role`);
    return "manager";
  }
  
  // 2. Проверяем Self (самооценка)
  const empDef = matrixProps[PROP.employee];
  if (empDef?.type === "people") {
    const empPeople = p[PROP.employee]?.people || [];
    if (empPeople.some(u => u?.id === userId)) {
      console.log(`[ROLE] Found self role via employee people field`);
      return "self";
    }
  } else if (empDef?.type === "relation") {
    const empRelations = p[PROP.employee]?.relation || [];
    if (pageIds.length > 0 && empRelations.some(r => pageIds.includes(r?.id))) {
      console.log(`[ROLE] Found self role via employee relation field`);
      return "self";
    }
  }
  
  // 3. Проверяем P1 Peer
  const p1People = p[PROP.p1Peer]?.people || [];
  if (p1People.some(u => u?.id === userId)) {
    console.log(`[ROLE] Found p1_peer role`);
    return "p1_peer";
  }
  
  // 4. Проверяем P2 Peer
  const p2People = p[PROP.p2Peer]?.people || [];
  if (p2People.some(u => u?.id === userId)) {
    console.log(`[ROLE] Found p2_peer role`);
    return "p2_peer";
  }
  
  console.log(`[ROLE] No role found for user ${userId} in row ${row.id}`);
  return null;
}

// Получение страниц сотрудника по User ID
export async function getEmployeePagesByUserId(userId) {
  console.log(`[EMPLOYEE PAGES] Looking for pages for user: ${userId}`);
  
  const cacheKey = `emp_pages_${userId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  
  try {
    const props = await getDbProps(EMPLOYEES_DB_ID);
    if (props[PROP.empAccount]?.type !== "people") {
      console.warn(`[EMPLOYEE PAGES] Employee account field is not of type 'people', found: ${props[PROP.empAccount]?.type}`);
      return [];
    }
    
    const res = await notionApiCall(() => 
      notion.databases.query({
        database_id: EMPLOYEES_DB_ID,
        filter: { property: PROP.empAccount, people: { contains: userId } },
        page_size: 10
      })
    );
    
    const pages = res.results.map(row => ({
      pageId: row.id,
      name: getTitleFromProps(row.properties || {}) || row.id
    }));
    
    setCached(cacheKey, pages);
    console.log(`[EMPLOYEE PAGES] Found ${pages.length} pages for user ${userId}`);
    return pages;
    
  } catch (error) {
    console.error(`[EMPLOYEE PAGES] Error getting pages for user ${userId}:`, error.message);
    return [];
  }
}

// ИСПРАВЛЕННАЯ функция поиска сотрудников для оценки (решает проблему с отображением не всех сотрудников)
export async function listEvaluateesForReviewerUser(userId) {
  console.log(`[EVALUATEES] Starting search for reviewer: ${userId}`);
  
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

    // Проверяем структуру матрицы
    const requiredFields = [PROP.employee, PROP.skill, PROP.selfScorer, PROP.p1Peer, PROP.p2Peer, PROP.managerScorer];
    const missingFields = requiredFields.filter(field => !matrixProps[field]);
    
    if (missingFields.length > 0) {
      console.error(`[EVALUATEES] Missing required fields in matrix:`, missingFields);
      console.log(`[EVALUATEES] Available fields:`, Object.keys(matrixProps));
      throw new Error(`Matrix database missing required fields: ${missingFields.join(', ')}`);
    }

    // Собираем все возможные фильтры для ревьюера
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
      } else {
        console.warn(`[EVALUATEES] Field ${field} has type ${def?.type || 'undefined'}, expected people`);
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
    } else {
      console.warn(`[EVALUATEES] Employee field type ${empDef?.type} not supported or no page IDs found`);
    }

    if (!allFilters.length) {
      console.error('[EVALUATEES] No valid filters created');
      console.log('[EVALUATEES] Matrix structure debug:', {
        selfScorer: matrixProps[PROP.selfScorer]?.type,
        p1Peer: matrixProps[PROP.p1Peer]?.type,
        p2Peer: matrixProps[PROP.p2Peer]?.type,
        managerScorer: matrixProps[PROP.managerScorer]?.type,
        employee: matrixProps[PROP.employee]?.type
      });
      throw new Error('Cannot create valid filters for matrix search. Check database structure.');
    }

    console.log(`[EVALUATEES] Created ${allFilters.length} filters`);

    // Выполняем поиск с объединенным OR фильтром для эффективности
    let allRows = [];
    
    try {
      console.log(`[EVALUATEES] Executing combined OR filter with ${allFilters.length} conditions`);
      
      // Убираем debug поля для реального запроса
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
      
      console.log(`[EVALUATEES] Combined filter found ${allRows.length} rows`);
      
    } catch (filterError) {
      console.error(`[EVALUATEES] Combined filter failed:`, filterError.message);
      
      // Fallback: выполняем запросы по одному
      console.log(`[EVALUATEES] Falling back to individual filter execution`);
      
      for (let i = 0; i < allFilters.length; i++) {
        const filter = allFilters[i];
        const { _debugFieldName, ...cleanFilter } = filter;
        
        console.log(`[EVALUATEES] Executing filter ${i + 1}/${allFilters.length} (${_debugFieldName})`);
        
        try {
          const filterRows = await queryAllPages({
            database_id: MATRIX_DB_ID,
            filter: cleanFilter,
            page_size: 100
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

    // ИСПРАВЛЕНО: Группируем по комбинации employeeId + role, а не только по employeeId
    const employeesMap = new Map(); // Ключ: employeeId + role
    
    for (const row of uniqueRows) {
      try {
        const role = computeRoleOnRow(row, reviewerCtx, matrixProps);
        
        if (!role) {
          console.log(`[EVALUATEES] No role computed for row ${row.id}`);
          continue;
        }

        console.log(`[EVALUATEES] Found role ${role} for row ${row.id}`);

        // Получаем ID сотрудника
        let employeeId = null, employeeName = null;
        const p = row.properties;
        
        if (empDef?.type === "relation") {
          const rel = p[PROP.employee]?.relation;
          employeeId = rel?.[0]?.id;
          
          if (employeeId) {
            const cacheKey = `emp_name_${employeeId}`;
            employeeName = getCached(cacheKey);
            
            if (!employeeName) {
              try {
                const page = await notionApiCall(() => notion.pages.retrieve({ page_id: employeeId }));
                employeeName = getTitleFromProps(page.properties || {}) || employeeId;
                setCached(cacheKey, employeeName);
                console.log(`[EVALUATEES] Loaded employee name from relation: ${employeeName}`);
              } catch (error) {
                console.error(`[EVALUATEES] Failed to load employee ${employeeId}:`, error.message);
                employeeName = employeeId;
              }
            }
          }
        } else if (empDef?.type === "people") {
          const ppl = p[PROP.employee]?.people;
          employeeId = ppl?.[0]?.id;
          
          if (employeeId) {
            const cacheKey = `emp_name_${employeeId}`;
            employeeName = getCached(cacheKey);
            
            if (!employeeName) {
              try {
                const nameMap = await getEmployeeNamesByUserIds([employeeId]);
                employeeName = nameMap.get(employeeId) || employeeId;
                setCached(cacheKey, employeeName);
                console.log(`[EVALUATEES] Loaded employee name from people: ${employeeName}`);
              } catch (error) {
                console.error(`[EVALUATEES] Failed to get employee name for ${employeeId}:`, error.message);
                employeeName = employeeId;
              }
            }
          }
        }

        if (employeeId) {
          // ИСПРАВЛЕНО: Создаем уникальный ключ для комбинации сотрудник + роль
          const uniqueKey = `${employeeId}_${role}`;
          
          if (!employeesMap.has(uniqueKey)) {
            const employee = {
              employeeId,
              employeeName: employeeName || employeeId,
              role
            };
            employeesMap.set(uniqueKey, employee);
            console.log(`[EVALUATEES] Added employee:`, employee);
          } else {
            console.log(`[EVALUATEES] Employee ${employeeId} with role ${role} already in map, skipping`);
          }
        } else {
          console.warn(`[EVALUATEES] No employee ID found in row ${row.id}`);
        }
      } catch (rowError) {
        console.error(`[EVALUATEES] Error processing row ${row.id}:`, rowError.message);
        continue;
      }
    }

    const result = Array.from(employeesMap.values());
    console.log(`[EVALUATEES] Final result: ${result.length} employees (with role combinations)`);
    
    if (result.length === 0) {
      console.warn(`[EVALUATEES] No employees found despite ${uniqueRows.length} matrix rows`);
      console.log(`[EVALUATEES] Reviewer context was:`, reviewerCtx);
      console.log(`[EVALUATEES] Matrix properties available:`, Object.keys(matrixProps));
    }
    
    return result;
    
  } catch (error) {
    console.error(`[EVALUATEES] Critical error:`, {
      message: error.message,
      stack: error.stack,
      userId
    });
    throw error;
  }
}

// ОПТИМИЗИРОВАННАЯ функция загрузки информации о навыке с кэшированием
async function loadSkillInformation(skillId, matrixRowProps) {
  try {
    console.log(`[SKILL LOAD] Loading skill: ${skillId}`);

    const cacheKey = `skill_info_${skillId}`;
    const cached = getCached(cacheKey);
    if (cached) {
      console.log(`[SKILL LOAD] ✅ Using cached data for skill: ${cached.name}`);
      return cached;
    }

    let skillName = "Неизвестный навык";
    let skillDescription = "";


          if (item.type === "rich_text" && item.rich_text?.length) {
            skillDescription = item.rich_text.map(t => t.plain_text).join("");
          }
        }
      }
    }

    const result = { name: skillName, description: skillDescription };
    setCached(cacheKey, result);
    console.log(`[SKILL LOAD] ✅ Loaded skill: ${skillName}`);
    return result;

  } catch (error) {
    console.error(`[SKILL LOAD] Critical error loading skill ${skillId}:`, error.message);
    const result = {
      name: `Навык ${skillId.substring(-8)}`,
      description: `Ошибка загрузки: ${error.message}`
    };
    return result;
  }
}

// ОПТИМИЗИРОВАННАЯ основная функция загрузки навыков
export async function fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId) {
  console.log(`[SKILLS] Starting skill loading for ${employees.length} employees, reviewer: ${reviewerUserId}`);
  
  try {
    const matrixProps = await getDbProps(MATRIX_DB_ID);
    const myPages = await getEmployeePagesByUserId(reviewerUserId);
    const reviewerCtx = { userId: reviewerUserId, pageIds: myPages.map(x => x.pageId) };

    console.log(`[SKILLS] Reviewer context:`, { 
      userId: reviewerUserId, 
      pageIds: reviewerCtx.pageIds.length,
      pages: myPages.map(p => p.name)
    });

    const result = [];
    
    for (const employee of employees) {
      console.log(`[SKILLS] Processing employee: ${employee.employeeName} (${employee.employeeId})`);
      
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

        console.log(`[SKILLS] Using filter for employee:`, JSON.stringify(employeeFilter, null, 2));

        // Получаем все строки для этого сотрудника
        const employeeRows = await queryAllPages({
          database_id: MATRIX_DB_ID,
          filter: employeeFilter,
          page_size: 100
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
          if (role === employee.role) { // ИСПРАВЛЕНО: проверяем именно ту роль, которая нужна
            relevantRows.push(row);
            if (!detectedRole) detectedRole = role;
          }
        }

        if (!detectedRole) {
          console.warn(`[SKILLS] No matching role ${employee.role} found for reviewer ${reviewerUserId} for employee ${employee.employeeName}`);
          continue;
        }

        console.log(`[SKILLS] Detected role: ${detectedRole} for employee ${employee.employeeName}`);
        console.log(`[SKILLS] Found ${relevantRows.length} relevant rows for this role`);

        // Собираем уникальные навыки
        const uniqueSkills = new Map();
        const field = ROLE_TO_FIELD[detectedRole];
        
        if (!field) {
          console.error(`[SKILLS] No field mapping found for role: ${detectedRole}`);
          continue;
        }
        
        console.log(`[SKILLS] Using score field: ${field} for role: ${detectedRole}`);
        
        for (const row of relevantRows) {
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

        // ОПТИМИЗИРОВАННАЯ загрузка информации о навыках
        const items = [];
        const skillEntries = Array.from(uniqueSkills.values());
        
        // УВЕЛИЧЕННАЯ батчевая обработка для ускорения
        const BATCH_SIZE = 10; // Увеличено с 3 до 10
        for (let i = 0; i < skillEntries.length; i += BATCH_SIZE) {
          const batch = skillEntries.slice(i, i + BATCH_SIZE);
          
          console.log(`[SKILLS] Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(skillEntries.length/BATCH_SIZE)} for ${employee.employeeName}`);
          
          // Параллельная обработка внутри батча
          const batchPromises = batch.map(async (skillEntry) => {
            try {
              const skillInfo = await loadSkillInformation(skillEntry.skillId, skillEntry.matrixRowProps);
              
              return {
                pageId: skillEntry.pageId,
                name: skillInfo.name,
                description: skillInfo.description,
                current: skillEntry.current
              };
              
            } catch (skillError) {
              console.error(`[SKILLS] Error loading skill ${skillEntry.skillId}:`, skillError.message);
              
              return {
                pageId: skillEntry.pageId,
                name: `Навык ${skillEntry.skillId.substring(-8)}`,
                description: `Ошибка загрузки: ${skillError.message}`,
                current: skillEntry.current
              };
            }
          });
          
          const batchResults = await Promise.all(batchPromises);
          items.push(...batchResults);
          
          // УБРАННАЯ пауза между батчами для ускорения
          // if (i + BATCH_SIZE < skillEntries.length) {
          //   await new Promise(r => setTimeout(r, 100)); // Уменьшена с 500ms до 100ms
          // }
        }

        if (items.length > 0) {
          result.push({
            employeeId: employee.employeeId,
            employeeName: employee.employeeName,
            role: detectedRole,
            items
          });
          
          const skillNames = items.map(item => item.name).slice(0, 3).join(", ");
          console.log(`[SKILLS] ✅ Added ${items.length} skills for ${employee.employeeName} (role: ${detectedRole}). Examples: ${skillNames}`);
        } else {
          console.warn(`[SKILLS] No skills found for ${employee.employeeName} despite having ${skillEntries.length} skill entries`);
        }
      } catch (employeeError) {
        console.error(`[SKILLS] Error processing employee ${employee.employeeName}:`, employeeError.message);
        continue;
      }
    }

    console.log(`[SKILLS] Final result: ${result.length} employees with skills`);
    return result;
    
  } catch (error) {
    console.error(`[SKILLS] Critical error in fetchEmployeeSkillRowsForReviewerUser:`, error.message);
    throw error;
  }
}

// Обновление оценки
export async function updateScore(pageId, field, value) {
  const properties = {
    [field]: { number: value }
  };

  return await notionApiCall(() =>
    notion.pages.update({
      page_id: pageId,
      properties
    })
  );
}

// Установка URL страницы сотрудника
export async function setEmployeeUrl(pageId, url) {
  const properties = {
    URL: { url }
  };

  return await notionApiCall(() =>
    notion.pages.update({
      page_id: pageId,
      properties
    })
  );
}
 