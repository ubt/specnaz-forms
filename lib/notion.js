import { Client } from "@notionhq/client";

export const notion = new Client({
  auth: process.env.NOTION_TOKEN,
  fetch: (input, init) => fetch(input, init)
});

export const MATRIX_DB_ID = process.env.MATRIX_DB_ID;
export const EMPLOYEES_DB_ID = process.env.EMPLOYEES_DB_ID;

// Имена колонок в ваших БД (переименуйте здесь при отличиях)
export const PROP = {
  // Матрица (Оценки компетенций)
  employee: "Сотрудник",
  skill: "Навык",                 // если у вас другое имя, поменяйте
  skillDesc: "Описание навыка",   // <- поле с описанием навыка (rich_text)
  p1: "P1_peer",
  p2: "P2_peer",
  manager: "Manager",
  // Сотрудники
  team: "Команда",                // поле "Команда" в БД "Сотрудники"
};

// Числовые поля для записи оценок
export const ROLE_TO_FIELD = {
  self: "self_score",
  p1_peer: "p1_score",
  p2_peer: "p2_score",
  manager: "manager_score",
};

// ---------- общие хелперы ----------
async function getDbProps(dbId) {
  const db = await notion.databases.retrieve({ database_id: dbId });
  return db.properties || {};
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

export function getSkillNameFromProps(props) {
  // 1) title страницы строки матрицы
  const t = getTitleFromProps(props);
  if (t) return t;
  // 2) текстовая колонка Skill
  const s = props[PROP.skill];
  const rt = s?.rich_text;
  if (rt?.length) return rt.map(t => t.plain_text).join("");
  return "Skill";
}

export function getSkillDescFromProps(props) {
  const d = props[PROP.skillDesc];
  const rt = d?.rich_text;
  if (rt?.length) return rt.map(t => t.plain_text).join("");
  return ""; // нет описания — ок
}

// --- роль ревьюера на конкретной строке матрицы ---
export function computeRoleOnRow(row, reviewer, matrixProps) {
  const p = row.properties;

  const has = (name) => !!matrixProps?.[name];
  const isRel = (name) => matrixProps?.[name]?.type === "relation";
  const isPeople = (name) => matrixProps?.[name]?.type === "people";

  const relHas = (name) => {
    const rel = p[name]?.relation;
    return Array.isArray(rel) && reviewer.pageId && rel.some(r => r?.id === reviewer.pageId);
  };
  const pplHas = (name) => {
    const ppl = p[name]?.people;
    return Array.isArray(ppl) && reviewer.userId && ppl.some(u => u?.id === reviewer.userId);
  };

  if (has(PROP.employee)) {
    if (isRel(PROP.employee) && relHas(PROP.employee)) return "self";
    if (isPeople(PROP.employee) && pplHas(PROP.employee)) return "self";
  }
  if (has(PROP.p1)) {
    if (isRel(PROP.p1) && relHas(PROP.p1)) return "p1_peer";
    if (isPeople(PROP.p1) && pplHas(PROP.p1)) return "p1_peer";
  }
  if (has(PROP.p2)) {
    if (isRel(PROP.p2) && relHas(PROP.p2)) return "p2_peer";
    if (isPeople(PROP.p2) && pplHas(PROP.p2)) return "p2_peer";
  }
  if (has(PROP.manager)) {
    if (isRel(PROP.manager) && relHas(PROP.manager)) return "manager";
    if (isPeople(PROP.manager) && pplHas(PROP.manager)) return "manager";
  }
  return null;
}

// ---------- Сотрудники: поиск по команде ----------
async function buildTeamFilter(teamProps, teamName) {
  const def = teamProps[PROP.team];
  if (!def) return null;
  if (def.type === "select") {
    return { property: PROP.team, select: { equals: teamName } };
  }
  if (def.type === "multi_select") {
    return { property: PROP.team, multi_select: { contains: teamName } };
  }
  if (def.type === "rich_text") {
    return { property: PROP.team, rich_text: { contains: teamName } };
  }
  if (def.type === "title") {
    return { property: PROP.team, title: { contains: teamName } };
  }
  // другой тип — нет фильтра
  return null;
}

// вернёт [{ pageId, name }]
export async function findEmployeesByTeam(teamName) {
  const teamProps = await getDbProps(EMPLOYEES_DB_ID);
  const filter = await buildTeamFilter(teamProps, teamName);
  if (!filter) return [];

  const res = await notion.databases.query({
    database_id: EMPLOYEES_DB_ID,
    filter,
    page_size: 100
  });

  const list = [];
  for (const row of res.results) {
    const name = getTitleFromProps(row.properties || {}) || row.id;
    list.push({ pageId: row.id, name });
  }
  return list;
}

// ---------- Сбор ревьюеров для заданного набора сотрудников ----------
function addReviewerToMap(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, value);
}

// вернёт [{ reviewerId, reviewerUserId, name, idType }]
export async function listReviewersForEmployees(employeePages) {
  if (employeePages.length === 0) return [];

  const matrixProps = await getDbProps(MATRIX_DB_ID);
  const employeeIsRelation = matrixProps[PROP.employee]?.type === "relation";
  const reviewers = new Map(); // ключ = "page:xxx" или "user:yyy"

  // обойдём сотрудников по одному (бережно к лимитам)
  for (const emp of employeePages) {
    // фильтр по Employee (Relation обязателен для этого шага)
    const employeeFilter = employeeIsRelation
      ? { property: PROP.employee, relation: { contains: emp.pageId } }
      : null;

    if (!employeeFilter) {
      // Если Employee в матрице — People, мы не сможем сопоставить по pageId сотрудника.
      // В этом случае лучше сделать Rollup "Команда" в матрицу и фильтровать по нему.
      // Пока пропускаем такого сотрудника.
      continue;
    }

    const res = await notion.databases.query({
      database_id: MATRIX_DB_ID,
      filter: employeeFilter,
      sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
      page_size: 100
    });

    for (const row of res.results) {
      const p = row.properties;

      // self — сам сотрудник (если employee — relation)
      if (employeeIsRelation) {
        addReviewerToMap(reviewers, `page:${emp.pageId}`, {
          reviewerId: emp.pageId, reviewerUserId: null, name: emp.name, idType: "page"
        });
      }

      // p1 / p2 / manager — поддерживаем relation и people
      for (const [propName, roleLabel] of [[PROP.p1,"p1"], [PROP.p2,"p2"], [PROP.manager,"manager"]]) {
        const def = matrixProps[propName];
        if (!def) continue;
        if (def.type === "relation") {
          const rel = p[propName]?.relation || [];
          for (const r of rel) {
            addReviewerToMap(reviewers, `page:${r.id}`, {
              reviewerId: r.id, reviewerUserId: null, name: null, idType: "page"
            });
          }
        } else if (def.type === "people") {
          const ppl = p[propName]?.people || [];
          for (const u of ppl) {
            addReviewerToMap(reviewers, `user:${u.id}`, {
              reviewerId: null, reviewerUserId: u.id, name: u.name || null, idType: "user"
            });
          }
        }
      }
    }
  }

  // дотянем имена там, где их нет
  for (const [key, r] of reviewers.entries()) {
    if (r.name) continue;
    if (r.idType === "page" && r.reviewerId) {
      try {
        const page = await notion.pages.retrieve({ page_id: r.reviewerId });
        r.name = getTitleFromProps(page.properties || {}) || r.reviewerId;
      } catch { r.name = r.reviewerId; }
    } else if (r.idType === "user" && r.reviewerUserId) {
      try {
        const u = await notion.users.retrieve({ user_id: r.reviewerUserId });
        r.name = u.name || r.reviewerUserId;
      } catch { r.name = r.reviewerUserId; }
    }
  }

  return Array.from(reviewers.values());
}

// ---------- Данные для формы ----------
export async function listEvaluateesForReviewer(reviewer) {
  const matrixProps = await getDbProps(MATRIX_DB_ID);

  const buildFilter = (prop) => {
    const def = matrixProps[prop];
    if (!def) return null;
    if (def.type === "relation" && reviewer.pageId) {
      return { property: prop, relation: { contains: reviewer.pageId } };
    }
    if (def.type === "people" && reviewer.userId) {
      return { property: prop, people: { contains: reviewer.userId } };
    }
    return null;
  };

  const orFilters = [
    buildFilter(PROP.employee),
    buildFilter(PROP.p1),
    buildFilter(PROP.p2),
    buildFilter(PROP.manager),
  ].filter(Boolean);

  if (!orFilters.length) return { evaluatees: [], warning: "no_compatible_filters" };

  const res = await notion.databases.query({
    database_id: MATRIX_DB_ID,
    filter: { or: orFilters },
    sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
    page_size: 100
  });

  // сгруппируем по Employee
  const list = [];
  for (const row of res.results) {
    const p = row.properties;

    // employeeId — если Relation: pageId; если People: userId
    let employeeId = null, employeeName = null;
    const def = matrixProps[PROP.employee];
    if (def?.type === "relation") {
      const rel = p[PROP.employee]?.relation;
      const id = Array.isArray(rel) && rel[0]?.id;
      if (id) {
        employeeId = id;
        try {
          const page = await notion.pages.retrieve({ page_id: id });
          employeeName = getTitleFromProps(page.properties || {}) || id;
        } catch { employeeName = id; }
      }
    } else if (def?.type === "people") {
      const ppl = p[PROP.employee]?.people;
      const id = Array.isArray(ppl) && ppl[0]?.id;
      if (id) {
        employeeId = id;
        try {
          const u = await notion.users.retrieve({ user_id: id });
          employeeName = u.name || id;
        } catch { employeeName = id; }
      }
    }

    if (!employeeId) continue;

    const role = computeRoleOnRow(row, reviewer, matrixProps);
    if (!role) continue;

    if (!list.find((x) => x.employeeId === employeeId)) {
      list.push({ employeeId, employeeName, role });
    }
  }

  return { evaluatees: list, warning: null };
}

export async function fetchEmployeeSkillRowsForReviewer(employeeId, reviewer) {
  const matrixProps = await getDbProps(MATRIX_DB_ID);

  // фильтр по Employee (relation или people)
  let employeeFilter = null;
  const def = matrixProps[PROP.employee];
  if (def?.type === "relation") {
    employeeFilter = { property: PROP.employee, relation: { contains: employeeId } };
  } else if (def?.type === "people") {
    employeeFilter = { property: PROP.employee, people: { contains: employeeId } };
  } else {
    return { role: null, items: [] };
  }

  const res = await notion.databases.query({
    database_id: MATRIX_DB_ID,
    filter: employeeFilter,
    sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
    page_size: 100
  });

  if (!res.results.length) return { role: null, items: [] };

  // определим роль по первой строке
  let role = null;
  for (const row of res.results) {
    role = computeRoleOnRow(row, reviewer, matrixProps);
    if (role) break;
  }
  if (!role) return { role: null, items: [] };

  const items = res.results.map((r) => {
    const props = r.properties;
    const field = ROLE_TO_FIELD[role];
    const current = props[field]?.number ?? null;
    const skillName = getSkillNameFromProps(props);
    const description = getSkillDescFromProps(props);
    return { pageId: r.id, skillName, description, current };
  });

  return { role, items };
}

export async function updateScore(pageId, field, value, comment, commentProp) {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      [field]: { number: value },
      ...(commentProp ? { [commentProp]: { rich_text: [{ text: { content: comment ?? "" } }] } } : {})
    }
  });
}
