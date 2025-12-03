// lib/notion.js - Оптимизированный модуль для работы с Notion API
import { Client } from "@notionhq/client";
import { notionApiCall, notionApiCallParallel } from "./notionRateLimit";
import { logger } from "./logger";
import { createCache } from "./lruCache";
import { CONFIG, PROP, ROLE_TO_FIELD, ROLE_TO_SCORER_FIELD } from "./config";

// Re-export для обратной совместимости
export { PROP, ROLE_TO_FIELD, ROLE_TO_SCORER_FIELD };

// Создание клиента для Edge Runtime
export const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

export const MATRIX_DB_ID = process.env.MATRIX_DB_ID;
export const EMPLOYEES_DB_ID = process.env.EMPLOYEES_DB_ID;

// Проверка переменных окружения
function validateEnvironment() {
  const required = {
    NOTION_TOKEN: process.env.NOTION_TOKEN,
    MATRIX_DB_ID: process.env.MATRIX_DB_ID,
    EMPLOYEES_DB_ID: process.env.EMPLOYEES_DB_ID,
    JWT_SECRET: process.env.JWT_SECRET
  };
  
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
    
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
}

try {
  validateEnvironment();
} catch (error) {
  console.error('[ENV ERROR]', error.message);
}

// Performance Tracker
export class PerformanceTracker {
  static operations = new Map();

  static start(operationName) {
    this.operations.set(operationName, Date.now());
    logger.debug(`[PERF] Started: ${operationName}`);
  }

  static end(operationName) {
    const startTime = this.operations.get(operationName);
    if (startTime) {
      const duration = Date.now() - startTime;
      this.operations.delete(operationName);
      logger.perf(operationName, duration);
      return duration;
    }
    return 0;
  }
}

// LRU Cache с разными TTL
const skillsCache = createCache('skills');      // 500 items, 10 min
const dbCache = createCache('database');        // 50 items, 30 min
const employeeCache = createCache('default');   // 100 items, 10 min

function getCached(key, cacheType = 'default') {
  const cache = cacheType === 'skills' ? skillsCache : 
                cacheType === 'database' ? dbCache : employeeCache;
  return cache.get(key);
}

function setCached(key, data, cacheType = 'default') {
  const cache = cacheType === 'skills' ? skillsCache : 
                cacheType === 'database' ? dbCache : employeeCache;
  cache.set(key, data);
}

// Вспомогательные функции
function getTitleFromProps(props) {
  for (const key in props) {
    const v = props[key];
    if (v?.type === "title" && v.title?.length) {
      return v.title.map(t => t.plain_text).join("");
    }
  }
  return null;
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Получение свойств БД с кэшированием
async function getDbProps(dbId) {
  const cacheKey = `db_props_${dbId}`;
  const cached = getCached(cacheKey, 'database');
  if (cached) {
    logger.debug(`[DB PROPS] Cache hit for ${dbId}`);
    return cached;
  }
  
  const db = await notionApiCall(() => 
    notion.databases.retrieve({ database_id: dbId })
  );
  
  setCached(cacheKey, db.properties, 'database');
  return db.properties;
}

// ОПТИМИЗИРОВАННАЯ Query всех страниц
async function queryAllPages(params) {
  const pageSize = Math.min(params.page_size || CONFIG.PAGINATION.DEFAULT_PAGE_SIZE, 100);
  let start_cursor = undefined;
  let results = [];
  let pageCount = 0;
  const maxPages = CONFIG.PAGINATION.MAX_PAGES;
  
  logger.debug(`[QUERY ALL] Starting query...`);
  
  do {
    pageCount++;
    
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
    
    logger.debug(`[QUERY ALL] Page ${pageCount}: ${newResults.length} items, total: ${results.length}`);
    
    if (pageCount >= maxPages) {
      logger.warn(`[QUERY ALL] Reached max page limit (${maxPages})`);
      break;
    }
    
  } while (start_cursor);
  
  return results;
}

// Поиск сотрудников по команде
export async function findEmployeesByTeam(teamName) {
  if (!teamName || typeof teamName !== 'string') {
    throw new Error('Team name is required');
  }
  
  logger.info(`[SEARCH] Looking for team: "${teamName}"`);
  
  const teamProps = await getDbProps(EMPLOYEES_DB_ID);
  const def = teamProps[PROP.team];
  if (!def) {
    logger.error(`[SEARCH] Team property "${PROP.team}" not found`);
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
    logger.warn(`[SEARCH] Could not create filter for team "${teamName}"`);
    return [];
  }
  
  const rows = await queryAllPages({
    database_id: EMPLOYEES_DB_ID,
    filter,
    page_size: 100
  });

  const list = rows.map(row => {
    const props = row.properties || {};
    const name = getTitleFromProps(props) || row.id;
    const acct = props[PROP.empAccount];
    const ppl = acct?.people || [];
    const userIds = ppl.map(u => u?.id).filter(Boolean);
    return { pageId: row.id, name, userIds };
  });
  
  logger.info(`[SEARCH] Found ${list.length} employees for team "${teamName}"`);
  return list;
}

// Получение имен сотрудников по User IDs - ОПТИМИЗИРОВАНО
export async function getEmployeeNamesByUserIds(userIds) {
  const unique = Array.from(new Set((userIds || []).filter(Boolean)));
  if (!unique.length) return new Map();
  
  // Проверяем кэш
  const out = new Map();
  const uncachedIds = [];
  
  for (const uid of unique) {
    const cached = getCached(`emp_name_${uid}`);
    if (cached) {
      out.set(uid, cached);
    } else {
      uncachedIds.push(uid);
    }
  }
  
  if (uncachedIds.length === 0) {
    logger.debug(`[NAMES] All ${unique.length} names from cache`);
    return out;
  }
  
  const props = await getDbProps(EMPLOYEES_DB_ID);
  if (props[PROP.empAccount]?.type !== "people") return out;

  // Загружаем несколько ID за один запрос
  const chunkSize = CONFIG.PARALLEL.EMPLOYEE_LOAD_BATCH;
  
  for (let i = 0; i < uncachedIds.length; i += chunkSize) {
    const chunk = uncachedIds.slice(i, i + chunkSize);
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
        if (uid && !out.has(uid)) {
          out.set(uid, title);
          setCached(`emp_name_${uid}`, title);
        }
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
    logger.error(`[REVIEWERS] Employee property not found`);
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

  if (!employeeOrFilters.length) return [];

  const rows = await queryAllPages({ 
    database_id: MATRIX_DB_ID, 
    filter: { or: employeeOrFilters }, 
    page_size: 100 
  });

  for (const row of rows) {
    const props = row.properties || {};
    [PROP.selfScorer, PROP.p1Peer, PROP.p2Peer, PROP.managerScorer].forEach(field => {
      const people = props[field]?.people || [];
      people.forEach(u => u?.id && reviewersSet.add(u.id));
    });
  }

  const uniqueReviewerIds = Array.from(reviewersSet);
  if (uniqueReviewerIds.length === 0) return [];
  
  const nameMap = await getEmployeeNamesByUserIds(uniqueReviewerIds);
  
  // Fallback к Notion users API для недостающих имен
  const missing = uniqueReviewerIds.filter(uid => !nameMap.has(uid));
  
  if (missing.length > 0) {
    // Параллельная загрузка недостающих имен
    const userLoadCalls = missing.map(uid => async () => {
      const u = await notion.users.retrieve({ user_id: uid });
      return { uid, name: u?.name || uid };
    });
    
    const results = await notionApiCallParallel(userLoadCalls, 5);
    results.forEach(result => {
      if (!result.error) {
        nameMap.set(result.uid, result.name);
      }
    });
  }

  return uniqueReviewerIds.map(uid => ({ 
    reviewerUserId: uid, 
    name: nameMap.get(uid) || uid,
    role: 'peer'
  }));
}

// Определение роли ревьюера
export function computeRoleOnRow(row, reviewerCtx, matrixProps) {
  if (!row?.properties || !reviewerCtx?.userId || !matrixProps) {
    return null;
  }
  
  const p = row.properties;
  const userId = reviewerCtx.userId;
  const pageIds = reviewerCtx.pageIds || [];
  
  // 1. Manager (высший приоритет)
  const managerPeople = p[PROP.managerScorer]?.people || [];
  if (managerPeople.some(u => u?.id === userId)) {
    return "manager";
  }
  
  // 2. Self (самооценка)
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
  
  // 3. P1 Peer
  const p1People = p[PROP.p1Peer]?.people || [];
  if (p1People.some(u => u?.id === userId)) {
    return "p1_peer";
  }
  
  // 4. P2 Peer
  const p2People = p[PROP.p2Peer]?.people || [];
  if (p2People.some(u => u?.id === userId)) {
    return "p2_peer";
  }
  
  return null;
}

// Получение страниц сотрудника по User ID
export async function getEmployeePagesByUserId(userId) {
  const cacheKey = `emp_pages_${userId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  
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
  
  const pages = res.results.map(row => ({
    pageId: row.id,
    name: getTitleFromProps(row.properties || {}) || row.id
  }));
  
  setCached(cacheKey, pages);
  return pages;
}

// ОПТИМИЗИРОВАННАЯ функция поиска сотрудников для оценки
export async function listEvaluateesForReviewerUser(userId) {
  logger.info(`[EVALUATEES] Starting for reviewer: ${userId}`);
  
  PerformanceTracker.start('list-evaluatees');
  
  // ОПТИМИЗАЦИЯ: Параллельная загрузка независимых данных
  const [matrixProps, myPages] = await Promise.all([
    getDbProps(MATRIX_DB_ID),
    getEmployeePagesByUserId(userId)
  ]);
  
  const myPageIds = myPages.map(x => x.pageId);
  const reviewerCtx = { userId, pageIds: myPageIds };

  // Проверка структуры матрицы
  const requiredFields = [PROP.employee, PROP.skill, PROP.selfScorer, PROP.p1Peer, PROP.p2Peer, PROP.managerScorer];
  const missingFields = requiredFields.filter(field => !matrixProps[field]);
  
  if (missingFields.length > 0) {
    throw new Error(`Matrix database missing required fields: ${missingFields.join(', ')}`);
  }

  // Собираем фильтры
  const allFilters = [];
  const scorerFields = [PROP.selfScorer, PROP.p1Peer, PROP.p2Peer, PROP.managerScorer];
  
  for (const field of scorerFields) {
    const def = matrixProps[field];
    if (def?.type === "people") {
      allFilters.push({ property: field, people: { contains: userId } });
    }
  }
  
  const empDef = matrixProps[PROP.employee];
  if (empDef?.type === "people") {
    allFilters.push({ property: PROP.employee, people: { contains: userId } });
  } else if (empDef?.type === "relation" && myPageIds.length > 0) {
    myPageIds.forEach(pageId => {
      allFilters.push({ property: PROP.employee, relation: { contains: pageId } });
    });
  }

  if (!allFilters.length) {
    throw new Error('Cannot create valid filters for matrix search');
  }

  // Выполняем поиск
  const combinedFilter = allFilters.length === 1 ? allFilters[0] : { or: allFilters };
  
  const allRows = await queryAllPages({
    database_id: MATRIX_DB_ID,
    filter: combinedFilter,
    page_size: 100
  });
  
  // Удаляем дубликаты
  const uniqueRows = Array.from(new Map(allRows.map(row => [row.id, row])).values());

  if (!uniqueRows.length) {
    PerformanceTracker.end('list-evaluatees');
    return [];
  }

  // Группируем по employeeId + role
  const employeesMap = new Map();
  const employeeIdsToLoad = new Set();
  
  for (const row of uniqueRows) {
    const role = computeRoleOnRow(row, reviewerCtx, matrixProps);
    if (!role) continue;

    let employeeId = null;
    const p = row.properties;
    
    if (empDef?.type === "relation") {
      const rel = p[PROP.employee]?.relation;
      employeeId = rel?.[0]?.id;
    } else if (empDef?.type === "people") {
      const ppl = p[PROP.employee]?.people;
      employeeId = ppl?.[0]?.id;
    }

    if (employeeId) {
      const uniqueKey = `${employeeId}_${role}`;
      if (!employeesMap.has(uniqueKey)) {
        employeesMap.set(uniqueKey, { employeeId, role });
        employeeIdsToLoad.add(employeeId);
      }
    }
  }

  // ОПТИМИЗАЦИЯ: Загружаем имена всех сотрудников за один раз
  const employeeNames = new Map();
  const idsToLoad = Array.from(employeeIdsToLoad);
  
  // Сначала проверяем кэш
  const uncachedIds = [];
  for (const empId of idsToLoad) {
    const cached = getCached(`emp_name_${empId}`);
    if (cached) {
      employeeNames.set(empId, cached);
    } else {
      uncachedIds.push(empId);
    }
  }
  
  // Загружаем недостающие имена параллельно
  if (uncachedIds.length > 0) {
    const loadCalls = uncachedIds.map(empId => async () => {
      if (empDef?.type === "relation") {
        const page = await notion.pages.retrieve({ page_id: empId });
        return { empId, name: getTitleFromProps(page.properties || {}) || empId };
      } else {
        const nameMap = await getEmployeeNamesByUserIds([empId]);
        return { empId, name: nameMap.get(empId) || empId };
      }
    });
    
    const results = await notionApiCallParallel(loadCalls, CONFIG.PARALLEL.EMPLOYEE_LOAD_BATCH);
    results.forEach(result => {
      if (!result.error && result.empId) {
        employeeNames.set(result.empId, result.name);
        setCached(`emp_name_${result.empId}`, result.name);
      }
    });
  }

  // Собираем результат
  const result = Array.from(employeesMap.values()).map(emp => ({
    employeeId: emp.employeeId,
    employeeName: employeeNames.get(emp.employeeId) || emp.employeeId,
    role: emp.role
  }));

  PerformanceTracker.end('list-evaluatees');
  logger.info(`[EVALUATEES] Found ${result.length} employees`);
  
  return result;
}

// Загрузка информации о навыке
async function loadSkillInformation(skillId, matrixRowProps) {
  const cacheKey = `skill_info_${skillId}`;
  const cached = getCached(cacheKey, 'skills');
  if (cached) return cached;

  let skillName = "Неизвестный навык";
  let skillDescription = "";

  // Rollup "Навык - название"
  const nameRollupField = matrixRowProps?.[PROP.skillName];
  if (nameRollupField?.type === "rollup") {
    const rollup = nameRollupField.rollup || {};
    if (rollup.array?.length) {
      for (const item of rollup.array) {
        if (item.type === "title" && item.title?.length) {
          skillName = item.title.map(t => t.plain_text).join("");
          break;
        }
        if (item.type === "rich_text" && item.rich_text?.length) {
          skillName = item.rich_text.map(t => t.plain_text).join("");
          break;
        }
      }
    }
  }

  // Rollup "Описание навыка"
  const descRollupField = matrixRowProps?.[PROP.skillDescription];
  if (descRollupField?.type === "rollup") {
    const rollup = descRollupField.rollup || {};
    if (rollup.array?.length) {
      for (const item of rollup.array) {
        if (item.type === "rich_text" && item.rich_text?.length) {
          skillDescription = item.rich_text.map(t => t.plain_text).join("");
          break;
        }
      }
    }
  }

  const result = { name: skillName, description: skillDescription };
  setCached(cacheKey, result, 'skills');
  return result;
}

// ОПТИМИЗИРОВАННАЯ загрузка навыков для ревьюера
export async function fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId) {
  logger.info(`[SKILLS] Loading skills for ${employees.length} employees`);
  PerformanceTracker.start('fetch-all-skills');
  
  // ОПТИМИЗАЦИЯ: Параллельная загрузка props и pages
  const [matrixProps, myPages] = await Promise.all([
    getDbProps(MATRIX_DB_ID),
    getEmployeePagesByUserId(reviewerUserId)
  ]);
  
  const reviewerCtx = { userId: reviewerUserId, pageIds: myPages.map(x => x.pageId) };
  const empDef = matrixProps[PROP.employee];

  // ОПТИМИЗАЦИЯ: Загружаем ВСЕ строки матрицы одним запросом
  PerformanceTracker.start('load-all-rows');
  
  let allRows = [];
  if (employees.length > 0) {
    let combinedFilter;
    
    if (empDef?.type === "relation") {
      const orFilters = employees.map(e => ({
        property: PROP.employee,
        relation: { contains: e.employeeId }
      }));
      combinedFilter = orFilters.length === 1 ? orFilters[0] : { or: orFilters };
    } else if (empDef?.type === "people") {
      const orFilters = employees.map(e => ({
        property: PROP.employee,
        people: { contains: e.employeeId }
      }));
      combinedFilter = orFilters.length === 1 ? orFilters[0] : { or: orFilters };
    }
    
    if (combinedFilter) {
      allRows = await queryAllPages({
        database_id: MATRIX_DB_ID,
        filter: combinedFilter,
        page_size: 100
      });
    }
  }
  
  PerformanceTracker.end('load-all-rows');
  logger.debug(`[SKILLS] Loaded ${allRows.length} matrix rows`);

  // Группируем строки и собираем skill IDs
  const rowsByEmployeeAndRole = new Map();
  const allSkillsData = new Map();

  for (const row of allRows) {
    const props = row.properties;
    
    let employeeId = null;
    if (empDef?.type === "relation") {
      const rel = props[PROP.employee]?.relation;
      employeeId = rel?.[0]?.id;
    } else if (empDef?.type === "people") {
      const ppl = props[PROP.employee]?.people;
      employeeId = ppl?.[0]?.id;
    }
    
    if (!employeeId) continue;

    const role = computeRoleOnRow(row, reviewerCtx, matrixProps);
    if (!role) continue;

    const key = `${employeeId}_${role}`;
    if (!rowsByEmployeeAndRole.has(key)) {
      rowsByEmployeeAndRole.set(key, []);
    }
    rowsByEmployeeAndRole.get(key).push(row);

    const skillRel = props[PROP.skill]?.relation;
    const skillId = skillRel?.[0]?.id;
    if (skillId && !allSkillsData.has(skillId)) {
      allSkillsData.set(skillId, { props });
    }
  }

  // ОПТИМИЗАЦИЯ: Параллельная загрузка информации о навыках
  logger.debug(`[SKILLS] Loading ${allSkillsData.size} unique skills in parallel...`);
  PerformanceTracker.start('load-skill-info');
  
  const skillInfoMap = new Map();
  const skillEntries = Array.from(allSkillsData.entries());
  
  // Загружаем батчами для контроля параллелизма
  const batchSize = CONFIG.PARALLEL.SKILL_LOAD_BATCH;
  
  for (let i = 0; i < skillEntries.length; i += batchSize) {
    const batch = skillEntries.slice(i, i + batchSize);
    
    const batchResults = await Promise.all(
      batch.map(async ([skillId, data]) => {
        const info = await loadSkillInformation(skillId, data.props);
        return { skillId, info };
      })
    );
    
    for (const { skillId, info } of batchResults) {
      skillInfoMap.set(skillId, info);
    }
  }
  
  PerformanceTracker.end('load-skill-info');

  // Собираем результат
  const result = [];
  
  for (const employee of employees) {
    const key = `${employee.employeeId}_${employee.role}`;
    const employeeRows = rowsByEmployeeAndRole.get(key) || [];
    
    if (employeeRows.length === 0) continue;

    const items = [];
    const processedSkills = new Set();
    
    for (const row of employeeRows) {
      const props = row.properties;
      const skillRel = props[PROP.skill]?.relation;
      const skillId = skillRel?.[0]?.id;
      
      if (!skillId || processedSkills.has(skillId)) continue;
      processedSkills.add(skillId);
      
      const skillInfo = skillInfoMap.get(skillId);
      if (!skillInfo) continue;
      
      const scoreField = ROLE_TO_FIELD[employee.role] || ROLE_TO_FIELD.peer;
      const currentScore = props[scoreField]?.number ?? null;
      
      items.push({
        pageId: row.id,
        name: skillInfo.name,
        description: skillInfo.description,
        current: currentScore
      });
    }

    if (items.length > 0) {
      result.push({
        employeeId: employee.employeeId,
        employeeName: employee.employeeName,
        role: employee.role,
        items
      });
    }
  }
     
  const totalDuration = PerformanceTracker.end('fetch-all-skills');
  logger.info(`[SKILLS] Loaded ${result.length} skill groups in ${totalDuration}ms`);
  
  return result;
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