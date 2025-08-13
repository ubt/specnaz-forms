import { Client } from "@notionhq/client";

export const notion = new Client({
  auth: process.env.NOTION_TOKEN,
  fetch: (input, init) => fetch(input, init)
});

export const MATRIX_DB_ID = process.env.MATRIX_DB_ID;

// Имена свойств в вашей матрице (можете переименовать под себя здесь)
export const PROP = {
  employee: "Сотрудник",
  skill: "Навык",        // если нет — возьмём title страницы
  p1: "P1_peer",
  p2: "P2_peer",
  manager: "Manager",
};

// Какой числовой столбец обновлять для роли
export const ROLE_TO_FIELD = {
  self: "Self_score",
  p1_peer: "P1_score",
  p2_peer: "P2_score",
  manager: "Manager_score",
};

// Получить схему БД, чтобы понимать, какие поля реально существуют
async function getDbProps() {
  const db = await notion.databases.retrieve({ database_id: MATRIX_DB_ID });
  return db.properties || {};
}

// Вытащить «человеческое» имя навыка из свойств страницы матрицы
export function getSkillNameFromProps(props) {
  // 1) Любое title-поле (оно всегда есть)
  for (const key in props) {
    const v = props[key];
    if (v?.type === "title" && v.title?.length) {
      return v.title.map(t => t.plain_text).join("");
    }
  }
  // 2) Текстовое поле Skill, если есть
  const s = props[PROP.skill];
  const rt = s?.rich_text;
  if (rt?.length) return rt.map(t => t.plain_text).join("");
  return "Skill";
}

// Вычислить роль ревьюера по конкретной строке матрицы
export function computeRoleOnRow(row, reviewerId, dbProps) {
  const p = row.properties;

  const has = (propName) => !!dbProps[propName];

  const relContains = (propName) => {
    const rel = p[propName]?.relation;
    return Array.isArray(rel) && rel.some(r => r?.id === reviewerId);
  };

  // self: если сам сотрудник = reviewer
  if (has(PROP.employee) && relContains(PROP.employee)) return "self";

  // p1
  if (has(PROP.p1) && relContains(PROP.p1)) return "p1_peer";
  // p2
  if (has(PROP.p2) && relContains(PROP.p2)) return "p2_peer";
  // manager
  if (has(PROP.manager) && relContains(PROP.manager)) return "manager";

  return null;
}

// Вернуть список сотрудников, которых может оценить reviewer, с вычисленной ролью
export async function listEvaluateesForReviewer(reviewerId) {
  const dbProps = await getDbProps();

  // Составим OR-фильтр только из реально существующих полей
  const orFilters = [];
  if (dbProps[PROP.employee]) orFilters.push({ property: PROP.employee, relation: { contains: reviewerId } });
  if (dbProps[PROP.p1])      orFilters.push({ property: PROP.p1,      relation: { contains: reviewerId } });
  if (dbProps[PROP.p2])      orFilters.push({ property: PROP.p2,      relation: { contains: reviewerId } });
  if (dbProps[PROP.manager]) orFilters.push({ property: PROP.manager, relation: { contains: reviewerId } });

  if (orFilters.length === 0) return []; // ничего не настроено в БД

  // Получаем подходящие строки (любой навык) и сгруппируем по Employee
  const res = await notion.databases.query({
    database_id: MATRIX_DB_ID,
    filter: { or: orFilters },
    sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
    page_size: 100
  });

  const map = new Map(); // employeeId -> { employeeId, role }
  for (const row of res.results) {
    const p = row.properties;
    const empRel = p[PROP.employee]?.relation;
    const employeeId = Array.isArray(empRel) && empRel[0]?.id;
    if (!employeeId) continue;

    const role = computeRoleOnRow(row, reviewerId, dbProps);
    if (!role) continue;

    if (!map.has(employeeId)) {
      map.set(employeeId, { employeeId, role });
    }
  }

  // Попробуем получить имена сотрудников (title их страниц)
  const list = Array.from(map.values());
  // Бережно к лимитам: последовательно
  for (const item of list) {
    try {
      const page = await notion.pages.retrieve({ page_id: item.employeeId });
      // найдём title
      const props = page.properties || {};
      let name = null;
      for (const key in props) {
        const v = props[key];
        if (v?.type === "title" && v.title?.length) {
          name = v.title.map(t => t.plain_text).join("");
          break;
        }
      }
      item.employeeName = name || item.employeeId;
    } catch {
      item.employeeName = item.employeeId;
    }
  }

  return list;
}

// Вернуть список навыков (строки матрицы) для выбранного сотрудника с учётом роли ревьюера
export async function fetchEmployeeSkillRowsForReviewer(employeeId, reviewerId) {
  const dbProps = await getDbProps();

  // Все строки по сотруднику
  const res = await notion.databases.query({
    database_id: MATRIX_DB_ID,
    filter: { property: PROP.employee, relation: { contains: employeeId } },
    sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
    page_size: 100
  });

  if (!res.results.length) return { role: null, items: [] };

  // Вычислим роль по первой подходящей строке
  let role = null;
  for (const row of res.results) {
    role = computeRoleOnRow(row, reviewerId, dbProps);
    if (role) break;
  }
  if (!role) return { role: null, items: [] };

  const items = res.results.map((r) => {
    const props = r.properties;
    // Текущее значение
    const field = ROLE_TO_FIELD[role];
    const current = props[field]?.number ?? null;
    const skillName = getSkillNameFromProps(props);
    return { pageId: r.id, skillName, current };
  });

  return { role, items };
}

// Обновление числа/комментария
export async function updateScore(pageId, field, value, comment, commentProp) {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      [field]: { number: value },
      ...(commentProp ? { [commentProp]: { rich_text: [{ text: { content: comment ?? "" } }] } } : {})
    }
  });
}
