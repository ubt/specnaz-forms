import { Client } from "@notionhq/client";

export const notion = new Client({
  auth: process.env.NOTION_TOKEN,
  fetch: (input, init) => fetch(input, init)
});

export const MATRIX_DB_ID = process.env.MATRIX_DB_ID;
export const EMPLOYEES_DB_ID = process.env.EMPLOYEES_DB_ID;

// --- ИСПРАВЛЕННЫЕ ИМЕНА КОЛОНОК под реальную схему БД ---
export const PROP = {
  // БД "Оценки компетенций"
  employee: "Сотрудник",           // Relation на БД сотрудники
  cycle: "Цикл",                   // Relation на БД циклы
  skill: "Навык",                  // Relation на БД навыки
  role: "Роль",                    // Relation на БД роли
  
  // Оценивающие (People поля)
  selfScorer: "Self_scorer",       // People - кто оценивает себя
  p1Peer: "P1_peer",              // People - первый peer reviewer
  p2Peer: "P2_peer",              // People - второй peer reviewer  
  managerScorer: "Manager_scorer", // People - менеджер
  
  // Оценки (Number поля)
  selfScore: "Self_score",         // Number - самооценка
  p1Score: "P1_score",            // Number - оценка от P1 peer
  p2Score: "P2_score",            // Number - оценка от P2 peer
  managerScore: "Manager_score",   // Number - оценка от менеджера
  
  // Вычисляемые поля
  weightedSum: "Взвешенная сумма", // Formula
  totalWeight: "Общий вес",        // Formula
  finalScore: "Общая оценка",      // Formula
  
  // Комментарии
  comment: "Комментарий",          // Rich text
  
  // БД "Сотрудники"
  team: "Команда",                 // Select/Multi-select/Text
  empAccount: "Учетка",            // People (Notion user)
  empTitle: "Сотрудник",           // Title
};

// Сопоставление ролей с полями оценок
export const ROLE_TO_FIELD = {
  self: PROP.selfScore,
  p1_peer: PROP.p1Score,
  p2_peer: PROP.p2Score,
  manager: PROP.managerScore,
};

// Сопоставление ролей с полями оценивающих
export const ROLE_TO_SCORER_FIELD = {
  self: PROP.selfScorer,
  p1_peer: PROP.p1Peer,
  p2_peer: PROP.p2Peer,
  manager: PROP.managerScorer,
};

// ---------------- Кэширование и оптимизация ----------------

const DB_CACHE_TTL = 5 * 60 * 1000; // 5 минут
const _dbCache = new Map();
const _nameCache = new Map(); // Кэш имен пользователей

// Кэширование метаданных БД с TTL
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

// Адаптивный rate limiter
class AdaptiveRateLimit {
  constructor() {
    this.requestTimes = [];
    this.minGap = 300; // Начальный интервал 300ms
    this.maxGap = 1000; // Максимальный интервал 1s
    this.consecutive429 = 0;
  }
  
  async wait() {
    const now = Date.now();
    this.requestTimes = this.requestTimes.filter(t => now - t < 60000); // Последняя минута
    
    // Адаптируем интервал на основе частоты 429 ошибок
    let gap = this.minGap + (this.consecutive429 * 100);
    gap = Math.min(gap, this.maxGap);
    
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
  }
  
  handleSuccess() {
    this.consecutive429 = Math.max(0, this.consecutive429 - 1);
  }
}

export const adaptiveRateLimit = new AdaptiveRateLimit();

// Query all pages with pagination
async function queryAllPages(params) {
  const pageSize = Math.min(params.page_size || 100, 100);
  let start_cursor = undefined;
  let results = [];
  
  do {
    await adaptiveRateLimit.wait();
    try {
      const res = await notion.databases.query({ 
        ...params, 
        start_cursor, 
        page_size: pageSize 
      });
      results.push(...(res.results || []));
      start_cursor = res.has_more ? res.next_cursor : undefined;
      adaptiveRateLimit.handleSuccess();
    } catch (error) {
      if (error.status === 429) {
        adaptiveRateLimit.handle429();
        // Exponential backoff для 429
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
        continue; // Повторить запрос
      }
      throw error;
    }
  } while (start_cursor);
  
  return results;
}

// ---------------- Helper functions ----------------

function getTitleFromProps(props) {
  for (const key in props) {
    const v = props[key];
    if (v?.type === "title" && v.title?.length) {
      return v.title.map(t => t.plain_text).join("");
    }
  }
  return null;
}

// Получение названия навыка из Relation или Title
export async function getSkillNameFromProps(props) {
  const t = getTitleFromProps(props);
  if (t) return t;
  
  // Если навык как Relation, получаем из связанной записи
  const skillRel = props[PROP.skill]?.relation;
  if (skillRel?.length) {
    try {
      await adaptiveRateLimit.wait();
      const skillPage = await notion.pages.retrieve({ page_id: skillRel[0].id });
      return getTitleFromProps(skillPage.properties || {}) || "Навык";
    } catch {
      return "Навык";
    }
  }
  
  return "Навык";
}

// Получение описания навыка
export async function getSkillDescFromProps(props) {
  // Если описание есть в текущей записи
  const desc = props["Описание навыка"];
  if (desc?.rich_text?.length) {
    return desc.rich_text.map(t => t.plain_text).join("");
  }
  
  // Если навык как Relation, получаем описание из связанной записи
  const skillRel = props[PROP.skill]?.relation;
  if (skillRel?.length) {
    try {
      await adaptiveRateLimit.wait();
      const skillPage = await notion.pages.retrieve({ page_id: skillRel[0].id });
      const skillProps = skillPage.properties || {};
      
      // Ищем поле с описанием в записи навыка
      for (const [key, value] of Object.entries(skillProps)) {
        if (key.toLowerCase().includes('описание') && value.rich_text?.length) {
          return value.rich_text.map(t => t.plain_text).join("");
        }
      }
    } catch {
      // Игнорируем ошибки получения описания
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
    
    // Точное совпадение (без учета регистра)
    let match = opts.find(n => norm(n) === q);
    
    // Если точного совпадения нет, ищем частичное
    if (!match) {
      const candidates = opts.filter(n => norm(n).includes(q));
      if (candidates.length === 1) match = candidates[0];
    }
    
    if (match) {
      if (def.type === "select") {
        return { property: PROP.team, select: { equals: match } };
      }
      return { property: PROP.team, multi_select: { contains: match } };
    }
    
    // Fallback: OR по всем подходящим кандидатам
    if (opts.length) {
      const candidates = opts.filter(n => norm(n).includes(q)).slice(0, 5);
      if (candidates.length > 1) {
        if (def.type === "select") {
          return { or: candidates.map(n => ({ property: PROP.team, select: { equals: n } })) };
        } else {
          return { or: candidates.map(n => ({ property: PROP.team, multi_select: { contains: n } })) };
        }
      }
    }
    
    return null;
  }
  
  if (def.type === "rich_text") return { property: PROP.team, rich_text: { contains: teamName } };
  if (def.type === "title") return { property: PROP.team, title: { contains: teamName } };
  
  return null;
}

// Поиск сотрудников по команде
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

// Получение карточек сотрудников по userId с кэшированием
export async function getEmployeePagesByUserId(userId) {
  const cacheKey = `emp_pages_${userId}`;
  const cached = _nameCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < DB_CACHE_TTL)) {
    return cached.data;
  }
  
  const props = await getDbPropsWithTTL(EMPLOYEES_DB_ID);
  if (props[PROP.empAccount]?.type !== "people") return [];
  
  await adaptiveRateLimit.wait();
  const res = await notion.databases.query({
    database_id: EMPLOYEES_DB_ID,
    filter: { property: PROP.empAccount, people: { contains: userId } },
    page_size: 10
  });
  
  const result = res.results.map(row => ({
    pageId: row.id,
    name: getTitleFromProps(row.properties || {}) || row.id
  }));
  
  _nameCache.set(cacheKey, {
    data: result,
    timestamp: Date.now()
  });
  
  return result;
}

// Получение имени сотрудника по userId с кэшированием
export async function getEmployeeNameByUserId(userId) {
  const cacheKey = `emp_name_${userId}`;
  const cached = _nameCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < DB_CACHE_TTL)) {
    return cached.data;
  }
  
  const pages = await getEmployeePagesByUserId(userId);
  let name = userId;
  
  if (pages.length) {
    name = pages[0].name;
  } else {
    try {
      await adaptiveRateLimit.wait();
      const u = await notion.users.retrieve({ user_id: userId });
      name = u.name || userId;
    } catch {
      name = userId;
    }
  }
  
  _nameCache.set(cacheKey, {
    data: name,
    timestamp: Date.now()
  });
  
  return name;
}

// Батчевое получение имен сотрудников (оптимизированное)
export async function getEmployeeNamesByUserIds(userIds) {
  const unique = Array.from(new Set((userIds || []).filter(Boolean)));
  if (!unique.length) return new Map();
  
  const result = new Map();
  const uncached = [];
  
  // Проверяем кэш
  for (const userId of unique) {
    const cacheKey = `emp_name_${userId}`;
    const cached = _nameCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < DB_CACHE_TTL)) {
      result.set(userId, cached.data);
    } else {
      uncached.push(userId);
    }
  }
  
  if (!uncached.length) return result;
  
  const props = await getDbPropsWithTTL(EMPLOYEES_DB_ID);
  if (props[PROP.empAccount]?.type !== "people") return result;

  // Батчевый запрос для некэшированных
  const chunkSize = 20;
  for (let i = 0; i < uncached.length; i += chunkSize) {
    const chunk = uncached.slice(i, i + chunkSize);
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
        if (uid && chunk.includes(uid)) {
          result.set(uid, title);
          _nameCache.set(`emp_name_${uid}`, {
            data: title,
            timestamp: Date.now()
          });
        }
      }
    }
  }
  
  // Fallback к Notion users API для тех, кого не нашли в БД сотрудников
  const stillMissing = uncached.filter(uid => !result.has(uid));
  const concurrency = 5;
  let j = 0;
  
  async function workerNames() {
    while (j < stillMissing.length) {
      const pos = j++;
      const uid = stillMissing[pos];
      try {
        await adaptiveRateLimit.wait();
        const u = await notion.users.retrieve({ user_id: uid });
        const name = (u && u.name) || uid;
        result.set(uid, name);
        _nameCache.set(`emp_name_${uid}`, {
          data: name,
          timestamp: Date.now()
        });
      } catch {
        result.set(uid, uid);
        _nameCache.set(`emp_name_${uid}`, {
          data: uid,
          timestamp: Date.now()
        });
      }
    }
  }
  
  await Promise.all(Array.from({ 
    length: Math.min(concurrency, stillMissing.length || 1) 
  }, workerNames));

  return result;
}

// ------------ ИСПРАВЛЕННАЯ функция определения роли ------------
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

  // Проверяем роль Self
  if (has(PROP.selfScorer)) {
    if (isPeople(PROP.selfScorer) && pplHas(PROP.selfScorer)) return "self";
  }
  
  // Проверяем Employee (для самооценки)
  if (has(PROP.employee)) {
    if (isRel(PROP.employee) && relHasAny(PROP.employee)) return "self";
    if (isPeople(PROP.employee) && pplHas(PROP.employee)) return "self";
  }
  
  // Проверяем P1 peer
  if (has(PROP.p1Peer)) {
    if (isPeople(PROP.p1Peer) && pplHas(PROP.p1Peer)) return "p1_peer";
  }
  
  // Проверяем P2 peer  
  if (has(PROP.p2Peer)) {
    if (isPeople(PROP.p2Peer) && pplHas(PROP.p2Peer)) return "p2_peer";
  }
  
  // Проверяем Manager
  if (has(PROP.managerScorer)) {
    if (isPeople(PROP.managerScorer) && pplHas(PROP.managerScorer)) return "manager";
  }
  
  return null;
}

// ------------ ИСПРАВЛЕННАЯ функция сбора ревьюеров -------------
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
  } else {
    return [];
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
    
    // Employee (для самооценки, если Employee - это People поле)
    if (empDef.type === "people") {
      const employees = props[PROP.employee]?.people || [];
      employees.forEach(u => u?.id && reviewersSet.add(u.id));
    }
  }

  const uniqueReviewerIds = Array.from(reviewersSet);
  const nameMap = await getEmployeeNamesByUserIds(uniqueReviewerIds);

  return uniqueReviewerIds.map(uid => ({ 
    reviewerUserId: uid, 
    name: nameMap.get(uid) || uid,
    role: 'mixed' // Один человек может иметь разные роли для разных сотрудников
  }));
}

// -------- ИСПРАВЛЕННАЯ функция списка для оценки ----------
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
      return myPageIds.map(pid => ({ 
        property: prop, 
        relation: { contains: pid } 
      }));
    }
    
    return [];
  };

  const orFilters = [
    ...buildFilters(PROP.employee),     // Самооценка
    ...buildFilters(PROP.selfScorer),   // Явная самооценка
    ...buildFilters(PROP.p1Peer),       // P1 peer оценка
    ...buildFilters(PROP.p2Peer),       // P2 peer оценка  
    ...buildFilters(PROP.managerScorer), // Manager оценка
  ];

  if (!orFilters.length) {
    return { evaluatees: [], warning: "no_compatible_filters" };
  }

  const rows = await queryAllPages({
    database_id: MATRIX_DB_ID,
    filter: { or: orFilters },
    sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
    page_size: 100 // Увеличили лимит
  });

  const evaluateesMap = new Map(); // employeeId -> evaluatee info
  const reviewerCtx = { userId, pageIds: myPageIds };

  for (const row of rows) {
    const role = computeRoleOnRow(row, reviewerCtx, matrixProps);
    if (!role) continue;

    let employeeId = null, employeeName = null;

    const empDef = matrixProps[PROP.employee];
    if (empDef?.type === "relation") {
      const rel = row.properties[PROP.employee]?.relation;
      const id = Array.isArray(rel) && rel[0]?.id;
      if (id) {
        employeeId = id;
        try {
          await adaptiveRateLimit.wait();
          const page = await notion.pages.retrieve({ page_id: id });
          employeeName = getTitleFromProps(page.properties || {}) || id;
        } catch {
          employeeName = id;
        }
      }
    } else if (empDef?.type === "people") {
      const ppl = row.properties[PROP.employee]?.people;
      const id = Array.isArray(ppl) && ppl[0]?.id;
      if (id) {
        employeeId = id;
        employeeName = await getEmployeeNameByUserId(id);
      }
    }

    if (!employeeId) continue;

    // Группируем по сотруднику, так как у одного ревьюера может быть несколько ролей
    if (!evaluateesMap.has(employeeId)) {
      evaluateesMap.set(employeeId, {
        employeeId,
        employeeName,
        roles: new Set([role])
      });
    } else {
      evaluateesMap.get(employeeId).roles.add(role);
    }
  }

  const evaluatees = Array.from(evaluateesMap.values()).map(item => ({
    employeeId: item.employeeId,
    employeeName: item.employeeName,
    role: Array.from(item.roles)[0], // Берем первую роль для совместимости
    allRoles: Array.from(item.roles)  // Сохраняем все роли
  }));

  return { evaluatees, warning: null };
}

// -------- ОПТИМИЗИРОВАННАЯ функция получения навыков ------------
export async function fetchEmployeeSkillRowsForReviewerUser(evaluatees, reviewerUserId) {
  const matrixProps = await getDbPropsWithTTL(MATRIX_DB_ID);
  const reviewerPages = await getEmployeePagesByUserId(reviewerUserId);
  const reviewerCtx = { userId: reviewerUserId, pageIds: reviewerPages.map(x => x.pageId) };
  
  const result = {};
  
  // Обрабатываем каждого сотрудника
  for (const evaluatee of evaluatees) {
    const { employeeId } = evaluatee;
    
    // Строим фильтр для конкретного сотрудника
    let employeeFilter = null;
    const empDef = matrixProps[PROP.employee];
    
    if (empDef?.type === "relation") {
      employeeFilter = { 
        property: PROP.employee, 
        relation: { contains: employeeId } 
      };
    } else if (empDef?.type === "people") {
      employeeFilter = { 
        property: PROP.employee, 
        people: { contains: employeeId } 
      };
    } else {
      continue;
    }

    // Получаем все записи навыков для этого сотрудника
    const rows = await queryAllPages({
      database_id: MATRIX_DB_ID,
      filter: employeeFilter,
      sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
      page_size: 100
    });

    if (!rows.length) {
      result[employeeId] = { role: null, items: [] };
      continue;
    }

    // Определяем роль для этого сотрудника
    let role = null;
    for (const row of rows) {
      role = computeRoleOnRow(row, reviewerCtx, matrixProps);
      if (role) break;
    }

    if (!role) {
      result[employeeId] = { role: null, items: [] };
      continue;
    }

    // Собираем данные по навыкам
    const skillsPromises = rows.map(async (row) => {
      const props = row.properties;
      const field = ROLE_TO_FIELD[role];
      const current = props[field]?.number ?? null;
      
      // Получаем название и описание навыка
      const skillName = await getSkillNameFromProps(props);
      const description = await getSkillDescFromProps(props);
      
      // Получаем текущий комментарий если есть
      const comment = props[PROP.comment]?.rich_text?.map(t => t.plain_text).join("") || "";
      
      return {
        pageId: row.id,
        skillName,
        description,
        current,
        comment
      };
    });

    const items = await Promise.all(skillsPromises);
    result[employeeId] = { role, items };
  }

  return result;
}

// -------- БАТЧЕВОЕ обновление оценок ------------
export async function batchUpdateScores(items, field, commentProp) {
  const BATCH_SIZE = 10;
  const batches = [];
  
  // Разбиваем на батчи
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE));
  }
  
  // Обрабатываем батчи последовательно
  for (const batch of batches) {
    const promises = batch.map(async (item) => {
      await adaptiveRateLimit.wait();
      try {
        await updateScore(item.pageId, field, item.value, item.comment, commentProp);
        adaptiveRateLimit.handleSuccess();
      } catch (error) {
        if (error.status === 429) {
          adaptiveRateLimit.handle429();
        }
        throw error;
      }
    });
    
    await Promise.allSettled(promises);
    
    // Небольшая пауза между батчами
    await new Promise(r => setTimeout(r, 100));
  }
}

// Обновление одной оценки
export async function updateScore(pageId, field, value, comment, commentProp) {
  const properties = {
    [field]: { number: value }
  };
  
  // Добавляем комментарий если поле указано и комментарий не пустой
  if (commentProp && comment && comment.trim()) {
    properties[commentProp] = { 
      rich_text: [{ text: { content: comment.trim() } }] 
    };
  }
  
  await notion.pages.update({
    page_id: pageId,
    properties
  });
}

// Определение поля для комментариев
export async function detectCommentProp() {
  try {
    const props = await getDbPropsWithTTL(MATRIX_DB_ID);
    
    // Сначала проверяем точное имя поля
    if (props[PROP.comment]?.type === "rich_text") {
      return PROP.comment;
    }
    
    // Fallback: ищем поле с подходящим названием
    const candidate = Object.keys(props).find((k) => {
      const v = props[k];
      if (v?.type !== "rich_text") return false;
      const name = (k || "").toLowerCase();
      return name.includes("коммент") || 
             name.includes("comment") || 
             name.includes("примечан") ||
             name.includes("note");
    });
    
    return candidate || null;
  } catch {
    return null;
  }
}

// Получение ID сотрудника из строки матрицы
function getEmployeeIdFromRow(row, matrixProps) {
  const empDef = matrixProps[PROP.employee];
  if (!empDef) return null;
  
  const props = row.properties;
  
  if (empDef.type === "relation") {
    const rel = props[PROP.employee]?.relation;
    return Array.isArray(rel) && rel[0]?.id || null;
  }
  
  if (empDef.type === "people") {
    const ppl = props[PROP.employee]?.people;
    return Array.isArray(ppl) && ppl[0]?.id || null;
  }
  
  return null;
}

// Класс для мониторинга производительности
export class PerformanceTracker {
  static timers = new Map();
  
  static start(operation) {
    this.timers.set(operation, Date.now());
  }
  
  static end(operation) {
    const start = this.timers.get(operation);
    if (!start) return;
    
    const duration = Date.now() - start;
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[PERF] ${operation}: ${duration}ms`);
    }
    
    this.timers.delete(operation);
    
    // Предупреждение о долгих операциях
    if (duration > 5000) {
      console.warn(`[PERF WARNING] ${operation} took ${duration}ms`);
    }
    
    return duration;
  }
}

// Экспорт для обратной совместимости (старые имена функций)
export {
  queryAllPages,
  getDbPropsWithTTL as getDbProps,
  listEvaluateesForReviewerUser,
  fetchEmployeeSkillRowsForReviewerUser
};