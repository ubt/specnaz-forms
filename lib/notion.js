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

// ИСПРАВЛЕННЫЙ маппинг ролей на поля оценок
export const ROLE_TO_FIELD = {
  self: "Self_score",        // ИСПРАВЛЕНО: самооценка -> Self_score
  p1_peer: "P1_score",       // P1 пир -> P1_score
  p2_peer: "P2_score",       // P2 пир -> P2_score
  manager: "Manager_score",  // Менеджер -> Manager_score
  peer: "P1_score",          // fallback для обратной совместимости
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

// ОПТИМИЗИРОВАННАЯ система контроля запросов
let requestCount = 0;
const REQUEST_LIMIT = 90; // Увеличен лимит
const RESET_INTERVAL = 60000;

// Простая обертка для API вызовов без искусственных задержек
async function notionApiCall(apiCall, maxRetries = 2) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      requestCount++;
      const result = await apiCall();
      return result;
    } catch (error) {
      if (error?.status === 429) {
        const delay = 1000 * (attempt + 1);
        console.log(`[NOTION API] Rate limited, waiting ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      if (error?.status >= 500 && error?.status < 600 && attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      
      throw error;
    }
  }
}

// УСКОРЕННАЯ query с увеличенным page_size
async function queryAllPages(params) {
  const pageSize = 100; // Максимальный размер страницы
  let start_cursor = undefined;
  let results = [];
  let pageCount = 0;
  const maxPages = 50; // Увеличено для полной загрузки
  
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
    
    console.log(`[QUERY] Page ${pageCount}: ${newResults.length} items, total: ${results.length}`);
    
    if (pageCount >= maxPages) {
      console.warn(`[QUERY] Reached max pages (${maxPages})`);
      break;
    }
    
  } while (start_cursor);
  
  console.log(`[QUERY] Completed: ${results.length} results in ${pageCount} pages`);
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
    
  } catch (error) {
    console.error(`[SEARCH] Error searching for team "${teamName}":`, error);
    throw error;
  }
}

// Получение имен сотрудников
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
    
    try {
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
    } catch (error) {
      console.error('[EMPLOYEE NAMES] Error:', error.message);
      break;
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
      console.error(`[REVIEWERS] Employee property not found`);
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

    return uniqueReviewerIds.map(uid => ({ 
      reviewerUserId: uid, 
      name: nameMap.get(uid) || uid,
      role: 'peer'
    }));
    
  } catch (error) {
    console.error('[REVIEWERS] Error:', error);
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

// Получение страниц сотрудника
export async function getEmployeePagesByUserId(userId) {
  try {
    const props = await getDbProps(EMPLOYEES_DB_ID);
    if (props[PROP.empAccount]?.type !== "people") {
      return [];
    }
    
    const res = await notionApiCall(() => 
      notion.databases.query({
        database_id: EMPLOYEES_DB_ID,
        filter: { property: PROP.empAccount, people: { contains: userId } },
        page_size: 20
      })
    );
    
    const pages = res.results.map(row => ({
      pageId: row.id,
      name: getTitleFromProps(row.properties || {}) || row.id
    }));
    
    return pages;
    
  } catch (error) {
    console.error(`[EMPLOYEE PAGES] Error:`, error.message);
    return [];
  }
}

// ИСПРАВЛЕННАЯ функция поиска сотрудников для оценки - БЕЗ ОГРАНИЧЕНИЙ
export async function listEvaluateesForReviewerUser(userId) {
  console.log(`[EVALUATEES] Starting search for reviewer: ${userId}`);
  
  try {
    const matrixProps = await getDbProps(MATRIX_DB_ID);
    const myPages = await getEmployeePagesByUserId(userId);
    const myPageIds = myPages.map(x => x.pageId);
    const reviewerCtx = { userId, pageIds: myPageIds };

    // Собираем все возможные фильтры
    const allFilters = [];
    
    const scorerFields = [PROP.selfScorer, PROP.p1Peer, PROP.p2Peer, PROP.managerScorer];
    for (const field of scorerFields) {
      const def = matrixProps[field];
      if (def?.type === "people") {
        allFilters.push({ 
          property: field, 
          people: { contains: userId }
        });
      }
    }
    
    const empDef = matrixProps[PROP.employee];
    if (empDef?.type === "people") {
      allFilters.push({ 
        property: PROP.employee, 
        people: { contains: userId }
      });
    } else if (empDef?.type === "relation" && myPageIds.length > 0) {
      myPageIds.forEach((pageId) => {
        allFilters.push({ 
          property: PROP.employee, 
          relation: { contains: pageId }
        });
      });
    }

    if (!allFilters.length) {
      throw new Error('Cannot create valid filters for matrix search');
    }

    // Выполняем поиск
    let allRows = [];
    try {
      const combinedFilter = allFilters.length === 1 ? allFilters[0] : { or: allFilters };
      allRows = await queryAllPages({
        database_id: MATRIX_DB_ID,
        filter: combinedFilter,
        page_size: 100
      });
    } catch (filterError) {
      console.error(`[EVALUATEES] Combined filter failed, trying individual filters`);
      
      for (let i = 0; i < Math.min(allFilters.length, 5); i++) {
        try {
          const filterRows = await queryAllPages({
            database_id: MATRIX_DB_ID,
            filter: allFilters[i],
            page_size: 100
          });
          allRows.push(...filterRows);
        } catch (individualError) {
          console.error(`[EVALUATEES] Individual filter ${i} failed:`, individualError.message);
        }
      }
    }

    const uniqueRows = Array.from(new Map(allRows.map(row => [row.id, row])).values());
    console.log(`[EVALUATEES] Found ${uniqueRows.length} unique matrix rows`);

    if (!uniqueRows.length) {
      return [];
    }

    // Группируем по сотрудникам - БЕЗ ОГРАНИЧЕНИЙ
    const employeesMap = new Map();
    
    for (const row of uniqueRows) {
      try {
        const role = computeRoleOnRow(row, reviewerCtx, matrixProps);
        if (!role) continue;

        let employeeId = null, employeeName = null;
        const p = row.properties;
        
        if (empDef?.type === "relation") {
          const rel = p[PROP.employee]?.relation;
          employeeId = rel?.[0]?.id;
          
          if (employeeId && !employeesMap.has(employeeId)) {
            try {
              const page = await notionApiCall(() => notion.pages.retrieve({ page_id: employeeId }));
              employeeName = getTitleFromProps(page.properties || {}) || employeeId;
            } catch (error) {
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
            } catch (error) {
              employeeName = employeeId;
            }
          }
        }

        if (employeeId && !employeesMap.has(employeeId)) {
          employeesMap.set(employeeId, {
            employeeId,
            employeeName: employeeName || employeeId,
            role
          });
        }
      } catch (rowError) {
        continue;
      }
    }

    const result = Array.from(employeesMap.values());
    console.log(`[EVALUATEES] ✅ Found ${result.length} employees for evaluation`);
    
    return result;
    
  } catch (error) {
    console.error(`[EVALUATEES] Error:`, error.message);
    throw error;
  }
}

// УСКОРЕННАЯ функция загрузки навыков - БЕЗ ОГРАНИЧЕНИЙ
export async function fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId) {
  console.log(`[SKILLS] Starting skill loading for ${employees.length} employees`);
  
  try {
    const matrixProps = await getDbProps(MATRIX_DB_ID);
    const myPages = await getEmployeePagesByUserId(reviewerUserId);
    const reviewerCtx = { userId: reviewerUserId, pageIds: myPages.map(x => x.pageId) };

    const result = [];
    
    // Обрабатываем ВСЕХ сотрудников - убрано ограничение
    for (const employee of employees) {
      console.log(`[SKILLS] Processing employee: ${employee.employeeName}`);
      
      try {
        const empDef = matrixProps[PROP.employee];
        let employeeFilter;
        
        if (empDef?.type === "relation") {
          employeeFilter = { property: PROP.employee, relation: { contains: employee.employeeId } };
        } else if (empDef?.type === "people") {
          employeeFilter = { property: PROP.employee, people: { contains: employee.employeeId } };
        } else {
          continue;
        }

        // Получаем ВСЕ строки для этого сотрудника - убрано ограничение page_size
        const employeeRows = await queryAllPages({
          database_id: MATRIX_DB_ID,
          filter: employeeFilter,
          page_size: 100
        });

        if (!employeeRows.length) continue;

        // Определяем роль и собираем навыки
        const relevantRows = [];
        let detectedRole = null;
        
        for (const row of employeeRows) {
          const role = computeRoleOnRow(row, reviewerCtx, matrixProps);
          if (role) {
            relevantRows.push(row);
            if (!detectedRole) detectedRole = role;
          }
        }

        if (!detectedRole) continue;

        const field = ROLE_TO_FIELD[detectedRole];
        if (!field) {
          console.error(`[SKILLS] No field mapping for role: ${detectedRole}`);
          continue;
        }

        // Собираем ВСЕ уникальные навыки - убрано ограничение
        const uniqueSkills = new Map();
        
        for (const row of relevantRows) {
          const props = row.properties;
          const skillRel = props[PROP.skill]?.relation;
          const skillId = skillRel?.[0]?.id;
          
          if (skillId && !uniqueSkills.has(skillId)) {
            const current = props[field]?.number ?? null;
            uniqueSkills.set(skillId, {
              pageId: row.id,
              skillId,
              current,
              matrixRowProps: props
            });
          }
        }

        console.log(`[SKILLS] Found ${uniqueSkills.size} skills for ${employee.employeeName}`);

        // БЫСТРАЯ загрузка навыков с приоритетом rollup данных
        const items = [];
        
        for (const skillEntry of uniqueSkills.values()) {
          try {
            let skillName = "Неизвестный навык";
            let skillDescription = "";
            
            // Приоритет rollup полю для быстроты
            if (skillEntry.matrixRowProps?.[PROP.skillDescription]) {
              const rollupField = skillEntry.matrixRowProps[PROP.skillDescription];
              
              if (rollupField?.type === "rollup") {
                if (rollupField.rollup?.array?.length > 0) {
                  for (const value of rollupField.rollup.array) {
                    if (value?.rich_text?.length > 0) {
                      skillDescription = value.rich_text.map(t => t.plain_text).join("");
                      break;
                    } else if (value?.title?.length > 0) {
                      skillName = value.title.map(t => t.plain_text).join("");
                      break;
                    }
                  }
                } else if (rollupField.rollup?.rich_text?.length > 0) {
                  skillDescription = rollupField.rollup.rich_text.map(t => t.plain_text).join("");
                }
                
                if (skillDescription && skillDescription.length > 0) {
                  const lines = skillDescription.split('\n');
                  if (lines[0]?.trim() && lines[0].length < 100) {
                    skillName = lines[0].trim();
                  }
                }
              }
            }
            
            // Только если rollup пустой - загружаем страницу навыка
            if (skillName === "Неизвестный навык") {
              try {
                const skillPage = await notionApiCall(() => 
                  notion.pages.retrieve({ page_id: skillEntry.skillId })
                );
                
                const props = skillPage.properties || {};
                const pageTitle = getTitleFromProps(props);
                if (pageTitle?.trim() && pageTitle !== "Untitled") {
                  skillName = pageTitle.trim();
                }
              } catch (pageError) {
                skillName = `Навык ${skillEntry.skillId.substring(-8)}`;
              }
            }
            
            items.push({
              pageId: skillEntry.pageId,
              name: skillName,
              description: skillDescription,
              current: skillEntry.current,
              comment: ""
            });
            
          } catch (skillError) {
            items.push({
              pageId: skillEntry.pageId,
              name: `Навык ${skillEntry.skillId.substring(-8)}`,
              description: "Ошибка загрузки",
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
          
          console.log(`[SKILLS] ✅ Added ${items.length} skills for ${employee.employeeName} (role: ${detectedRole})`);
        }
      } catch (employeeError) {
        console.error(`[SKILLS] Error processing employee:`, employeeError.message);
        continue;
      }
    }

    console.log(`[SKILLS] ✅ Final result: ${result.length} employees with skills`);
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

// Пакетное обновление оценок
export async function batchUpdateScores(items, scoreField) {
  console.log(`[BATCH UPDATE] Начинаем пакетное обновление ${items.length} записей`);
  
  let successful = 0;
  let failed = 0;
  const errors = [];
  
  // Параллельное обновление по 3 элемента для ускорения
  const BATCH_SIZE = 3;
  
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
        return { success: false, pageId: item.pageId, error: error.message };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    for (const result of batchResults) {
      if (result.success) {
        successful++;
      } else {
        failed++;
        errors.push({ pageId: result.pageId, error: result.error });
      }
    }
  }
  
  console.log(`[BATCH UPDATE] ✅ Завершено: ${successful} успешно, ${failed} ошибок`);
  
  return {
    successful,
    failed,
    errors: errors.length > 0 ? errors : undefined
  };
}