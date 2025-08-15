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

// Список оцениваемых для ревьюера с улучшенным логированием
export async function listEvaluateesForReviewerUser(userId) {
  console.log(`[EVALUATEES] Starting search for reviewer: ${userId}`);
  
  const matrixProps = await getDbProps(MATRIX_DB_ID);
  console.log(`[EVALUATEES] Matrix properties loaded:`, Object.keys(matrixProps));
  
  const myPages = await getEmployeePagesByUserId(userId);
  console.log(`[EVALUATEES] Found ${myPages.length} employee pages for user ${userId}:`, 
    myPages.map(p => `${p.name} (${p.pageId})`)
  );
  
  const myPageIds = myPages.map(x => x.pageId);

  const buildFilters = (prop) => {
    const def = matrixProps[prop];
    if (!def) {
      console.warn(`[EVALUATEES] Property ${prop} not found in matrix database`);
      return [];
    }
    
    console.log(`[EVALUATEES] Building filters for ${prop} (type: ${def.type})`);
    
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

  console.log(`[EVALUATEES] Built ${orFilters.length} filters:`, orFilters);

  if (!orFilters.length) {
    console.warn('[EVALUATEES] No valid filters created - reviewer not found in any role');
    return [];
  }

  console.log(`[EVALUATEES] Querying matrix database with ${orFilters.length} OR filters...`);
  const res = await notionApiCall(() =>
    notion.databases.query({
      database_id: MATRIX_DB_ID,
      filter: { or: orFilters },
      sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
      page_size: 100
    })
  );

  console.log(`[EVALUATEES] Found ${res.results.length} matrix rows`);

  const employeeMap = new Map();
  const reviewerCtx = { userId, pageIds: myPageIds };

  for (const [index, row] of res.results.entries()) {
    console.log(`[EVALUATEES] Processing row ${index + 1}/${res.results.length}: ${row.id}`);
    
    const role = computeRoleOnRow(row, reviewerCtx, matrixProps);
    console.log(`[EVALUATEES] Row ${row.id} - computed role: ${role}`);
    
    if (!role) {
      console.warn(`[EVALUATEES] No role determined for row ${row.id} - skipping`);
      continue;
    }

    const p = row.properties;
    let employeeId = null, employeeName = null;

    const def = matrixProps[PROP.employee];
    console.log(`[EVALUATEES] Employee property type: ${def?.type}`);
    
    if (def?.type === "relation") {
      const rel = p[PROP.employee]?.relation;
      const id = Array.isArray(rel) && rel[0]?.id;
      console.log(`[EVALUATEES] Relation employee ID: ${id}`);
      
      if (id) {
        employeeId = id;
        if (!employeeMap.has(id)) {
          try {
            const page = await notionApiCall(() => notion.pages.retrieve({ page_id: id }));
            employeeName = getTitleFromProps(page.properties || {}) || id;
            employeeMap.set(id, employeeName);
            console.log(`[EVALUATEES] Loaded employee name: ${employeeName} for ID: ${id}`);
          } catch (error) { 
            console.error(`[EVALUATEES] Failed to load employee page ${id}:`, error.message);
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
      console.log(`[EVALUATEES] People employee ID: ${id}`);
      
      if (id) {
        employeeId = id;
        if (!employeeMap.has(id)) {
          const nameMap = await getEmployeeNamesByUserIds([id]);
          employeeName = nameMap.get(id) || id;
          employeeMap.set(id, employeeName);
          console.log(`[EVALUATEES] Loaded employee name: ${employeeName} for user ID: ${id}`);
        } else {
          employeeName = employeeMap.get(id);
        }
      }
    }

    if (!employeeId) {
      console.warn(`[EVALUATEES] No employee ID found for row ${row.id}`);
      continue;
    }

    const employeeKey = `employee_${employeeId}`;
    if (!employeeMap.has(employeeKey)) {
      const employeeData = { employeeId, employeeName, role };
      employeeMap.set(employeeKey, employeeData);
      console.log(`[EVALUATEES] Added employee to result:`, employeeData);
    }
  }

  const result = Array.from(employeeMap.values()).filter(v => v.employeeId);
  console.log(`[EVALUATEES] Final result: ${result.length} employees to evaluate:`,
    result.map(e => `${e.employeeName} (${e.employeeId}) - role: ${e.role}`)
  );
  
  return result;
}

// Поиск карточек сотрудников по userId
export async function getEmployeePagesByUserId(userId) {
  const props = await getDbProps(EMPLOYEES_DB_ID);
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

// Определение роли с безопасностью и улучшенным логированием
export function computeRoleOnRow(row, reviewerCtx, matrixProps) {
  if (!row?.properties || !reviewerCtx?.userId || !matrixProps) {
    console.warn('[ROLE] Missing required parameters for role computation');
    return null;
  }
  
  const p = row.properties;
  const userId = reviewerCtx.userId;
  const pageIds = reviewerCtx.pageIds || [];
  
  console.log(`[ROLE] Computing role for row ${row.id}, reviewer ${userId}, pageIds: [${pageIds.join(', ')}]`);
  
  const checkPeopleField = (fieldName) => {
    const prop = matrixProps[fieldName];
    if (prop?.type !== "people") {
      console.log(`[ROLE] Field ${fieldName} is not a people field (type: ${prop?.type})`);
      return false;
    }
    
    const people = p[fieldName]?.people;
    const hasUser = Array.isArray(people) && people.some(u => u?.id === userId);
    console.log(`[ROLE] Field ${fieldName} people check: ${hasUser} (people: ${people?.map(u => u?.id).join(', ') || 'none'})`);
    return hasUser;
  };
  
  const checkRelationField = (fieldName) => {
    const prop = matrixProps[fieldName];
    if (prop?.type !== "relation") {
      console.log(`[ROLE] Field ${fieldName} is not a relation field (type: ${prop?.type})`);
      return false;
    }
    
    const relations = p[fieldName]?.relation;
    const hasRelation = Array.isArray(relations) && pageIds.length > 0 && 
           relations.some(r => pageIds.includes(r?.id));
    console.log(`[ROLE] Field ${fieldName} relation check: ${hasRelation} (relations: ${relations?.map(r => r?.id).join(', ') || 'none'})`);
    return hasRelation;
  };
  
  // Проверяем в порядке приоритета
  const roleChecks = [
    { role: "self", fields: [PROP.selfScorer, PROP.employee] },
    { role: "p1_peer", fields: [PROP.p1Peer] },
    { role: "p2_peer", fields: [PROP.p2Peer] },
    { role: "manager", fields: [PROP.managerScorer] }
  ];
  
  for (const { role, fields } of roleChecks) {
    console.log(`[ROLE] Checking role: ${role}, fields: [${fields.join(', ')}]`);
    
    for (const field of fields) {
      const peopleMatch = checkPeopleField(field);
      const relationMatch = checkRelationField(field);
      
      if (peopleMatch || relationMatch) {
        console.log(`[ROLE] ✅ Found match for role ${role} in field ${field} (people: ${peopleMatch}, relation: ${relationMatch})`);
        return role;
      }
    }
  }
  
  console.log(`[ROLE] ❌ No role found for row ${row.id}`);
  return null;
}

export async function fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId) {
  const matrixProps = await getDbProps(MATRIX_DB_ID);
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
  
  const BATCH_SIZE = 10; // Уменьшили для Edge Runtime
  for (let i = 0; i < skillsArray.length; i += BATCH_SIZE) {
    const batch = skillsArray.slice(i, i + BATCH_SIZE);
    
    const promises = batch.map(skillId => 
      notionApiCall(() => notion.pages.retrieve({ page_id: skillId }))
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
      await new Promise(r => setTimeout(r, 200));
    }
  }
  
  return skillsMap;
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