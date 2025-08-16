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
  skillDescription: "Описание навыка", // Добавляем недостающее свойство
  
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
  const maxPages = 50; // Ограничение для безопасности
  
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

// Определение роли ревьюера на строке
export function computeRoleOnRow(row, reviewerCtx, matrixProps) {
  if (!row?.properties || !reviewerCtx?.userId || !matrixProps) {
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

// Получение страниц сотрудника по User ID
export async function getEmployeePagesByUserId(userId) {
  const props = await getDbProps(EMPLOYEES_DB_ID);
  if (props[PROP.empAccount]?.type !== "people") {
    return [];
  }
  
  const res = await notionApiCall(() => 
    notion.databases.query({
      database_id: EMPLOYEES_DB_ID,
      filter: { property: PROP.empAccount, people: { contains: userId } },
      page_size: 10
    })
  );
  
  return res.results.map(row => ({
    pageId: row.id,
    name: getTitleFromProps(row.properties || {}) || row.id
  }));
}

// Поиск сотрудников для оценки ревьюером
export async function listEvaluateesForReviewerUser(userId) {
  console.log(`[EVALUATEES] Starting search for reviewer: ${userId}`);
  
  try {
    const matrixProps = await getDbProps(MATRIX_DB_ID);
    console.log(`[EVALUATEES] Matrix DB properties loaded`);
    
    const myPages = await getEmployeePagesByUserId(userId);
    const myPageIds = myPages.map(x => x.pageId);
    const reviewerCtx = { userId, pageIds: myPageIds };

    console.log(`[EVALUATEES] Reviewer context:`, { userId, myPageIds });

    // Собираем все возможные фильтры для ревьюера
    const allFilters = [];
    
    // Добавляем фильтры для ролей scorer
    [PROP.selfScorer, PROP.p1Peer, PROP.p2Peer, PROP.managerScorer].forEach(field => {
      const def = matrixProps[field];
      if (def?.type === "people") {
        allFilters.push({ property: field, people: { contains: userId } });
        console.log(`[EVALUATEES] Added filter for ${field}`);
      } else {
        console.log(`[EVALUATEES] Skipped ${field}, type: ${def?.type || 'undefined'}`);
      }
    });
    
    // Добавляем фильтр для employee (для самооценки)
    const empDef = matrixProps[PROP.employee];
    console.log(`[EVALUATEES] Employee field type: ${empDef?.type}`);
    
    if (empDef?.type === "people") {
      allFilters.push({ property: PROP.employee, people: { contains: userId } });
      console.log(`[EVALUATEES] Added employee people filter`);
    } else if (empDef?.type === "relation" && myPageIds.length > 0) {
      myPageIds.forEach(pageId => {
        allFilters.push({ property: PROP.employee, relation: { contains: pageId } });
      });
      console.log(`[EVALUATEES] Added employee relation filters: ${myPageIds.length}`);
    }

    if (!allFilters.length) {
      console.warn('[EVALUATEES] No valid filters created');
      console.log('[EVALUATEES] Available matrix properties:', Object.keys(matrixProps));
      return [];
    }

    console.log(`[EVALUATEES] Created ${allFilters.length} filters`);

    const allRows = await queryAllPages({
      database_id: MATRIX_DB_ID,
      filter: { or: allFilters },
      page_size: 100
    });

    console.log(`[EVALUATEES] Found ${allRows.length} matrix rows`);

    const employeesMap = new Map();
    
    for (const row of allRows) {
      try {
        const role = computeRoleOnRow(row, reviewerCtx, matrixProps);
        
        if (!role) {
          console.log(`[EVALUATEES] No role found for row ${row.id}`);
          continue;
        }

        console.log(`[EVALUATEES] Found role ${role} for row ${row.id}`);

        // Получаем ID сотрудника
        let employeeId = null, employeeName = null;
        const p = row.properties;
        
        if (empDef?.type === "relation") {
          const rel = p[PROP.employee]?.relation;
          employeeId = rel?.[0]?.id;
          console.log(`[EVALUATEES] Employee ID from relation: ${employeeId}`);
          
          if (employeeId && !employeesMap.has(employeeId)) {
            try {
              const page = await notionApiCall(() => notion.pages.retrieve({ page_id: employeeId }));
              employeeName = getTitleFromProps(page.properties || {}) || employeeId;
            } catch (error) {
              console.error(`[EVALUATEES] Failed to load employee ${employeeId}:`, error.message);
              employeeName = employeeId;
            }
          }
        } else if (empDef?.type === "people") {
          const ppl = p[PROP.employee]?.people;
          employeeId = ppl?.[0]?.id;
          console.log(`[EVALUATEES] Employee ID from people: ${employeeId}`);
          
          if (employeeId && !employeesMap.has(employeeId)) {
            const nameMap = await getEmployeeNamesByUserIds([employeeId]);
            employeeName = nameMap.get(employeeId) || employeeId;
          }
        }

        if (employeeId) {
          if (!employeesMap.has(employeeId)) {
            const employee = {
              employeeId,
              employeeName: employeeName || employeesMap.get(employeeId)?.employeeName || employeeId,
              role
            };
            employeesMap.set(employeeId, employee);
            console.log(`[EVALUATEES] Added employee:`, employee);
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
    console.error(`[EVALUATEES] Critical error:`, error.message, error.stack);
    throw error;
  }
}

async function batchLoadSkillsData(rows) {
  const skillIds = new Set();
  
  for (const row of rows) {
    const skillRel = row.properties[PROP.skill]?.relation;
    if (skillRel?.length > 0) {
      skillIds.add(skillRel[0].id);
    }
  }
  
  if (skillIds.size === 0) return new Map();
  
  console.log(`[SKILLS BATCH] Loading ${skillIds.size} skills`);
  
  const skillsMap = new Map();
  const skillsArray = Array.from(skillIds);
  
  const BATCH_SIZE = 3; // Уменьшаем размер батча для стабильности
  
  for (let i = 0; i < skillsArray.length; i += BATCH_SIZE) {
    const batch = skillsArray.slice(i, i + BATCH_SIZE);
    console.log(`[SKILLS BATCH] Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(skillsArray.length/BATCH_SIZE)}: ${batch.length} skills`);
    
    const promises = batch.map(async (skillId) => {
      try {
        await simpleRateLimit(); // Добавляем rate limiting
        
        const skillPage = await notionApiCall(() => 
          notion.pages.retrieve({ page_id: skillId })
        );
        
        console.log(`[SKILLS BATCH] ✅ Loaded skill ${skillId}`);
        return { skillId, skillPage, success: true };
        
      } catch (error) {
        console.error(`[SKILLS BATCH] ❌ Failed to load skill ${skillId}:`, error.message);
        
        // Пытаемся получить базовую информацию из других источников
        let fallbackName = "Неизвестный навык";
        
        // Можно попробовать найти название в связанных записях
        try {
          // Ищем записи в матрице, которые ссылаются на этот навык
          const matrixRows = await queryAllPages({
            database_id: MATRIX_DB_ID,
            filter: {
              property: PROP.skill,
              relation: { contains: skillId }
            },
            page_size: 5
          });
          
          if (matrixRows.length > 0) {
            // Пытаемся найти описание навыка в свойствах матрицы
            const firstRow = matrixRows[0];
            const description = firstRow.properties[PROP.skillDescription];
            if (description?.rich_text?.length > 0) {
              fallbackName = description.rich_text.map(t => t.plain_text).join("").substring(0, 50) || fallbackName;
            }
          }
        } catch (fallbackError) {
          console.warn(`[SKILLS BATCH] Fallback failed for ${skillId}:`, fallbackError.message);
        }
        
        return { 
          skillId, 
          error: error.message, 
          success: false,
          fallbackName 
        };
      }
    });
    
    const results = await Promise.all(promises);
    
    for (const result of results) {
      const { skillId, skillPage, success, error, fallbackName } = result;
      
      if (success && skillPage) {
        const props = skillPage.properties;
        const name = getTitleFromProps(props) || "Навык";
        
        let description = "";
        // Ищем поле с описанием навыка
        for (const [key, value] of Object.entries(props)) {
          if (value?.type === "rich_text") {
            const keyLower = key.toLowerCase();
            if (keyLower.includes("описан") || 
                keyLower.includes("description") ||
                keyLower.includes("дескрипш") ||
                keyLower.includes("content") ||
                keyLower.includes("детал")) {
              description = value.rich_text?.map(t => t.plain_text).join("") || "";
              break;
            }
          }
        }
        
        skillsMap.set(skillId, { name, description });
        console.log(`[SKILLS BATCH] ✅ Processed skill: ${name}`);
        
      } else {
        // Используем fallback название если есть, иначе дефолтное
        const name = fallbackName || "Навык (недоступен)";
        skillsMap.set(skillId, { name, description: `Ошибка загрузки: ${error || 'неизвестная'}` });
        console.log(`[SKILLS BATCH] ⚠️ Used fallback for skill: ${name}`);
      }
    }
    
    // Увеличенная пауза между батчами для стабильности
    if (i + BATCH_SIZE < skillsArray.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  console.log(`[SKILLS BATCH] Completed loading ${skillsMap.size}/${skillIds.size} skills`);
  return skillsMap;
}

// Основная функция загрузки навыков для ревьюера
export async function fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId) {
  console.log(`[SKILLS] Starting skill loading for ${employees.length} employees, reviewer: ${reviewerUserId}`);
  
  try {
    const matrixProps = await getDbProps(MATRIX_DB_ID);
    const myPages = await getEmployeePagesByUserId(reviewerUserId);
    const reviewerCtx = { userId: reviewerUserId, pageIds: myPages.map(x => x.pageId) };

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

        // Определяем роль ревьюера и фильтруем релевантные строки
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

        // Загружаем навыки для релевантных строк
        const skillsMap = await batchLoadSkillsData(relevantRows);

        const items = [];
        for (const row of relevantRows) {
          try {
            const props = row.properties;
            const field = ROLE_TO_FIELD[detectedRole];
            const current = props[field]?.number ?? null;
            
            console.log(`[SKILLS] Row ${row.id}: field=${field}, current=${current}`);
            
            // Получаем данные навыка
            const skillRel = props[PROP.skill]?.relation;
            const skillId = skillRel?.[0]?.id;
            
            if (!skillId) {
              console.warn(`[SKILLS] No skill ID found in row ${row.id}`);
              continue;
            }
            
            const skillData = skillsMap.get(skillId) || { name: "Неизвестный навык", description: "" };
            
            items.push({ 
              pageId: row.id, 
              name: skillData.name,
              description: skillData.description,
              current,
              comment: ""
            });
            
            console.log(`[SKILLS] Added skill: ${skillData.name} (current: ${current}) for role: ${detectedRole}`);
          } catch (itemError) {
            console.error(`[SKILLS] Error processing skill row ${row.id}:`, itemError.message);
            continue;
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

    console.log(`[SKILLS] Final result: ${result.length} employees with skills`);
    return result;
    
  } catch (error) {
    console.error(`[SKILLS] Critical error in fetchEmployeeSkillRowsForReviewerUser:`, error.message, error.stack);
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