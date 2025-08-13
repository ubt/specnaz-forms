import { Client } from "@notionhq/client";

export const notion = new Client({
  auth: process.env.NOTION_TOKEN,
  // совместимость с Edge/Workers
  fetch: (input, init) => fetch(input, init)
});

export const MATRIX_DB_ID = process.env.MATRIX_DB_ID;

export const ROLE_TO_FIELD = {
  self: "self_score",
  p1: "p1_score",
  p2: "p2_score",
  manager: "manager_score",
};

export const PROP = {
  employee: "Employee", // поменяйте на точное имя свойства из вашей БД
  skill: "Skill",       // поменяйте, если у вас называется иначе
  commentByRole: (r) => `${r}_comment`,
};

export async function fetchEmployeeSkillRows(employeeId, employeeIsRelation = true) {
  const filter = employeeIsRelation
    ? { property: PROP.employee, relation: { contains: employeeId } }
    : { property: PROP.employee, rich_text: { equals: employeeId } };

  const res = await notion.databases.query({
    database_id: MATRIX_DB_ID,
    filter,
    sorts: [{ property: PROP.skill, direction: "ascending" }],
    page_size: 100
  });
  return res.results;
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
