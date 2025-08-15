import { Client } from "@notionhq/client";

export const notion = new Client({
  auth: process.env.NOTION_TOKEN,
  // Убираем кастомный fetch для Edge Runtime
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

// ... остальной код без изменений
export const PROP = {
  // БД "Оценки компетенций" (Matrix)
  employee: "Сотрудник",
  cycle: "Цикл",
  skill: "Навык",
  role: "Роль",
  
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
  
  // Расчетные поля
  weightedSum: "Взвешенная сумма",
  totalWeight: "Общий вес",
  finalScore: "Общая оценка",
  
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

// Query всех страниц с пагинацией
async function queryAllPages(params) {
  const pageSize = Math.min(params.page_size || 100, 100);
  let start_cursor = undefined;
  let results = [];
  
  do {
    const res = await notionApiCall(() => 
      notion.databases.query({ 
        ...params, 
        start_cursor, 
        page_size: pageSize 
      })
    );
    
    results.push(...(res.results || []));
    start_cursor = res.has_more ? res.next_cursor : undefined;
  } while (start_cursor);
  
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
  
  const teamProps = await getDbProps(EMPLOYEES_DB_ID);
  const def = teamProps[PROP.team];
  if (!def) {
    console.error(`[SEARCH] Team property "${PROP.team}" not found in employees database`);
    return [];
  }
  
  const norm = (s) => (s || "").toString().trim().toLowerCase().replace(/\s+/g, " ");
  const q = norm(teamName);
  
  let filter = null;
  
  if (def.type === "select" || def.type === "multi_select") {
    const opts = (def[def.type]?.options || []).map(o => o?.name).filter(Boolean);
    let match = opts.find(n => norm(n) === q);
    
    if (!match) {
      const cand = opts.filter(n => norm(n).includes(q));
      if (cand.length === 1) match = cand[0];
    }
    
    if (match) {
      if (def.type === "select") {
        filter = { property: PROP.team, select: { equals: match } };
      } else {
        filter = { property: PROP.team, multi_select: { contains: match } };
      }
    }
  } else if (def.type === "rich_text") {
    filter = { property: PROP.team, rich_text: { contains: teamName } };
  } else if (def.type === "title") {
    filter = { property: PROP.team, title: { contains: teamName } };
  }
  
  if (!filter) {
    console.warn(`[SEARCH] Could not create filter for team "${teamName}"`);
    return [];
  }
  
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

  const matrixProps = await getDbProps(MATRIX_DB_ID);
  const reviewersSet = new Set();

  const empDef = matrixProps?.[PROP.employee];
  if (!empDef) {
    console.error(`[REVIEWERS] Employee property "${PROP.employee}" not found in matrix database`);
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
    role: 'peer' // Добавляем роль по умолчанию
  }));
}

// Остальные функции остаются без изменений...
export async function listEvaluateesForReviewerUser(userId) {
  // ... (код остается тем же)
}

export async function fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId) {
  // ... (код остается тем же)
}

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