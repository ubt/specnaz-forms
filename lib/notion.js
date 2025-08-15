import { Client } from "@notionhq/client";

export const notion = new Client({
  auth: process.env.NOTION_TOKEN,
  fetch: (input, init) => fetch(input, init)
});

export const MATRIX_DB_ID = process.env.MATRIX_DB_ID;
export const EMPLOYEES_DB_ID = process.env.EMPLOYEES_DB_ID;

// Имена колонок
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

// Многоуровневая система кэширования
class NotionCache {
  constructor() {
    this.dbProps = new Map();
    this.pages = new Map();
    this.users = new Map();
    this.skills = new Map();
    
    this.TTL = {
      dbProps: 10 * 60 * 1000,  // 10 минут
      pages: 5 * 60 * 1000,     // 5 минут
      users: 15 * 60 * 1000,    // 15 минут
      skills: 30 * 60 * 1000,   // 30 минут
    };
  }
  
  isExpired(item, ttl) {
    return !item || (Date.now() - item.timestamp > ttl);
  }
  
  set(cache, key, data) {
    cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }
  
  get(cache, key, ttl) {
    const item = cache.get(key);
    if (this.isExpired(item, ttl)) {
      cache.delete(key);
      return null;
    }
    return item.data;
  }
  
  cleanup() {
    const now = Date.now();
    for (const [cache, ttl] of [
      [this.dbProps, this.TTL.dbProps],
      [this.pages, this.TTL.pages],
      [this.users, this.TTL.users],
      [this.skills, this.TTL.skills]
    ]) {
      for (const [key, item] of cache.entries()) {
        if (now - item.timestamp > ttl) {
          cache.delete(key);
        }
      }
    }
  }
}

const notionCache = new NotionCache();

// Адаптивный Rate Limiter
class SmartRateLimit {
  constructor() {
    this.requests = [];
    this.errors = [];
    this.currentDelay = 200;
    this.minDelay = 150;
    this.maxDelay = 5000;
    this.windowMs = 60000;
    this.maxRpm = 180;
    this.errorThreshold = 3;
  }
  
  cleanOldRecords() {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    this.requests = this.requests.filter(t => t > cutoff);
    this.errors = this.errors.filter(t => t > cutoff);
  }
  
  adaptDelay() {
    const errorRate = this.errors.length;
    const requestRate = this.requests.length;
    
    if (errorRate >= this.errorThreshold) {
      this.currentDelay = Math.min(this.currentDelay * 1.5, this.maxDelay);
    } else if (requestRate > this.maxRpm * 0.8) {
      this.currentDelay = Math.min(this.currentDelay * 1.2, this.maxDelay);
    } else if (errorRate === 0 && requestRate < this.maxRpm * 0.5) {
      this.currentDelay = Math.max(this.currentDelay * 0.95, this.minDelay);
    }
  }
  
  async wait() {
    this.cleanOldRecords();
    this.adaptDelay();
    
    const now = Date.now();
    const recentRequests = this.requests.filter(t => now - t < 1000);
    
    if (recentRequests.length >= 5) {
      await new Promise(r => setTimeout(r, 500));
    }
    
    await new Promise(r => setTimeout(r, this.currentDelay));
    this.requests.push(Date.now());
  }
  
  recordError(error) {
    this.errors.push(Date.now());
    if (error?.status === 429) {
      this.currentDelay = Math.min(this.currentDelay * 2, this.maxDelay);
    }
  }
  
  recordSuccess() {
    // Адаптация происходит в adaptDelay()
  }
}

const smartRateLimit = new SmartRateLimit();

// Обработчик ошибок
class NotionErrorHandler {
  static handle(error, context = {}) {
    const errorInfo = {
      message: error?.message || "Неизвестная ошибка",
      status: error?.status,
      context,
      timestamp: new Date().toISOString()
    };
    
    console.error("[NOTION ERROR]", errorInfo);
    
    switch (error?.status) {
      case 400:
        return { error: "Некорректные данные запроса", retry: false };
      case 401:
        return { error: "Ошибка авторизации", retry: false };
      case 403:
        return { error: "Доступ запрещен", retry: false };
      case 404:
        return { error: "Ресурс не найден", retry: false };
      case 429:
        return { error: "Превышен лимит запросов", retry: true };
      case 500:
      case 502:
      case 503:
      case 504:
        return { error: "Ошибка сервера Notion", retry: true };
      default:
        return { error: "Неожиданная ошибка", retry: true };
    }
  }
}

// Оптимизированная обертка для API вызовов
async function notionApiCallOptimized(apiCall, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await smartRateLimit.wait();
      const result = await apiCall();
      smartRateLimit.recordSuccess();
      return result;
    } catch (error) {
      smartRateLimit.recordError(error);
      
      if (error?.status === 429) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      if (error?.status >= 500 && error?.status < 600) {
        const delay = 1000 * (attempt + 1);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      if (attempt === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

// Получение свойств БД с кэшированием
async function getDbPropsWithTTL(dbId) {
  const cached = notionCache.get(notionCache.dbProps, dbId, notionCache.TTL.dbProps);
  if (cached) return cached;
  
  const db = await notionApiCallOptimized(() => 
    notion.databases.retrieve({ database_id: dbId })
  );
  
  notionCache.set(notionCache.dbProps, dbId, db.properties);
  return db.properties;
}

// Query всех страниц с пагинацией
async function queryAllPages(params) {
  const pageSize = Math.min(params.page_size || 100, 100);
  let start_cursor = undefined;
  let results = [];
  
  do {
    const res = await notionApiCallOptimized(() => 
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

// Batch-загрузка навыков
async function batchLoadSkillsData(rows) {
  const skillIds = new Set();
  
  for (const row of rows) {
    const skillRel = row.properties[PROP.skill]?.relation;
    if (skillRel?.length > 0) {
      skillIds.add(skillRel[0].id);
    }
  }
  
  if (skillIds.size === 0) return new Map();
  
  const skillsMap = new Map();
  const skillsArray = Array.from(skillIds);
  
  const BATCH_SIZE = 50;
  for (let i = 0; i < skillsArray.length; i += BATCH_SIZE) {
    const batch = skillsArray.slice(i, i + BATCH_SIZE);
    
    const promises = batch.map(skillId => 
      notionApiCallOptimized(() => notion.pages.retrieve({ page_id: skillId }))
        .catch(err => {
          console.warn(`Failed to load skill ${skillId}:`, err.message);
          return null;
        })
    );
    
    const results = await Promise.all(promises);
    
    results.forEach((skillPage, idx) => {
      if (skillPage) {
        const skillId = batch[idx];
        const props = skillPage.properties;
        const name = getTitleFromProps(props) || "Навык";
        
        let description = "";
        for (const [key, value] of Object.entries(props)) {
          if (value?.type === "rich_text" && 
              (key.toLowerCase().includes("описан") || 
               key.toLowerCase().includes("description"))) {
            description = value.rich_text?.map(t => t.plain_text).join("") || "";
            break;
          }
        }
        
        skillsMap.set(skillId, { name, description });
      }
    });
    
    // Пауза между батчами
    if (i + BATCH_SIZE < skillsArray.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  
  return skillsMap;
}

// Поиск сотрудников по команде
export async function findEmployeesByTeam(teamName) {
  const teamProps = await getDbPropsWithTTL(EMPLOYEES_DB_ID);
  const def = teamProps[PROP.team];
  if (!def) return [];
  
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
  
  if (!filter) return [];
  
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
  
  return list;
}

// Поиск карточек сотрудников по userId
export async function getEmployeePagesByUserId(userId) {
  const props = await getDbPropsWithTTL(EMPLOYEES_DB_ID);
  if (props[PROP.empAccount]?.type !== "people") return [];
  
  const res = await notionApiCallOptimized(() => 
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

// Batch получение имен сотрудников
export async function getEmployeeNamesByUserIds(userIds) {
  const unique = Array.from(new Set((userIds || []).filter(Boolean)));
  if (!unique.length) return new Map();
  
  const props = await getDbPropsWithTTL(EMPLOYEES_DB_ID);
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

// Определение роли с безопасностью
export function computeRoleOnRow(row, reviewerCtx, matrixProps) {
  if (!row?.properties || !reviewerCtx?.userId || !matrixProps) {
    return null;
  }
  
  const p = row.properties;
  const userId = reviewerCtx.userId;
  const pageIds = reviewerCtx.pageIds || [];
  
  const checkPeopleField = (fieldName) => {
    const prop = matrixProps[fieldName];
    if (prop?.type !== "people") return false;
    
    const people = p[fieldName]?.people;
    return Array.isArray(people) && people.some(u => u?.id === userId);
  };
  
  const checkRelationField = (fieldName) => {
    const prop = matrixProps[fieldName];
    if (prop?.type !== "relation") return false;
    
    const relations = p[fieldName]?.relation;
    return Array.isArray(relations) && pageIds.length > 0 && 
           relations.some(r => pageIds.includes(r?.id));
  };
  
  // Проверяем в порядке приоритета
  const roleChecks = [
    { role: "self", fields: [PROP.selfScorer, PROP.employee] },
    { role: "p1_peer", fields: [PROP.p1Peer] },
    { role: "p2_peer", fields: [PROP.p2Peer] },
    { role: "manager", fields: [PROP.managerScorer] }
  ];
  
  for (const { role, fields } of roleChecks) {
    for (const field of fields) {
      if (checkPeopleField(field) || checkRelationField(field)) {
        return role;
      }
    }
  }
  
  return null;
}

// Сбор ревьюеров для сотрудников
export async function listReviewersForEmployees(employees) {
  if (!employees?.length) return [];

  const matrixProps = await getDbPropsWithTTL(MATRIX_DB_ID);
  const reviewersSet = new Set();

  const empDef = matrixProps?.[PROP.employee];
  if (!empDef) return [];
  
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

  if (!employeeOrFilters.length) return [];

  const rows = await queryAllPages({ 
    database_id: MATRIX_DB_ID, 
    filter: { or: employeeOrFilters }, 
    page_size: 100 
  });

  // Собираем всех оценивающих
  for (const row of rows) {
    const props = row.properties || {};
    
    [PROP.selfScorer, PROP.p1Peer, PROP.p2Peer, PROP.managerScorer].forEach(field => {
      const people = props[field]?.people || [];
      people.forEach(u => u?.id && reviewersSet.add(u.id));
    });
  }

  const uniqueReviewerIds = Array.from(reviewersSet);
  const nameMap = await getEmployeeNamesByUserIds(uniqueReviewerIds);
  
  // Fallback к Notion users API для недостающих имен
  const missing = uniqueReviewerIds.filter(uid => !nameMap.has(uid));
  const nameCache = new Map(nameMap);
  
  if (missing.length > 0) {
    const concurrency = Math.min(10, missing.length);
    let j = 0;
    
    async function workerNames() {
      while (j < missing.length) {
        const pos = j++;
        const uid = missing[pos];
        try {
          const u = await notionApiCallOptimized(() => notion.users.retrieve({ user_id: uid }));
          nameCache.set(uid, (u && u.name) || uid);
        } catch { 
          nameCache.set(uid, uid); 
        }
      }
    }
    
    await Promise.all(Array.from({ length: concurrency }, workerNames));
  }

  return uniqueReviewerIds.map(uid => ({ 
    reviewerUserId: uid, 
    name: nameCache.get(uid) || uid
  }));
}

// Список оцениваемых для ревьюера
export async function listEvaluateesForReviewerUser(userId) {
  const matrixProps = await getDbPropsWithTTL(MATRIX_DB_ID);
  const myPages = await getEmployeePagesByUserId(userId);
  const myPageIds = myPages.map(x => x.pageId);

  const buildFilters = (prop) => {
    const def = matrixProps[prop];
    if (!def) return [];
    
    if (def.type === "people") {
      return [{ property: prop, people: { contains: userId } }];
    }
    if (def.type === "relation" && myPageIds.length) {
      return myPageIds.map(pid => ({ property: prop, relation: { contains: pid } }));
    }
    return [];
  };

  const orFilters = [
    ...buildFilters(PROP.employee),
    ...buildFilters(PROP.selfScorer),
    ...buildFilters(PROP.p1Peer),
    ...buildFilters(PROP.p2Peer),
    ...buildFilters(PROP.managerScorer),
  ];

  if (!orFilters.length) return [];

  const res = await notionApiCallOptimized(() =>
    notion.databases.query({
      database_id: MATRIX_DB_ID,
      filter: { or: orFilters },
      sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
      page_size: 100
    })
  );

  const employeeMap = new Map();
  const reviewerCtx = { userId, pageIds: myPageIds };

  for (const row of res.results) {
    const role = computeRoleOnRow(row, reviewerCtx, matrixProps);
    if (!role) continue;

    const p = row.properties;
    let employeeId = null, employeeName = null;

    const def = matrixProps[PROP.employee];
    if (def?.type === "relation") {
      const rel = p[PROP.employee]?.relation;
      const id = Array.isArray(rel) && rel[0]?.id;
      if (id) {
        employeeId = id;
        if (!employeeMap.has(id)) {
          try {
            const page = await notionApiCallOptimized(() => notion.pages.retrieve({ page_id: id }));
            employeeName = getTitleFromProps(page.properties || {}) || id;
            employeeMap.set(id, employeeName);
          } catch { 
            employeeName = id;
            employeeMap.set(id, id);
          }
        } else {
          employeeName = employeeMap.get(id);
        }
      }
    } else if (def?.type === "people") {
      const ppl = p[PROP.employee]?.people;
      const id = Array.isArray(ppl) && ppl[0]?.id;
      if (id) {
        employeeId = id;
        if (!employeeMap.has(id)) {
          const nameMap = await getEmployeeNamesByUserIds([id]);
          employeeName = nameMap.get(id) || id;
          employeeMap.set(id, employeeName);
        } else {
          employeeName = employeeMap.get(id);
        }
      }
    }

    if (!employeeId) continue;

    if (!employeeMap.has(`employee_${employeeId}`)) {
      employeeMap.set(`employee_${employeeId}`, { employeeId, employeeName, role });
    }
  }

  return Array.from(employeeMap.values()).filter(v => v.employeeId);
}

// ОПТИМИЗИРОВАННАЯ функция получения навыков с batch-загрузкой
export async function fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId) {
  const matrixProps = await getDbPropsWithTTL(MATRIX_DB_ID);
  const myPages = await getEmployeePagesByUserId(reviewerUserId);
  const reviewerCtx = { userId: reviewerUserId, pageIds: myPages.map(x => x.pageId) };

  const employeeIds = employees.map(emp => emp.employeeId);
  const empDef = matrixProps[PROP.employee];
  
  let orFilters = [];
  if (empDef?.type === "relation") {
    orFilters = employeeIds.map(empId => ({ 
      property: PROP.employee, 
      relation: { contains: empId } 
    }));
  } else if (empDef?.type === "people") {
    orFilters = employeeIds.map(empId => ({ 
      property: PROP.employee, 
      people: { contains: empId } 
    }));
  }

  if (!orFilters.length) return [];

  const allRows = await queryAllPages({
    database_id: MATRIX_DB_ID,
    filter: { or: orFilters },
    page_size: 100
  });

  // Batch-загрузка всех навыков одним запросом
  const skillsMap = await batchLoadSkillsData(allRows);

  const result = [];
  
  for (const employee of employees) {
    const employeeRows = allRows.filter(row => {
      const props = row.properties;
      const empField = props[PROP.employee];
      
      if (empDef?.type === "relation") {
        const rel = empField?.relation || [];
        return rel.some(r => r?.id === employee.employeeId);
      } else if (empDef?.type === "people") {
        const ppl = empField?.people || [];
        return ppl.some(u => u?.id === employee.employeeId);
      }
      return false;
    });

    if (!employeeRows.length) continue;

    let role = null;
    for (const row of employeeRows) {
      role = computeRoleOnRow(row, reviewerCtx, matrixProps);
      if (role) break;
    }
    
    if (!role) continue;

    const items = [];
    for (const row of employeeRows) {
      const props = row.properties;
      const field = ROLE_TO_FIELD[role];
      const current = props[field]?.number ?? null;
      const comment = props[PROP.comment]?.rich_text?.map(t => t.plain_text).join("") || "";
      
      // Получаем данные навыка из кэша
      const skillRel = props[PROP.skill]?.relation;
      const skillId = skillRel?.[0]?.id;
      const skillData = skillsMap.get(skillId) || { name: "Навык", description: "" };
      
      items.push({ 
        pageId: row.id, 
        name: skillData.name,
        description: skillData.description,
        current,
        comment 
      });
    }

    result.push({
      employeeId: employee.employeeId,
      employeeName: employee.employeeName,
      role,
      items
    });
  }

  return result;
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
  
  return await notionApiCallOptimized(() =>
    notion.pages.update({
      page_id: pageId,
      properties
    })
  );
}

// Определение поля для комментариев
export async function detectCommentProp() {
  try {
    const props = await getDbPropsWithTTL(MATRIX_DB_ID);
    
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

// Запуск очистки кэша каждые 5 минут
if (typeof setInterval !== 'undefined') {
  setInterval(() => notionCache.cleanup(), 5 * 60 * 1000);
}