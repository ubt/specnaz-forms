import { Client } from "@notionhq/client";

export const notion = new Client({
  auth: process.env.NOTION_TOKEN,
  fetch: (input, init) => fetch(input, init)
});

export const MATRIX_DB_ID = process.env.MATRIX_DB_ID;
export const EMPLOYEES_DB_ID = process.env.EMPLOYEES_DB_ID;

// --- ИСПРАВЛЕННЫЕ ИМЕНА КОЛОНОК под реальную схему БД ---
export const PROP = {
  // БД "Оценки компетенций" (Matrix)
  employee: "Сотрудник",            // Relation на БД сотрудники
  cycle: "Цикл",                    // Relation на БД циклы
  skill: "Навык",                   // Relation на БД навыки
  role: "Роль",                     // Relation на БД роли
  
  // Поля оценивающих (People)
  selfScorer: "Self_scorer",        // People - кто оценивает себя
  p1Peer: "P1_peer",               // People - peer оценивающий #1
  p2Peer: "P2_peer",               // People - peer оценивающий #2
  managerScorer: "Manager_scorer",  // People - менеджер оценивающий
  
  // Поля оценок (Number)
  selfScore: "Self_score",          // Number - оценка от себя
  p1Score: "P1_score",             // Number - оценка от peer #1
  p2Score: "P2_score",             // Number - оценка от peer #2
  managerScore: "Manager_score",    // Number - оценка от менеджера
  
  // Расчетные поля
  weightedSum: "Взвешенная сумма",  // Formula
  totalWeight: "Общий вес",         // Formula
  finalScore: "Общая оценка",       // Formula
  
  // Комментарии
  comment: "Комментарий",           // Rich text
  
  // БД "Сотрудники"
  team: "Команда",                 // Select/Multi-select/Text
  empAccount: "Учетка",            // People (Notion user)
  empTitle: "Сотрудник",           // Title (название карточки)
};

// Исправленное соответствие ролей к полям оценок
export const ROLE_TO_FIELD = {
  self: "Self_score",
  p1_peer: "P1_score", 
  p2_peer: "P2_score",
  manager: "Manager_score",
};

// Соответствие ролей к полям оценивающих
export const ROLE_TO_SCORER_FIELD = {
  self: "Self_scorer",
  p1_peer: "P1_peer",
  p2_peer: "P2_peer", 
  manager: "Manager_scorer",
};

// ---------------- Кэширование с TTL ----------------
const DB_CACHE_TTL = 5 * 60 * 1000; // 5 минут
const _dbCache = new Map();

async function getDbPropsWithTTL(dbId) {
  const cached = _dbCache.get(dbId);
  if (cached && (Date.now() - cached.timestamp < DB_CACHE_TTL)) {
    return cached.data;
  }
  
  const db = await notion.databases.retrieve({ database_id: dbId });
  const props = db.properties || {};
  
  _dbCache.set(dbId, {
    data: props,
    timestamp: Date.now()
  });
  
  return props;
}

// ---------------- Адаптивный Rate Limiter ----------------
class AdaptiveRateLimit {
  constructor() {
    this.requestTimes = [];
    this.minGap = 250; // Начальный интервал 250ms
    this.maxGap = 2000; // Максимальный интервал 2s
    this.consecutive429 = 0;
    this.successCount = 0;
  }
  
  async wait() {
    const now = Date.now();
    // Убираем старые запросы (старше минуты)
    this.requestTimes = this.requestTimes.filter(t => now - t < 60000);
    
    // Адаптируем интервал на основе частоты 429 ошибок
    let gap = this.minGap + (this.consecutive429 * 150);
    gap = Math.min(gap, this.maxGap);
    
    // Если много успешных запросов подряд, уменьшаем gap
    if (this.successCount > 10) {
      gap = Math.max(this.minGap, gap * 0.8);
    }
    
    if (this.requestTimes.length > 0) {
      const lastRequest = Math.max(...this.requestTimes);
      const timeSinceLastRequest = now - lastRequest;
      
      if (timeSinceLastRequest < gap) {
        await new Promise(r => setTimeout(r, gap - timeSinceLastRequest));
      }
    }
    
    this.requestTimes.push(Date.now());
  }
  
  handle429() {
    this.consecutive429++;
    this.successCount = 0;
    console.warn(`[RATE LIMIT] 429 error, consecutive: ${this.consecutive429}`);
  }
  
  handleSuccess() {
    this.consecutive429 = Math.max(0, this.consecutive429 - 1);
    this.successCount++;
  }
}

export const adaptiveRateLimit = new AdaptiveRateLimit();

// Обертка для всех Notion API запросов с retry и rate limiting
async function notionApiCall(apiCall, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await adaptiveRateLimit.wait();
      const result = await apiCall();
      adaptiveRateLimit.handleSuccess();
      return result;
    } catch (error) {
      if (error?.status === 429) {
        adaptiveRateLimit.handle429();
        // Экспоненциальная задержка для 429
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      if (attempt === maxRetries - 1) throw error;
      
      // Для других ошибок - короткая задержка
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

// ---------------- Helper functions ----------------

// Query all pages with pagination and rate limiting
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

function getTitleFromProps(props) {
  for (const key in props) {
    const v = props[key];
    if (v?.type === "title" && v.title?.length) {
      return v.title.map(t => t.plain_text).join("");
    }
  }
  return null;
}

// Получение названия навыка из relation поля или title
export async function getSkillNameFromProps(props) {
  const t = getTitleFromProps(props);
  if (t) return t;
  
  // Если навык в relation поле
  const skillRel = props[PROP.skill]?.relation;
  if (skillRel?.length > 0) {
    try {
      const skillPage = await notionApiCall(() => 
        notion.pages.retrieve({ page_id: skillRel[0].id })
      );
      return getTitleFromProps(skillPage.properties) || "Навык";
    } catch {
      return "Навык";
    }
  }
  
  return "Навык";
}

// Получение описания навыка из relation
export async function getSkillDescFromProps(props) {
  const skillRel = props[PROP.skill]?.relation;
  if (skillRel?.length > 0) {
    try {
      const skillPage = await notionApiCall(() => 
        notion.pages.retrieve({ page_id: skillRel[0].id })
      );
      const skillProps = skillPage.properties;
      
      // Ищем поле с описанием (может быть rich_text поле)
      for (const [key, value] of Object.entries(skillProps)) {
        if (value?.type === "rich_text" && 
            key.toLowerCase().includes("описан")) {
          return value.rich_text?.map(t => t.plain_text).join("") || "";
        }
      }
    } catch {
      // Игнорируем ошибку
    }
  }
  
  return "";
}

// --- Поиск сотрудников по команде (оптимизированный) ---
async function buildTeamFilter(teamProps, teamName) {
  const def = teamProps[PROP.team];
  if (!def) return null;
  
  const norm = (s) => (s || "").toString().trim().toLowerCase().replace(/\s+/g, " ");
  const q = norm(teamName);

  if (def.type === "select" || def.type === "multi_select") {
    const opts = (def[def.type]?.options || []).map(o => o?.name).filter(Boolean);
    
    // Точное совпадение
    let match = opts.find(n => norm(n) === q);
    
    // Если не точное, ищем содержащие
    if (!match) {
      const cand = opts.filter(n => norm(n).includes(q));
      if (cand.length === 1) match = cand[0];
    }
    
    if (match) {
      if (def.type === "select") return { property: PROP.team, select: { equals: match } };
      return { property: PROP.team, multi_select: { contains: match } };
    }
    
    // Fallback для нескольких кандидатов
    if (opts.length) {
      const cands = opts.filter(n => norm(n).includes(q)).slice(0, 5);
      if (cands.length > 1) {
        if (def.type === "select") {
          return { or: cands.map(n => ({ property: PROP.team, select: { equals: n } })) };
        } else {
          return { or: cands.map(n => ({ property: PROP.team, multi_select: { contains: n } })) };
        }
      }
    }
    
    return null;
  }
  
  if (def.type === "rich_text") return { property: PROP.team, rich_text: { contains: teamName } };
  if (def.type === "title") return { property: PROP.team, title: { contains: teamName } };
  
  return null;
}

export async function findEmployeesByTeam(teamName) {
  const teamProps = await getDbPropsWithTTL(EMPLOYEES_DB_ID);
  let filter = await buildTeamFilter(teamProps, teamName);
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

// --- Поиск карточек сотрудников по Notion userId ---
export async function getEmployeePagesByUserId(userId) {
  const props = await getDbPropsWithTTL(EMPLOYEES_DB_ID);
  if (props[PROP.empAccount]?.type !== "people") return [];
  
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

// --- Batch получение имен сотрудников ---
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

// --- ИСПРАВЛЕННАЯ функция определения роли ---
export function computeRoleOnRow(row, reviewerCtx, matrixProps) {
  const p = row.properties;
  const has = n => !!matrixProps?.[n];
  const isPeople = n => matrixProps?.[n]?.type === "people";
  const isRel = n => matrixProps?.[n]?.type === "relation";

  const pplHas = n => {
    const ppl = p[n]?.people;
    return Array.isArray(ppl) && reviewerCtx.userId &&
           ppl.some(u => u?.id === reviewerCtx.userId);
  };
  
  const relHasAny = n => {
    const rel = p[n]?.relation;
    return Array.isArray(rel) && reviewerCtx.pageIds?.length &&
           rel.some(r => reviewerCtx.pageIds.includes(r?.id));
  };

  // Проверяем Self scorer
  if (has(PROP.selfScorer)) {
    if (isPeople(PROP.selfScorer) && pplHas(PROP.selfScorer)) return "self";
  }
  
  // Проверяем Employee для self-оценки (если Self_scorer не заполнен)
  if (has(PROP.employee)) {
    if (isRel(PROP.employee) && relHasAny(PROP.employee)) return "self";
    if (isPeople(PROP.employee) && pplHas(PROP.employee)) return "self";
  }
  
  // P1 Peer
  if (has(PROP.p1Peer)) {
    if (isPeople(PROP.p1Peer) && pplHas(PROP.p1Peer)) return "p1_peer";
  }
  
  // P2 Peer
  if (has(PROP.p2Peer)) {
    if (isPeople(PROP.p2Peer) && pplHas(PROP.p2Peer)) return "p2_peer";
  }
  
  // Manager
  if (has(PROP.managerScorer)) {
    if (isPeople(PROP.managerScorer) && pplHas(PROP.managerScorer)) return "manager";
  }
  
  return null;
}

// --- ОПТИМИЗИРОВАННАЯ функция сбора ревьюеров ---
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

  // Собираем всех оценивающих из People-полей
  for (const row of rows) {
    const props = row.properties || {};
    
    // Self scorer
    const selfScorer = props[PROP.selfScorer]?.people || [];
    selfScorer.forEach(u => u?.id && reviewersSet.add(u.id));
    
    // P1 peer
    const p1Peer = props[PROP.p1Peer]?.people || [];
    p1Peer.forEach(u => u?.id && reviewersSet.add(u.id));
    
    // P2 peer  
    const p2Peer = props[PROP.p2Peer]?.people || [];
    p2Peer.forEach(u => u?.id && reviewersSet.add(u.id));
    
    // Manager scorer
    const managerScorer = props[PROP.managerScorer]?.people || [];
    managerScorer.forEach(u => u?.id && reviewersSet.add(u.id));
  }

  const uniqueReviewerIds = Array.from(reviewersSet);
  
  // Batch resolve names
  const nameMap = await getEmployeeNamesByUserIds(uniqueReviewerIds);
  
  // Fallback to Notion users API for missing names
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
          const u = await notionApiCall(() => notion.users.retrieve({ user_id: uid }));
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

// --- ОПТИМИЗИРОВАННАЯ функция списка оцениваемых ---
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

  const res = await notionApiCall(() =>
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
            const page = await notionApiCall(() => notion.pages.retrieve({ page_id: id }));
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

    // Группируем по employeeId, но сохраняем роль
    if (!employeeMap.has(`employee_${employeeId}`)) {
      employeeMap.set(`employee_${employeeId}`, { employeeId, employeeName, role });
    }
  }

  return Array.from(employeeMap.values()).filter(v => v.employeeId);
}

// --- ОПТИМИЗИРОВАННАЯ функция получения навыков для оценки ---
export async function fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId) {
  const matrixProps = await getDbPropsWithTTL(MATRIX_DB_ID);
  const myPages = await getEmployeePagesByUserId(reviewerUserId);
  const reviewerCtx = { userId: reviewerUserId, pageIds: myPages.map(x => x.pageId) };

  // Строим фильтры для всех сотрудников сразу
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

  // Один запрос для всех сотрудников
  const allRows = await queryAllPages({
    database_id: MATRIX_DB_ID,
    filter: { or: orFilters },
    page_size: 100
  });

  // Группируем результаты по сотрудникам
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

    // Определяем роль для этого сотрудника
    let role = null;
    for (const row of employeeRows) {
      role = computeRoleOnRow(row, reviewerCtx, matrixProps);
      if (role) break;
    }
    
    if (!role) continue;

    // Формируем список навыков
    const items = [];
    for (const row of employeeRows) {
      const props = row.properties;
      const field = ROLE_TO_FIELD[role];
      const current = props[field]?.number ?? null;
      const skillName = await getSkillNameFromProps(props);
      const description = await getSkillDescFromProps(props);
      const comment = props[PROP.comment]?.rich_text?.map(t => t.plain_text).join("") || "";
      
      items.push({ 
        pageId: row.id, 
        name: skillName,
        description, 
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

// --- BATCH UPDATE функция ---
export async function batchUpdateScores(items, field, commentProp) {
  const BATCH_SIZE = 5; // Консервативный размер батча
  const batches = [];
  
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE));
  }
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`[BATCH UPDATE] Processing batch ${i + 1}/${batches.length}, items: ${batch.length}`);
    
    const promises = batch.map(item => 
      updateScore(item.pageId, field, item.value, item.comment, commentProp)
    );
    
    const results = await Promise.allSettled(promises);
    
    // Логируем ошибки
    results.forEach((result, idx) => {
      if (result.status === 'rejected') {
        console.error(`[BATCH UPDATE] Failed to update ${batch[idx].pageId}:`, result.reason);
      }
    });
    
    // Пауза между батчами
    if (i < batches.length - 1) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
}

// --- Обновление оценки ---
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

// --- Автоматическое определение поля для комментариев ---
export async function detectCommentProp() {
  try {
    const props = await getDbPropsWithTTL(MATRIX_DB_ID);
    
    // Сначала проверяем точное совпадение
    if (props[PROP.comment]?.type === "rich_text") {
      return PROP.comment;
    }
    
    // Ищем по паттернам
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