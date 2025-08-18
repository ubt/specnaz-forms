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

// ОПТИМИЗИРОВАННАЯ обертка для API вызовов (убраны искусственные задержки)
async function notionApiCall(apiCall, maxRetries = 2) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await apiCall();
      return result;
    } catch (error) {
      console.error(`[NOTION API] Attempt ${attempt + 1} failed:`, error.message);
      
      if (error?.status === 429) {
        // Только при rate limiting делаем паузу
        const delay = Math.min(1000 * Math.pow(2, attempt), 3000);
        console.log(`[NOTION API] Rate limited, waiting ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      if (error?.status >= 500 && error?.status < 600 && attempt < maxRetries - 1) {
        // Короткая пауза при серверных ошибках
        const delay = 500 * (attempt + 1);
        console.log(`[NOTION API] Server error, retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      throw error;
    }
  }
}

// ОПТИМИЗИРОВАННАЯ Query всех страниц с увеличенными лимитами
async function queryAllPages(params) {
  const pageSize = Math.min(params.page_size || 100, 100);
  let start_cursor = undefined;
  let results = [];
  let pageCount = 0;
  const maxPages = 100; // Увеличено для поддержки больших БД
  
  console.log(`[QUERY ALL] Starting optimized query with filters:`, JSON.stringify(params.filter, null, 2));
  
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
  const cached = getCached(cacheKey);
  if (cached) return cached;
  
  const db = await notionApiCall(() => 
    notion.databases.retrieve({ database_id: dbId })
  );
  
  setCached(cacheKey, db.properties);
  return db.properties;
}

// Поиск сотрудников по команде (без изменений)
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
  const chunkSize = 30; // Увеличен размер чанка для оптимизации
  
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

// Определение роли ревьюера на строке
export function computeRoleOnRow(row, reviewerCtx, matrixProps) {
  if (!row?.properties || !reviewerCtx?.userId || !matrixProps) {
    console.warn('[ROLE] Missing required parameters for role computation');
    return null;
  }
  
  const p = row.properties;
  const userId = reviewerCtx.userId;
  const pageIds = reviewerCtx.pageIds || [];
  
  console.log(`[ROLE] Computing role for userId: ${userId}, pageIds: ${pageIds.length}`);
  
  // 1. Проверяем Self (самооценка)
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
  
  // 2. Проверяем Manager
  const managerPeople = p[PROP.managerScorer]?.people || [];
  if (managerPeople.some(u => u?.id === userId)) {
    console.log(`[ROLE] Found manager role`);
    return "manager";
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
        page_size: 20 // Увеличен лимит
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
      
      // Стратегия 2: Fallback к индивидуальным запросам
      console.log(`[EVALUATEES] Strategy 2: Fallback to individual filter execution`);
      
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
      console.warn(`[EVALUATEES] No matrix rows found for reviewer ${userId} - trying diagnostic query`);
      
      // Диагностическая информация - проверяем есть ли вообще данные в матрице
      try {
        const sampleRows = await queryAllPages({
          database_id: MATRIX_DB_ID,
          page_size: 10
        });
        console.log(`[EVALUATEES] Matrix contains ${sampleRows.length} total rows (sample check)`);
        
        if (sampleRows.length > 0) {
          console.log(`[EVALUATEES] Sample row debug:`, {
            sampleRowId: sampleRows[0].id,
            sampleProperties: Object.keys(sampleRows[0].properties || {}),
            reviewerIdLength: userId.length,
            reviewerIdFormat: userId.substring(0, 8) + '...'
          });
        }
      } catch (sampleError) {
        console.error(`[EVALUATEES] Failed to get sample rows:`, sampleError.message);
      }
      
      return [];
    }

    // Группируем по сотрудникам с улучшенной логикой
    const employeesMap = new Map();
    
    for (const row of uniqueRows) {
      try {
        const role = computeRoleOnRow(row, reviewerCtx, matrixProps);
        
        if (!role) {
          console.log(`[EVALUATEES] No role computed for row ${row.id} - skipping`);
          continue;
        }

        console.log(`[EVALUATEES] Found role ${role} for row ${row.id}`);

        // Получаем ID сотрудника
        let employeeId = null, employeeName = null;
        const p = row.properties;
        
        if (empDef?.type === "relation") {
          const rel = p[PROP.employee]?.relation;
          employeeId = rel?.[0]?.id;
          
          if (employeeId && !employeesMap.has(employeeId)) {
            try {
              const page = await notionApiCall(() => notion.pages.retrieve({ page_id: employeeId }));
              employeeName = getTitleFromProps(page.properties || {}) || employeeId;
              console.log(`[EVALUATEES] Loaded employee name from relation: ${employeeName}`);
            } catch (error) {
              console.error(`[EVALUATEES] Failed to load employee ${employeeId}:`, error.message);
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
          } else {
            console.log(`[EVALUATEES] Employee ${employeeId} already in map, role: ${employeesMap.get(employeeId).role}`);
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

// НОВЫЕ ОПТИМИЗИРОВАННЫЕ ФУНКЦИИ

// Быстрая загрузка информации о ревьюере
export async function getReviewerInfo(reviewerUserId) {
  console.log(`[REVIEWER INFO] Загрузка информации о ревьюере: ${reviewerUserId}`);
  
  try {
    // Сначала пытаемся найти в базе сотрудников
    const employeePages = await getEmployeePagesByUserId(reviewerUserId);
    
    if (employeePages.length > 0) {
      return {
        name: employeePages[0].name,
        userId: reviewerUserId,
        source: 'employee_db'
      };
    }

    // Если не найден в базе сотрудников, загружаем через Notion Users API
    try {
      const user = await notionApiCall(() => notion.users.retrieve({ user_id: reviewerUserId }));
      return {
        name: user.name || `Пользователь ${reviewerUserId.substring(0, 8)}`,
        userId: reviewerUserId,
        source: 'notion_api'
      };
    } catch (userError) {
      console.warn(`[REVIEWER INFO] Не удалось загрузить пользователя из API:`, userError.message);
      return {
        name: `Ревьюер ${reviewerUserId.substring(0, 8)}`,
        userId: reviewerUserId,
        source: 'fallback'
      };
    }
  } catch (error) {
    console.error(`[REVIEWER INFO] Ошибка загрузки информации о ревьюере:`, error.message);
    return {
      name: `Ревьюер ${reviewerUserId.substring(0, 8)}`,
      userId: reviewerUserId,
      source: 'error_fallback'
    };
  }
}

// Оптимизированная загрузка навыков для ревьюера
export async function fetchOptimizedSkillsForReviewer(employees, reviewerUserId, role) {
  console.log(`[OPTIMIZED SKILLS] Начинаем быструю загрузку для ${employees.length} сотрудников`);
  
  try {
    const matrixProps = await getDbProps(MATRIX_DB_ID);
    const myPages = await getEmployeePagesByUserId(reviewerUserId);
    const reviewerCtx = { userId: reviewerUserId, pageIds: myPages.map(x => x.pageId) };

    // Собираем все ID сотрудников для одного большого запроса
    const allEmployeeIds = employees.map(e => e.employeeId);
    console.log(`[OPTIMIZED SKILLS] Собираем данные для сотрудников:`, allEmployeeIds);

    // Один большой запрос для всех сотрудников сразу
    const empDef = matrixProps[PROP.employee];
    let employeeFilters = [];
    
    if (empDef?.type === "relation") {
      employeeFilters = allEmployeeIds.map(id => ({ 
        property: PROP.employee, 
        relation: { contains: id } 
      }));
    } else if (empDef?.type === "people") {
      employeeFilters = allEmployeeIds.map(id => ({ 
        property: PROP.employee, 
        people: { contains: id } 
      }));
    }

    if (!employeeFilters.length) {
      console.warn('[OPTIMIZED SKILLS] Не удалось создать фильтры для сотрудников');
      return [];
    }

    // Один массивный запрос для всех данных
    const combinedFilter = employeeFilters.length === 1 ? employeeFilters[0] : { or: employeeFilters };
    
    console.log(`[OPTIMIZED SKILLS] Выполняем единый запрос для всех сотрудников...`);
    const allRows = await queryAllPages({
      database_id: MATRIX_DB_ID,
      filter: combinedFilter,
      page_size: 100
    });

    console.log(`[OPTIMIZED SKILLS] Получено ${allRows.length} строк матрицы`);

    // Фильтруем только релевантные строки для ревьюера
    const relevantRows = allRows.filter(row => {
      const detectedRole = computeRoleOnRow(row, reviewerCtx, matrixProps);
      return detectedRole !== null;
    });

    console.log(`[OPTIMIZED SKILLS] Релевантных строк для ревьюера: ${relevantRows.length}`);

    if (!relevantRows.length) {
      console.warn('[OPTIMIZED SKILLS] Нет релевантных строк для ревьюера');
      return [];
    }

    // Собираем уникальные ID навыков для пакетной загрузки
    const uniqueSkillIds = new Set();
    const skillToRowMap = new Map();

    for (const row of relevantRows) {
      const skillRel = row.properties[PROP.skill]?.relation;
      const skillId = skillRel?.[0]?.id;
      
      if (skillId) {
        uniqueSkillIds.add(skillId);
        if (!skillToRowMap.has(skillId)) {
          skillToRowMap.set(skillId, []);
        }
        skillToRowMap.get(skillId).push(row);
      }
    }

    console.log(`[OPTIMIZED SKILLS] Найдено ${uniqueSkillIds.size} уникальных навыков`);

    // Пакетная загрузка информации о навыках
    const skillInfoMap = await loadSkillsBatch(Array.from(uniqueSkillIds));

    // Формируем финальный список
    const result = [];
    const field = ROLE_TO_FIELD[role] || ROLE_TO_FIELD.peer;

    for (const [skillId, rows] of skillToRowMap) {
      const skillInfo = skillInfoMap.get(skillId);
      if (!skillInfo) continue;

      // Берем первую строку для этого навыка
      const row = rows[0];
      const props = row.properties;
      const current = props[field]?.number ?? null;

      // Определяем сотрудника
      let employeeInfo = null;
      const empRel = props[PROP.employee]?.relation;
      const empPeople = props[PROP.employee]?.people;
      
      if (empDef?.type === "relation" && empRel?.[0]?.id) {
        employeeInfo = employees.find(e => e.employeeId === empRel[0].id);
      } else if (empDef?.type === "people" && empPeople?.[0]?.id) {
        employeeInfo = employees.find(e => e.employeeId === empPeople[0].id);
      }

      if (employeeInfo) {
        result.push({
          pageId: row.id,
          name: skillInfo.name,
          description: skillInfo.description,
          current: current,
          comment: "",
          employeeId: employeeInfo.employeeId,
          employeeName: employeeInfo.employeeName,
          role: employeeInfo.role
        });
      }
    }

    console.log(`[OPTIMIZED SKILLS] ✅ Подготовлено ${result.length} навыков для оценки`);
    return result;

  } catch (error) {
    console.error(`[OPTIMIZED SKILLS] Критическая ошибка:`, error.message);
    throw error;
  }
}

// Пакетная загрузка информации о навыках
async function loadSkillsBatch(skillIds) {
  console.log(`[SKILLS BATCH] Загружаем информацию о ${skillIds.length} навыках`);
  
  const skillInfoMap = new Map();
  const BATCH_SIZE = 8; // Увеличен размер батча для оптимизации
  
  for (let i = 0; i < skillIds.length; i += BATCH_SIZE) {
    const batch = skillIds.slice(i, i + BATCH_SIZE);
    console.log(`[SKILLS BATCH] Обрабатываем пакет ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(skillIds.length/BATCH_SIZE)}`);
    
    // Параллельная загрузка пакета
    const batchPromises = batch.map(async (skillId) => {
      try {
        const skillPage = await notionApiCall(() => 
          notion.pages.retrieve({ page_id: skillId })
        );
        
        const props = skillPage.properties || {};
        const name = getTitleFromProps(props) || `Навык ${skillId.substring(-8)}`;
        
        // Ищем описание в свойствах
        let description = "";
        for (const [key, value] of Object.entries(props)) {
          if (value?.type === "rich_text" && value.rich_text?.length > 0) {
            const keyLower = key.toLowerCase();
            if (keyLower.includes("описан") || keyLower.includes("description")) {
              description = value.rich_text.map(t => t.plain_text).join("");
              break;
            }
          }
        }
        
        return { skillId, name, description };
      } catch (error) {
        console.warn(`[SKILLS BATCH] Ошибка загрузки навыка ${skillId}:`, error.message);
        return { 
          skillId, 
          name: `Навык ${skillId.substring(-8)}`, 
          description: `Ошибка загрузки: ${error.message}` 
        };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    // Сохраняем результаты
    for (const result of batchResults) {
      skillInfoMap.set(result.skillId, {
        name: result.name,
        description: result.description
      });
    }
  }
  
  console.log(`[SKILLS BATCH] ✅ Загружена информация о ${skillInfoMap.size} навыках`);
  return skillInfoMap;
}

// Пакетное обновление оценок
export async function batchUpdateScores(items, scoreField) {
  console.log(`[BATCH UPDATE] Начинаем пакетное обновление ${items.length} записей`);
  
  let successful = 0;
  let failed = 0;
  const errors = [];
  
  // Обрабатываем по 5 элементов параллельно для оптимальной скорости
  const BATCH_SIZE = 5;
  
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    
    const batchPromises = batch.map(async (item) => {
      try {
        await notionApiCall(() =>
          notion.pages.update({
            page_id: item.pageId,
            properties: {
              [scoreField]: { number: item.value }
            }
          })
        );
        return { success: true, pageId: item.pageId };
      } catch (error) {
        console.error(`[BATCH UPDATE] Ошибка обновления ${item.pageId}:`, error.message);
        return { success: false, pageId: item.pageId, error: error.message };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    // Подсчитываем результаты
    for (const result of batchResults) {
      if (result.success) {
        successful++;
      } else {
        failed++;
        errors.push({ pageId: result.pageId, error: result.error });
      }
    }
    
    console.log(`[BATCH UPDATE] Пакет ${Math.floor(i/BATCH_SIZE) + 1}: ${successful}/${successful + failed} успешно`);
  }
  
  console.log(`[BATCH UPDATE] ✅ Завершено: ${successful} успешно, ${failed} ошибок`);
  
  return {
    successful,
    failed,
    errors: errors.length > 0 ? errors : undefined
  };
}

// Обновление оценки (legacy функция для обратной совместимости)
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

// ОРИГИНАЛЬНАЯ функция загрузки навыков (для обратной совместимости)
export async function fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId) {
  console.log(`[LEGACY SKILLS] DEPRECATED: Используется старая функция загрузки навыков`);
  
  try {
    const matrixProps = await getDbProps(MATRIX_DB_ID);
    const myPages = await getEmployeePagesByUserId(reviewerUserId);
    const reviewerCtx = { userId: reviewerUserId, pageIds: myPages.map(x => x.pageId) };

    const result = [];
    
    for (const employee of employees) {
      console.log(`[LEGACY SKILLS] Processing employee: ${employee.employeeName} (${employee.employeeId})`);
      
      try {
        // Строим фильтр для конкретного сотрудника
        let employeeFilter;
        const empDef = matrixProps[PROP.employee];
        
        if (empDef?.type === "relation") {
          employeeFilter = { property: PROP.employee, relation: { contains: employee.employeeId } };
        } else if (empDef?.type === "people") {
          employeeFilter = { property: PROP.employee, people: { contains: employee.employeeId } };
        } else {
          console.warn(`[LEGACY SKILLS] Unsupported employee field type: ${empDef?.type}`);
          continue;
        }

        // Получаем все строки для этого сотрудника
        const employeeRows = await queryAllPages({
          database_id: MATRIX_DB_ID,
          filter: employeeFilter,
          page_size: 100
        });

        console.log(`[LEGACY SKILLS] Found ${employeeRows.length} rows for employee ${employee.employeeName}`);

        if (!employeeRows.length) {
          console.warn(`[LEGACY SKILLS] No matrix rows found for employee ${employee.employeeName}`);
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
          console.warn(`[LEGACY SKILLS] No role found for reviewer ${reviewerUserId} for employee ${employee.employeeName}`);
          continue;
        }

        console.log(`[LEGACY SKILLS] Detected role: ${detectedRole} for employee ${employee.employeeName}`);

        // Собираем уникальные навыки
        const uniqueSkills = new Map();
        const field = ROLE_TO_FIELD[detectedRole];
        
        for (const row of relevantRows) {
          const props = row.properties;
          const skillRel = props[PROP.skill]?.relation;
          const skillId = skillRel?.[0]?.id;
          
          if (!skillId) continue;
          
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

        // Загружаем информацию о навыках
        const items = [];
        for (const skillEntry of uniqueSkills.values()) {
          try {
            const skillPage = await notionApiCall(() => 
              notion.pages.retrieve({ page_id: skillEntry.skillId })
            );
            
            const props = skillPage.properties || {};
            const name = getTitleFromProps(props) || `Навык ${skillEntry.skillId.substring(-8)}`;
            
            let description = "";
            for (const [key, value] of Object.entries(props)) {
              if (value?.type === "rich_text" && value.rich_text?.length > 0) {
                const keyLower = key.toLowerCase();
                if (keyLower.includes("описан") || keyLower.includes("description")) {
                  description = value.rich_text.map(t => t.plain_text).join("");
                  break;
                }
              }
            }
            
            items.push({
              pageId: skillEntry.pageId,
              name,
              description,
              current: skillEntry.current,
              comment: ""
            });
            
          } catch (skillError) {
            console.error(`[LEGACY SKILLS] Error loading skill ${skillEntry.skillId}:`, skillError.message);
            items.push({
              pageId: skillEntry.pageId,
              name: `Навык ${skillEntry.skillId.substring(-8)}`,
              description: `Ошибка загрузки: ${skillError.message}`,
              current: skillEntry.current,
              comment: ""
            });
          }
        }

        if (items.length > 0) {
          result.push({
            employeeId: employee.employeeId,
            employeeName: employee.employeeName,
            role: detectedRole,
            items
          });
        }
      } catch (employeeError) {
        console.error(`[LEGACY SKILLS] Error processing employee ${employee.employeeName}:`, employeeError.message);
        continue;
      }
    }

    console.log(`[LEGACY SKILLS] Final result: ${result.length} employees with skills`);
    return result;
    
  } catch (error) {
    console.error(`[LEGACY SKILLS] Critical error:`, error.message);
    throw error;
  }
}