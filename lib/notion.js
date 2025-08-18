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

// Упрощенный rate limiter
let lastRequest = 0;
async function simpleRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequest;
  if (timeSinceLastRequest < 300) {
    await new Promise(resolve => setTimeout(resolve, 300 - timeSinceLastRequest));
  }
  lastRequest = Date.now();
}

// Обертка для API вызовов с retry логикой
async function notionApiCall(apiCall, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await simpleRateLimit();
      const result = await apiCall();
      return result;
    } catch (error) {
      console.error(`[NOTION API] Attempt ${attempt + 1} failed:`, error.message);
      
      if (error?.status === 429) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.log(`[NOTION API] Rate limited, waiting ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      if (error?.status >= 500 && error?.status < 600 && attempt < maxRetries - 1) {
        const delay = 1000 * (attempt + 1);
        console.log(`[NOTION API] Server error, retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      throw error;
    }
  }
}

// Query всех страниц с улучшенной пагинацией
async function queryAllPages(params) {
  const pageSize = Math.min(params.page_size || 100, 100);
  let start_cursor = undefined;
  let results = [];
  let pageCount = 0;
  const maxPages = 20; // Уменьшено для Edge Runtime
  
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
      page_size: 50 // Уменьшено для стабильности
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
  const chunkSize = 10; // Уменьшено для стабильности
  
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
      page_size: 50 
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
      page_size: 50 
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
        page_size: 10
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
        page_size: 50 // Уменьшено для стабильности
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
            page_size: 50
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

    // Группируем по сотрудникам
    const employeesMap = new Map();
    
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
            console.log(`[EVALUATEES] Added employee:`, employee);
          } else {
            console.log(`[EVALUATEES] Employee ${employeeId} already in map, skipping`);
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
    console.log(`[EVALUATEES] Final result: ${result.length} employees`);
    
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

// ИСПРАВЛЕННАЯ функция загрузки информации о навыке
async function loadSkillInformation(skillId, matrixRowProps) {
  try {
    console.log(`[SKILL LOAD] Loading skill: ${skillId}`);
    
    let skillName = "Неизвестный навык";
    let skillDescription = "";
    
    // Сначала проверяем rollup поле "Описание навыка" в текущей строке матрицы
    if (matrixRowProps && matrixRowProps[PROP.skillDescription]) {
      const rollupField = matrixRowProps[PROP.skillDescription];
      console.log(`[SKILL LOAD] Found rollup field, type: ${rollupField?.type}`);
      
      if (rollupField?.type === "rollup") {
        // Обрабатываем разные типы rollup
        if (rollupField.rollup?.type === "array" && rollupField.rollup.array?.length > 0) {
          // Rollup массив
          console.log(`[SKILL LOAD] Processing rollup array with ${rollupField.rollup.array.length} items`);
          
          for (const item of rollupField.rollup.array) {
            // Ищем название в title поле
            if (item?.type === "title" && item.title?.length > 0) {
              skillName = item.title.map(t => t.plain_text).join("").trim();
              console.log(`[SKILL LOAD] Found skill name in rollup title: ${skillName}`);
            }
            
            // Ищем описание в rich_text поле
            if (item?.type === "rich_text" && item.rich_text?.length > 0) {
              const text = item.rich_text.map(t => t.plain_text).join("").trim();
              if (text && text.length > skillDescription.length) {
                skillDescription = text;
                console.log(`[SKILL LOAD] Found skill description in rollup rich_text`);
              }
            }
          }
        } else if (rollupField.rollup?.type === "title" && rollupField.rollup.title?.length > 0) {
          // Простой rollup с title
          skillName = rollupField.rollup.title.map(t => t.plain_text).join("").trim();
          console.log(`[SKILL LOAD] Found skill name in simple rollup title: ${skillName}`);
        } else if (rollupField.rollup?.type === "rich_text" && rollupField.rollup.rich_text?.length > 0) {
          // Простой rollup с rich_text
          skillDescription = rollupField.rollup.rich_text.map(t => t.plain_text).join("").trim();
          console.log(`[SKILL LOAD] Found skill description in simple rollup rich_text`);
          
          // Пытаемся извлечь название из первой строки описания
          if (skillName === "Неизвестный навык") {
            const lines = skillDescription.split('\n');
            const firstLine = lines[0]?.trim();
            if (firstLine && firstLine.length > 3 && firstLine.length < 100 && !firstLine.includes('–') && !firstLine.includes('умеет')) {
              skillName = firstLine;
              console.log(`[SKILL LOAD] Extracted name from description first line: ${skillName}`);
            }
          }
        }
      }
    }
    
    // Если не нашли название через rollup, пытаемся загрузить страницу навыка напрямую
    if (skillName === "Неизвестный навык") {
      try {
        console.log(`[SKILL LOAD] No name from rollup, trying direct page load for: ${skillId}`);
        
        const skillPage = await notionApiCall(() => 
          notion.pages.retrieve({ page_id: skillId })
        );
        
        const props = skillPage.properties || {};
        console.log(`[SKILL LOAD] Skill page properties:`, Object.keys(props));
        
        // Ищем title поле в свойствах страницы
        const pageTitle = getTitleFromProps(props);
        if (pageTitle && pageTitle.trim() && pageTitle !== "Untitled") {
          skillName = pageTitle.trim();
          console.log(`[SKILL LOAD] Found skill name from page title: ${skillName}`);
        } else {
          // Альтернативный поиск названия
          for (const [key, value] of Object.entries(props)) {
            if (value?.type === "title" && value.title?.length > 0) {
              skillName = value.title.map(t => t.plain_text).join("").trim();
              console.log(`[SKILL LOAD] Found skill name in title field ${key}: ${skillName}`);
              break;
            }
          }
        }
        
        // Если всё ещё нет описания, ищем его в свойствах страницы навыка
        if (!skillDescription) {
          for (const [key, value] of Object.entries(props)) {
            if (value?.type === "rich_text" && value.rich_text?.length > 0) {
              const keyLower = key.toLowerCase();
              if (keyLower.includes("описан") || 
                  keyLower.includes("description") ||
                  keyLower.includes("дескрипш") ||
                  keyLower.includes("content") ||
                  keyLower.includes("детал") ||
                  keyLower.includes("text")) {
                skillDescription = value.rich_text.map(t => t.plain_text).join("").trim();
                console.log(`[SKILL LOAD] Found description in field: ${key}`);
                break;
              }
            }
          }
        }
        
        console.log(`[SKILL LOAD] ✅ Loaded skill from page: ${skillName}`);
        
      } catch (pageError) {
        console.warn(`[SKILL LOAD] Failed to load skill page ${skillId}:`, pageError.message);
        
        // Пытаемся извлечь название из описания как fallback
        if (skillDescription) {
          const lines = skillDescription.split('\n');
          const firstLine = lines[0]?.trim();
          if (firstLine && firstLine.length > 0 && firstLine.length < 100 && !firstLine.includes('–')) {
            skillName = firstLine;
            console.log(`[SKILL LOAD] Extracted name from description: ${skillName}`);
          }
        }
      }
    }
    
    // Финальная проверка и очистка
    if (skillName === "Неизвестный навык" && skillDescription) {
      // Пытаемся найти название в начале описания
      const descLines = skillDescription.split(/[;\n]/);
      for (const line of descLines) {
        const cleanLine = line.trim();
        if (cleanLine.length > 3 && cleanLine.length < 80 && !cleanLine.includes('–') && !cleanLine.includes('умеет')) {
          skillName = cleanLine;
          console.log(`[SKILL LOAD] Extracted name from description line: ${skillName}`);
          break;
        }
      }
    }
    
    // Если название всё ещё не найдено, используем ID как fallback
    if (skillName === "Неизвестный навык") {
      skillName = `Навык ${skillId.substring(-8)}`;
      console.log(`[SKILL LOAD] Using fallback name: ${skillName}`);
    }
    
    console.log(`[SKILL LOAD] Final result - Name: "${skillName}", Description length: ${skillDescription.length}`);
    return { name: skillName, description: skillDescription };
    
  } catch (error) {
    console.error(`[SKILL LOAD] Critical error loading skill ${skillId}:`, error.message);
    return { 
      name: `Навык ${skillId.substring(-8)}`, 
      description: `Ошибка загрузки: ${error.message}` 
    };
  }
}

// ИСПРАВЛЕННАЯ основная функция загрузки навыков
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
          page_size: 50 // Уменьшено для стабильности
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

        // Загружаем информацию о навыках с контролем скорости
        const items = [];
        const skillEntries = Array.from(uniqueSkills.values());
        
        // Батчевая обработка для оптимизации
        const BATCH_SIZE = 2; // Уменьшено для стабильности Edge Runtime
        for (let i = 0; i < skillEntries.length; i += BATCH_SIZE) {
          const batch = skillEntries.slice(i, i + BATCH_SIZE);
          
          console.log(`[SKILLS] Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(skillEntries.length/BATCH_SIZE)} for ${employee.employeeName}`);
          
          for (const skillEntry of batch) {
            try {
              const skillInfo = await loadSkillInformation(skillEntry.skillId, skillEntry.matrixRowProps);
              
              items.push({
                pageId: skillEntry.pageId,
                name: skillInfo.name,
                description: skillInfo.description,
                current: skillEntry.current
              });
              
              console.log(`[SKILLS] ✅ Loaded skill: ${skillInfo.name}`);
              
            } catch (skillError) {
              console.error(`[SKILLS] Error loading skill ${skillEntry.skillId}:`, skillError.message);
              
              items.push({
                pageId: skillEntry.pageId,
                name: `Навык ${skillEntry.skillId.substring(-8)}`,
                description: `Ошибка загрузки: ${skillError.message}`,
                current: skillEntry.current
              });
            }
          }
          
          // Пауза между батчами для снижения нагрузки на Notion API
          if (i + BATCH_SIZE < skillEntries.length) {
            await new Promise(r => setTimeout(r, 800)); // Увеличена пауза
          }
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
