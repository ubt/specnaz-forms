import { Client } from "@notionhq/client";

export const notion = new Client({
  auth: process.env.NOTION_TOKEN,
  fetch: (input, init) => fetch(input, init)
});

export const MATRIX_DB_ID = process.env.MATRIX_DB_ID;
export const EMPLOYEES_DB_ID = process.env.EMPLOYEES_DB_ID;

// --- ИМЕНА КОЛОНОК (поправьте под свои, если отличаются) ---
export const PROP = {
  // БД "Оценки компетенций"
  employee: "Employee",            // Relation или People
  p1: "P1_peer",                   // Relation или People
  p2: "P2_peer",                   // Relation или People
  manager: "Manager",              // Relation или People
  skill: "Skill",                  // если нет — используем title
  skillDesc: "описание навыка",    // rich_text описание
  // БД "Сотрудники"
  team: "Команда",                 // select / multi_select / text / title
  empAccount: "Учетка",            // People (Notion user)
  empTitle: "Сотрудник",           // title (название карточки сотрудника)
};

// Числовые поля для записи оценок
export const ROLE_TO_FIELD = {
  self: "self_score",
  p1_peer: "p1_score",
  p2_peer: "p2_score",
  manager: "manager_score",
};

// ---------------- helpers ----------------
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
  const t = getTitleFromProps(props);
  if (t) return t;
  const s = props[PROP.skill];
  const rt = s?.rich_text;
  if (rt?.length) return rt.map(t => t.plain_text).join("");
  return "Skill";
}

export function getSkillDescFromProps(props) {
  const d = props[PROP.skillDesc];
  const rt = d?.rich_text;
  if (rt?.length) return rt.map(t => t.plain_text).join("");
  return "";
}

// --- "Сотрудники": поиск по команде ---
async function buildTeamFilter(teamProps, teamName) {
  const def = teamProps[PROP.team];
  if (!def) return null;
  if (def.type === "select")      return { property: PROP.team, select: { equals: teamName } };
  if (def.type === "multi_select")return { property: PROP.team, multi_select: { contains: teamName } };
  if (def.type === "rich_text")   return { property: PROP.team, rich_text: { contains: teamName } };
  if (def.type === "title")       return { property: PROP.team, title: { contains: teamName } };
  return null;
}

// [{ pageId, name, userIds: string[] }]
export async function findEmployeesByTeam(teamName) {
  const teamProps = await getDbProps(EMPLOYEES_DB_ID);
  const filter = await buildTeamFilter(teamProps, teamName);
  if (!filter) return [];

  const res = await notion.databases.query({
    database_id: EMPLOYEES_DB_ID,
    filter,
    page_size: 200
  });

  const list = [];
  for (const row of res.results) {
    const props = row.properties || {};
    const name = getTitleFromProps(props) || row.id;
    const users = props[PROP.empAccount]?.people || [];
    const userIds = users.map(u => u?.id).filter(Boolean);
    list.push({ pageId: row.id, name, userIds });
  }
  return list;
}

// Поиск карточек "Сотрудник" по Notion userId (People -> содержит)
export async function getEmployeePagesByUserId(userId) {
  const props = await getDbProps(EMPLOYEES_DB_ID);
  if (props[PROP.empAccount]?.type !== "people") return [];
  const res = await notion.databases.query({
    database_id: EMPLOYEES_DB_ID,
    filter: { property: PROP.empAccount, people: { contains: userId } },
    page_size: 10
  });
  return res.results.map(row => ({
    pageId: row.id,
    name: getTitleFromProps(row.properties || {}) || row.id
  }));
}

export async function getEmployeeNameByUserId(userId) {
  const pages = await getEmployeePagesByUserId(userId);
  if (pages.length) return pages[0].name;
  try {
    const u = await notion.users.retrieve({ user_id: userId });
    return u.name || userId;
  } catch { return userId; }
}

// ------------ вычисление роли на строке матрицы ------------
export function computeRoleOnRow(row, reviewerCtx, matrixProps) {
  const p = row.properties;
  const has = n => !!matrixProps?.[n];
  const isRel = n => matrixProps?.[n]?.type === "relation";
  const isPeople = n => matrixProps?.[n]?.type === "people";

  const relHasAny = n => {
    const rel = p[n]?.relation;
    return Array.isArray(rel) && reviewerCtx.pageIds?.length &&
           rel.some(r => reviewerCtx.pageIds.includes(r?.id));
  };
  const pplHas = n => {
    const ppl = p[n]?.people;
    return Array.isArray(ppl) && reviewerCtx.userId &&
           ppl.some(u => u?.id === reviewerCtx.userId);
  };

  if (has(PROP.employee)) {
    if (isRel(PROP.employee) && relHasAny(PROP.employee)) return "self";
    if (isPeople(PROP.employee) && pplHas(PROP.employee))  return "self";
  }
  if (has(PROP.p1)) {
    if (isRel(PROP.p1) && relHasAny(PROP.p1)) return "p1_peer";
    if (isPeople(PROP.p1) && pplHas(PROP.p1)) return "p1_peer";
  }
  if (has(PROP.p2)) {
    if (isRel(PROP.p2) && relHasAny(PROP.p2)) return "p2_peer";
    if (isPeople(PROP.p2) && pplHas(PROP.p2)) return "p2_peer";
  }
  if (has(PROP.manager)) {
    if (isRel(PROP.manager) && relHasAny(PROP.manager)) return "manager";
    if (isPeople(PROP.manager) && pplHas(PROP.manager))  return "manager";
  }
  return null;
}

// ------------ собрать ревьюеров для набора сотрудников -------------
// employees: [{pageId, name, userIds}]
export async function listReviewersForEmployees(employees) {
  if (!employees.length) return [];

  const matrixProps = await getDbProps(MATRIX_DB_ID);
  const reviewers = new Map(); // ключ: userId -> { reviewerUserId, name }

  // helper: добавить ревьюера по userId
  const addUser = async (userId) => {
    if (!userId) return;
    if (!reviewers.has(userId)) {
      const name = await getEmployeeNameByUserId(userId);
      reviewers.set(userId, { reviewerUserId: userId, name });
    }
  };

  for (const emp of employees) {
    // 1) self: все userId, привязанные к карточке сотрудника (через "Учетка")
    for (const uid of emp.userIds) await addUser(uid);

    // 2) пробежим строки матрицы этого сотрудника (Employee = relation на его страницу)
    if (matrixProps[PROP.employee]?.type !== "relation") continue;

    const res = await notion.databases.query({
      database_id: MATRIX_DB_ID,
      filter: { property: PROP.employee, relation: { contains: emp.pageId } },
      page_size: 200
    });

    for (const row of res.results) {
      const p = row.properties;

      for (const propName of [PROP.p1, PROP.p2, PROP.manager]) {
        const def = matrixProps[propName];
        if (!def) continue;

        if (def.type === "people") {
          const ppl = p[propName]?.people || [];
          for (const u of ppl) await addUser(u?.id);
        } else if (def.type === "relation") {
          const rel = p[propName]?.relation || [];
          for (const r of rel) {
            // relation -> страница в "Сотрудники" -> её "Учетка" (People) -> userId
            try {
              const page = await notion.pages.retrieve({ page_id: r.id });
              const props = page.properties || {};
              const ppl = props[PROP.empAccount]?.people || [];
              for (const u of ppl) await addUser(u?.id);
            } catch { /* skip */ }
          }
        }
      }
    }
  }

  return Array.from(reviewers.values()); // [{ reviewerUserId, name }]
}

// -------- список "кого я могу оценить" по reviewerUserId ----------
export async function listEvaluateesForReviewerUser(userId) {
  const matrixProps = await getDbProps(MATRIX_DB_ID);
  // карточки сотрудника (если он есть в "Сотрудники")
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
    ...buildFilters(PROP.p1),
    ...buildFilters(PROP.p2),
    ...buildFilters(PROP.manager),
  ];

  if (!orFilters.length) return { evaluatees: [], warning: "no_compatible_filters" };

  const res = await notion.databases.query({
    database_id: MATRIX_DB_ID,
    filter: { or: orFilters },
    sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
    page_size: 200
  });

  const list = [];
  for (const row of res.results) {
    const p = row.properties;
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
        employeeName = await getEmployeeNameByUserId(id);
      }
    }

    if (!employeeId) continue;

    const reviewerCtx = { userId, pageIds: myPageIds };
    const role = computeRoleOnRow(row, reviewerCtx, matrixProps);
    if (!role) continue;

    if (!list.find(x => x.employeeId === employeeId)) {
      list.push({ employeeId, employeeName, role });
    }
  }

  return { evaluatees: list, warning: null };
}

// -------- навыки по сотруднику для reviewerUserId ------------
export async function fetchEmployeeSkillRowsForReviewerUser(employeeId, userId) {
  const matrixProps = await getDbProps(MATRIX_DB_ID);

  // employeeId может быть pageId (если Employee=relation) или userId (если Employee=people)
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
    page_size: 200
  });
  if (!res.results.length) return { role: null, items: [] };

  const myPages = await getEmployeePagesByUserId(userId);
  const reviewerCtx = { userId, pageIds: myPages.map(x => x.pageId) };

  let role = null;
  for (const row of res.results) {
    role = computeRoleOnRow(row, reviewerCtx, matrixProps);
    if (role) break;
  }
  if (!role) return { role: null, items: [] };

  const items = res.results.map(r => {
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
