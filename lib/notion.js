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

// УПРОЩЕННАЯ функция определения роли ревьюера
export function computeRoleOnRow(row, reviewerUserId) {
  if (!row?.properties || !reviewerUserId) {
    return null;
  }
  
  const p = row.properties;
  
  // Проверяем каждую роль в порядке приоритета
  const checks = [
    { field: PROP.selfScorer, role: "self" },
    { field: PROP.managerScorer, role: "manager" },
    { field: PROP.p1Peer, role: "p1_peer" },
    { field: PROP.p2Peer, role: "p2_peer" }
  ];
  
  for (const check of checks) {
    const people = p[check.field]?.people || [];
    if (people.some(u => u?.id === reviewerUserId)) {
      console.log(`[ROLE] Found ${check.role} role for user ${reviewerUserId} in ${check.field}`);
      return check.role;
    }
  }
  
  console.log(`[ROLE] No role found for user ${reviewerUserId} in row ${row.id}`);
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

// КАРДИНАЛЬНО УПРОЩЕННАЯ функция поиска сотрудников для оценки
export async function listEvaluateesForReviewerUser(userId) {
  console.log(`[EVALUATEES] Starting simplified search for reviewer: ${userId}`);
  
  try {
    const matrixProps = await getDbProps(MATRIX_DB_ID);
    console.log(`[EVALUATEES] Matrix DB properties loaded`);
    
    // Создаем простые фильтры для всех scorer полей
    const filters = [
      { property: PROP.selfScorer, people: { contains: userId } },
      { property: PROP.p1Peer, people: { contains: userId } },
      { property: PROP.p2Peer, people: { contains: userId } },
      { property: PROP.managerScorer, people: { contains: userId } }
    ];

    console.log(`[EVALUATEES] Searching matrix with ${filters.length} filters for user: ${userId}`);

    // Выполняем поиск с объединенным OR фильтром
    const allRows = await queryAllPages({
      database_id: MATRIX_DB_ID,
      filter: { or: filters },
      page_size: 100
    });

    console.log(`[EVALUATEES] Found ${allRows.length} matrix rows for reviewer ${userId}`);

    if (!allRows.length) {
      console.warn(`[EVALUATEES] No matrix rows found for reviewer ${userId}`);
      return [];
    }

    // Собираем уникальных сотрудников и определяем роли
    const employeesMap = new Map();
    const empDef = matrixProps[PROP.employee];
    
    console.log(`[EVALUATEES] Employee field type: ${empDef?.type}`);

    for (const row of allRows) {
      try {
        // Определяем роль для этой строки
        const role = computeRoleOnRow(row, userId);
        if (!role) {
          console.log(`[EVALUATEES] No role found for row ${row.id}, skipping`);
          continue;
        }

        // Получаем ID сотрудника
        let employeeId = null;
        let employeeName = null;
        
        const p = row.properties;
        
        if (empDef?.type === "relation") {
          const rel = p[PROP.employee]?.relation;
          employeeId = rel?.[0]?.id;
          
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
          
          if (employeeId && !employeesMap.has(employeeId)) {
            const nameMap = await getEmployeeNamesByUserIds([employeeId]);
            employeeName = nameMap.get(employeeId) || employeeId;
          }
        }

        if (employeeId && !employeesMap.has(employeeId)) {
          employeesMap.set(employeeId, {
            employeeId,
            employeeName: employeeName || employeeId,
            role
          });
          console.log(`[EVALUATEES] Added employee: ${employeeName} (role: ${role})`);
        }
      } catch (rowError) {
        console.error(`[EVALUATEES] Error processing row ${row.id}:`, rowError.message);
        continue;
      }
    }

    const result = Array.from(employeesMap.values());
    console.log(`[EVALUATEES] Final result: ${result.length} employees for evaluation`);
    
    return result;
    
  } catch (error) {
    console.error(`[EVALUATEES] Critical error:`, error.message);
    throw error;
  }
}

// УПРОЩЕННАЯ функция загрузки информации о навыке
async function loadSkillInformation(skillId, matrixRowProps) {
  try {
    console.log(`[SKILL LOAD] Loading skill: ${skillId}`);
    
    let skillName = "Неизвестный навык";
    let skillDescription = "";
    
    // 1. Пробуем использовать rollup поле из матрицы
    if (matrixRowProps?.[PROP.skillDescription]) {
      const rollupField = matrixRowProps[PROP.skillDescription];
      
      if (rollupField?.type === "rollup") {
        if (rollupField.rollup?.array?.length > 0) {
          // Rollup массив
          for (const value of rollupField.rollup.array) {
            if (value?.rich_text?.length > 0) {
              skillDescription = value.rich_text.map(t => t.plain_text).join("");
              break;
            }
          }
        } else if (rollupField.rollup?.rich_text?.length > 0) {
          // Простое rollup значение
          skillDescription = rollupField.rollup.rich_text.map(t => t.plain_text).join("");
        }
      } else if (rollupField?.type === "rich_text" && rollupField.rich_text?.length > 0) {
        // Обычное текстовое поле
        skillDescription = rollupField.rich_text.map(t => t.plain_text).join("");
      }
      
      // Пытаемся извлечь название из начала описания
      if (skillDescription) {
        const firstLine = skillDescription.split('\n')[0]?.trim();
        if (firstLine && firstLine.length < 100) {
          skillName = firstLine;
        }
        console.log(`[SKILL LOAD] Used rollup data for skill: ${skillName}`);
        return { name: skillName, description: skillDescription };
      }
    }
    
    // 2. Если rollup пустой, загружаем страницу навыка
    try {
      console.log(`[SKILL LOAD] Loading skill page directly: ${skillId}`);
      
      const skillPage = await notionApiCall(() => 
        notion.pages.retrieve({ page_id: skillId })
      );
      
      const props = skillPage.properties || {};
      
      // Ищем название
      const pageTitle = getTitleFromProps(props);
      if (pageTitle?.trim()) {
        skillName = pageTitle.trim();
      }
      
      // Ищем описание в свойствах
      for (const [key, value] of Object.entries(props)) {
        if (value?.type === "rich_text" && value.rich_text?.length > 0) {
          const text = value.rich_text.map(t => t.plain_text).join("").trim();
          if (text && text.length > skillDescription.length) {
            skillDescription = text;
          }
        }
      }
      
      console.log(`[SKILL LOAD] Loaded from page: ${skillName}`);
      
    } catch (pageError) {
      console.warn(`[SKILL LOAD] Failed to load skill page ${skillId}:`, pageError.message);
      skillName = `Навык ${skillId.substring(-8)}`;
    }
    
    return { name: skillName, description: skillDescription };
    
  } catch (error) {
    console.error(`[SKILL LOAD] Error loading skill ${skillId}:`, error.message);
    return { 
      name: `Навык ${skillId.substring(-8)}`, 
      description: `Ошибка загрузки: ${error.message}` 
    };
  }
}

// КАРДИНАЛЬНО УПРОЩЕННАЯ функция загрузки навыков
export async function fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId) {
  console.log(`[SKILLS] Starting simplified skill loading for ${employees.length} employees, reviewer: ${reviewerUserId}`);
  
  try {
    const matrixProps = await getDbProps(MATRIX_DB_ID);
    const result = [];
    
    for (const employee of employees) {
      console.log(`[SKILLS] Processing employee: ${employee.employeeName}`);
      
      try {
        // Создаем простой фильтр для сотрудника
        const empDef = matrixProps[PROP.employee];
        let employeeFilter;
        
        if (empDef?.type === "relation") {
          employeeFilter = { 
            property: PROP.employee, 
            relation: { contains: employee.employeeId } 
          };
        } else if (empDef?.type === "people") {
          employeeFilter = { 
            property: PROP.employee, 
            people: { contains: employee.employeeId } 
          };
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

        console.log(`[SKILLS] Found ${employeeRows.length} rows for ${employee.employeeName}`);

        if (!employeeRows.length) {
          continue;
        }

        // Определяем роль и собираем навыки
        let detectedRole = null;
        const skills = new Map();
        
        for (const row of employeeRows) {
          const role = computeRoleOnRow(row, reviewerUserId);
          
          if (role) {
            if (!detectedRole) detectedRole = role;
            
            // Получаем навык
            const props = row.properties;
            const skillRel = props[PROP.skill]?.relation;
            const skillId = skillRel?.[0]?.id;
            
            if (skillId) {
              const scoreField = ROLE_TO_FIELD[role];
              const currentScore = props[scoreField]?.number ?? null;
              
              if (!skills.has(skillId)) {
                skills.set(skillId, {
                  pageId: row.id,
                  skillId,
                  current: currentScore,
                  matrixRowProps: props
                });
              }
            }
          }
        }

        if (!detectedRole || skills.size === 0) {
          console.log(`[SKILLS] No role or skills found for ${employee.employeeName}`);
          continue;
        }

        console.log(`[SKILLS] Role: ${detectedRole}, Skills: ${skills.size} for ${employee.employeeName}`);

        // Загружаем информацию о навыках
        const items = [];
        for (const skill of skills.values()) {
          try {
            const skillInfo = await loadSkillInformation(skill.skillId, skill.matrixRowProps);
            
            items.push({
              pageId: skill.pageId,
              name: skillInfo.name,
              description: skillInfo.description,
              current: skill.current,
              comment: ""
            });
            
            console.log(`[SKILLS] ✅ Loaded: ${skillInfo.name}`);
            
          } catch (skillError) {
            console.error(`[SKILLS] Error loading skill ${skill.skillId}:`, skillError.message);
          }
          
          // Пауза для rate limiting
          await new Promise(r => setTimeout(r, 200));
        }

        if (items.length > 0) {
          result.push({
            employeeId: employee.employeeId,
            employeeName: employee.employeeName,
            role: detectedRole,
            items
          });
          
          console.log(`[SKILLS] ✅ Added ${items.length} skills for ${employee.employeeName}`);
        }
        
      } catch (employeeError) {
        console.error(`[SKILLS] Error processing employee ${employee.employeeName}:`, employeeError.message);
        continue;
      }
    }

    console.log(`[SKILLS] Final result: ${result.length} employees with skills`);
    const totalSkills = result.reduce((sum, emp) => sum + emp.items.length, 0);
    console.log(`[SKILLS] Total skills loaded: ${totalSkills}`);
    
    return result;
    
  } catch (error) {
    console.error(`[SKILLS] Critical error:`, error.message);
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