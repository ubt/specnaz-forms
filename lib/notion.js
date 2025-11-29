// lib/notion.js - ДОРАБОТАННАЯ ВЕРСИЯ с поддержкой циклов оценки

import { Client } from "@notionhq/client";

export const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

export const MATRIX_DB_ID = process.env.MATRIX_DB_ID;
export const EMPLOYEES_DB_ID = process.env.EMPLOYEES_DB_ID;
export const CYCLES_DB_ID = process.env.CYCLES_DB_ID; // НОВАЯ переменная для БД циклов

function validateEnvironment() {
  const required = {
    NOTION_TOKEN: process.env.NOTION_TOKEN,
    MATRIX_DB_ID: process.env.MATRIX_DB_ID,
    EMPLOYEES_DB_ID: process.env.EMPLOYEES_DB_ID,
    JWT_SECRET: process.env.JWT_SECRET,
    CYCLES_DB_ID: process.env.CYCLES_DB_ID // ДОБАВЛЕНО
  };
  
  const missing = Object.entries(required)
    .filter(([key, value]) => !value)
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

export const PROP = {
  // БД "Оценки компетенций" (Matrix)
  employee: "Сотрудник",
  cycle: "Цикл", // ВАЖНО: это поле связывает оценку с циклом
  skill: "Навык",
  skillName: "Навык - название",
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
  
  // БД "Циклы оценки"
  cycleStatus: "Статус",
  cycleName: "Наименование",
};

// Остальные константы без изменений
export const ROLE_TO_FIELD = {
  self: "Self_score",
  p1_peer: "P1_score", 
  p2_peer: "P2_score",
  manager: "Manager_score",
  peer: "P1_score",
};

export const ROLE_TO_SCORER_FIELD = {
  self: "Self_scorer",
  p1_peer: "P1_peer",
  p2_peer: "P2_peer", 
  manager: "Manager_scorer",
};

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

// Кэш для Edge Runtime с TTL
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;
const DB_CACHE_TTL = 30 * 60 * 1000;

function getCached(key, customTTL) {
  const item = cache.get(key);
  const ttl = customTTL || CACHE_TTL;
  if (item && Date.now() - item.timestamp < ttl) {
    return item.data;
  }
  cache.delete(key);
  return null;
}

function setCached(key, data, customTTL) {
  cache.set(key, { data, timestamp: Date.now() });
  
  if (cache.size > 100) {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
      if (now - v.timestamp > (customTTL || CACHE_TTL)) {
        cache.delete(k);
      }
    }
  }
}

// Rate limiter
let lastRequest = 0;
const requestQueue = [];

async function optimizedRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequest;
  const minDelay = requestQueue.length > 5 ? 200 : 100;
  
  if (timeSinceLastRequest < minDelay) {
    await new Promise(resolve => setTimeout(resolve, minDelay - timeSinceLastRequest));
  }
  lastRequest = Date.now();
}

async function notionApiCall(apiCall, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await optimizedRateLimit();
      const result = await apiCall();
      return result;
    } catch (error) {
      console.error(`[NOTION API] Attempt ${attempt + 1} failed:`, error.message);
      
      if (error?.status === 429) {
        const delay = Math.min(500 * Math.pow(2, attempt), 5000);
        console.log(`[NOTION API] Rate limited, waiting ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      if (error?.status >= 500 && error?.status < 600 && attempt < maxRetries - 1) {
        const delay = 500 * (attempt + 1);
        console.log(`[NOTION API] Server error, retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      throw error;
    }
  }
}

async function queryAllPages(params) {
  const pageSize = Math.min(params.page_size || 100, 100);
  let start_cursor = undefined;
  let results = [];
  let pageCount = 0;
  const maxPages = 20;
  
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

async function getDbProps(dbId) {
  const cacheKey = `db_props_${dbId}`;
  const cached = getCached(cacheKey, DB_CACHE_TTL);
  if (cached) return cached;
  
  const db = await notionApiCall(() => 
    notion.databases.retrieve({ database_id: dbId })
  );
  
  setCached(cacheKey, db.properties, DB_CACHE_TTL);
  return db.properties;
}

// ============================================================
// НОВАЯ ФУНКЦИЯ: Получение активного цикла оценки
// ============================================================
export async function getActiveCycle() {
  console.log('[ACTIVE CYCLE] Поиск активного цикла оценки...');
  
  // Проверяем кэш
  const cacheKey = 'active_cycle';
  const cached = getCached(cacheKey, 5 * 60 * 1000); // Кэшируем на 5 минут
  if (cached) {
    console.log('[ACTIVE CYCLE] Возвращаем закэшированный активный цикл:', cached.name);
    return cached;
  }
  
  try {
    if (!CYCLES_DB_ID) {
      throw new Error('CYCLES_DB_ID не настроен в переменных окружения');
    }
    
    // Ищем циклы со статусом "In Progress"
    const result = await notionApiCall(() =>
      notion.databases.query({
        database_id: CYCLES_DB_ID,
        filter: {
          property: PROP.cycleStatus,
          status: { equals: "In Progress" }
        },
        page_size: 1
      })
    );
    
    if (!result.results || result.results.length === 0) {
      console.warn('[ACTIVE CYCLE] Не найдено активных циклов оценки со статусом "In Progress"');
      return null;
    }
    
    const cyclePage = result.results[0];
    const props = cyclePage.properties;
    
    const activeCycle = {
      pageId: cyclePage.id,
      name: getTitleFromProps(props) || 'Unnamed Cycle',
      status: props[PROP.cycleStatus]?.status?.name || 'Unknown',
      startDate: props[PROP.cycleStartDate]?.date?.start || null,
      endDate: props[PROP.cycleEndDate]?.date?.start || null
    };
    
    console.log('[ACTIVE CYCLE] Найден активный цикл:', activeCycle.name, `(ID: ${activeCycle.pageId})`);
    
    // Кэшируем результат
    setCached(cacheKey, activeCycle, 5 * 60 * 1000);
    
    return activeCycle;
    
  } catch (error) {
    console.error('[ACTIVE CYCLE] Ошибка получения активного цикла:', error.message);
    throw new Error(`Не удалось получить активный цикл оценки: ${error.message}`);
  }
}

// Остальные функции без изменений до fetchEmployeeSkillRowsForReviewerUser
// ... (копируем все функции: findEmployeesByTeam, getEmployeeNamesByUserIds, listReviewersForEmployees, 
//      computeRoleOnRow, getEmployeePagesByUserId, listEvaluateesForReviewerUser, loadSkillInformation)

// ============================================================
// ДОРАБОТАННАЯ ФУНКЦИЯ: Загрузка навыков с фильтрацией по циклу
// ============================================================
export async function fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId) {
  console.log(`[SKILLS] Starting skill loading for ${employees.length} employees, reviewer: ${reviewerUserId}`);

  try {
    // НОВОЕ: Получаем активный цикл
    const activeCycle = await getActiveCycle();
    
    if (!activeCycle) {
      console.warn('[SKILLS] Активный цикл не найден. Навыки не будут загружены.');
      return [];
    }
    
    console.log(`[SKILLS] Используем активный цикл: ${activeCycle.name} (ID: ${activeCycle.pageId})`);
    
    const matrixProps = await getDbProps(MATRIX_DB_ID);
    const myPages = await getEmployeePagesByUserId(reviewerUserId);
    const reviewerCtx = { userId: reviewerUserId, pageIds: myPages.map(x => x.pageId) };

    console.log(`[SKILLS] Reviewer context:`, { 
      userId: reviewerUserId, 
      pageIds: reviewerCtx.pageIds.length,
      pages: myPages.map(p => p.name)
    });

    const result = [];

    // Один запрос для получения всех строк по всем сотрудникам
    let allRows = [];
    if (employees.length > 0) {
      const empDef = matrixProps[PROP.employee];
      
      // НОВОЕ: Создаем комбинированный фильтр с циклом
      let employeeFilters = [];
      
      if (empDef?.type === "relation") {
        employeeFilters = employees.map(e => ({
          property: PROP.employee,
          relation: { contains: e.employeeId }
        }));
      } else if (empDef?.type === "people") {
        employeeFilters = employees.map(e => ({
          property: PROP.employee,
          people: { contains: e.employeeId }
        }));
      }
      
      if (employeeFilters.length > 0) {
        // КРИТИЧЕСКОЕ ИЗМЕНЕНИЕ: Добавляем фильтр по циклу
        const combinedFilter = {
          and: [
            // Фильтр по циклу (обязательно)
            {
              property: PROP.cycle,
              relation: { contains: activeCycle.pageId }
            },
            // Фильтр по сотрудникам (OR)
            employeeFilters.length === 1 ? employeeFilters[0] : { or: employeeFilters }
          ]
        };
        
        console.log('[SKILLS] Запрос с фильтром по циклу и сотрудникам:', JSON.stringify(combinedFilter, null, 2));
        
        allRows = await queryAllPages({
          database_id: MATRIX_DB_ID,
          filter: combinedFilter,
          page_size: 100
        });
        
        console.log(`[SKILLS] Query с фильтром по циклу вернул ${allRows.length} строк`);
      } else {
        console.warn(`[SKILLS] Не удалось создать фильтры для сотрудников`);
        allRows = [];
      }
    }

    // Проходим по каждому сотруднику и выделяем только его строки из allRows
    for (const employee of employees) {
      console.log(`[SKILLS] Processing employee: ${employee.employeeName} (${employee.employeeId})`);
      
      try {
        // Фильтруем строки для текущего сотрудника
        const employeeRows = allRows.filter(row => {
          const props = row.properties;
          const empProp = props[PROP.employee];
          if (!empProp) return false;
          
          if (empProp.type === "relation") {
            return empProp.relation?.some(r => r.id === employee.employeeId);
          } else if (empProp.type === "people") {
            return empProp.people?.some(p => p.id === employee.employeeId);
          }
          return false;
        });

        console.log(`[SKILLS] Found ${employeeRows.length} rows for employee ${employee.employeeName} in active cycle`);

        if (!employeeRows.length) {
          console.warn(`[SKILLS] No matrix rows found for employee ${employee.employeeName} in active cycle`);
          continue;
        }

        // Определяем роль ревьюера и отбираем нужные навыки
        const relevantRows = [];
        let detectedRole = null;
        
        for (const row of employeeRows) {
          const role = computeRoleOnRow(row, reviewerCtx, matrixProps);
          if (role === employee.role) {
            relevantRows.push(row);
            if (!detectedRole) detectedRole = role;
          }
        }

        if (!detectedRole) {
          console.warn(`[SKILLS] No matching role ${employee.role} for reviewer ${reviewerUserId} on employee ${employee.employeeName}`);
          continue;
        }

        console.log(`[SKILLS] Detected role: ${detectedRole} for ${employee.employeeName}, ${relevantRows.length} relevant rows`);

        // Собираем уникальные навыки и текущие оценки
        const uniqueSkills = new Map();
        const scoreField = ROLE_TO_FIELD[detectedRole] || ROLE_TO_FIELD.peer;
        
        for (const row of relevantRows) {
          const props = row.properties;
          const skillRel = props[PROP.skill]?.relation;
          const skillId = skillRel?.[0]?.id;
          if (!skillId) continue;
          
          if (!uniqueSkills.has(skillId)) {
            const currentScore = props[scoreField]?.number ?? null;
            uniqueSkills.set(skillId, {
              pageId: row.id,
              skillId,
              current: currentScore,
              matrixRowProps: props
            });
          }
        }
        
        console.log(`[SKILLS] Found ${uniqueSkills.size} unique skills for ${employee.employeeName}`);

        // Параллельная загрузка информации о навыках
        const items = [];
        const skillEntries = Array.from(uniqueSkills.values());
        const BATCH_SIZE = 10;
        
        for (let i = 0; i < skillEntries.length; i += BATCH_SIZE) {
          const batch = skillEntries.slice(i, i + BATCH_SIZE);
          
          const batchPromises = batch.map(async skillEntry => {
            try {
              const skillInfo = await loadSkillInformation(skillEntry.skillId, skillEntry.matrixRowProps);
              return {
                pageId: skillEntry.pageId,
                name: skillInfo.name,
                description: skillInfo.description,
                current: skillEntry.current
              };
            } catch (err) {
              console.error(`[SKILLS] Error loading skill ${skillEntry.skillId}:`, err.message);
              return {
                pageId: skillEntry.pageId,
                name: `Навык ${skillEntry.skillId.slice(-8)}`,
                description: `Ошибка загрузки: ${err.message}`,
                current: skillEntry.current
              };
            }
          });
          
          const batchResults = await Promise.all(batchPromises);
          items.push(...batchResults);
        }

        if (items.length > 0) {
          result.push({
            employeeId: employee.employeeId,
            employeeName: employee.employeeName,
            role: detectedRole,
            items,
            cycleId: activeCycle.pageId, // НОВОЕ: добавляем ID цикла
            cycleName: activeCycle.name  // НОВОЕ: добавляем название цикла
          });
          console.log(`[SKILLS] ✅ Added ${items.length} skills for ${employee.employeeName} (role: ${detectedRole}, cycle: ${activeCycle.name})`);
        } else {
          console.warn(`[SKILLS] No skills found for ${employee.employeeName} in active cycle`);
        }

      } catch (employeeError) {
        console.error(`[SKILLS] Error processing employee ${employee.employeeName}:`, employeeError.message);
        continue;
      }
    }

    console.log(`[SKILLS] ✅ Загружено навыков для ${result.length} сотрудников из активного цикла "${activeCycle.name}"`);
    return result;
    
  } catch (error) {
    console.error(`[SKILLS] Critical error: ${error.message}`);
    throw error;
  }
}

// Остальные функции без изменений
// (updateScore, setEmployeeUrl, и все вспомогательные функции остаются как есть)

// ВАЖНО: Добавьте следующие функции в полный файл если их там нет:
// - findEmployeesByTeam
// - getEmployeeNamesByUserIds  
// - listReviewersForEmployees
// - computeRoleOnRow
// - getEmployeePagesByUserId
// - listEvaluateesForReviewerUser
// - loadSkillInformation
// - updateScore
// - setEmployeeUrl

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

// Копируйте остальные функции из оригинального файла
// (все функции которые я указал выше должны быть скопированы без изменений)