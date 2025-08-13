export const runtime = "edge";

import { NextResponse } from "next/server";
import { verifyReviewToken } from "@/lib/token";
import { fetchEmployeeSkillRows, ROLE_TO_FIELD, updateScore, PROP } from "@/lib/notion";
import { SubmitPayload } from "@/lib/schema";

async function throttle(tasks, max = 2) {
  const res = []; let i = 0;
  const run = async () => { while (i < tasks.length) { const idx = i++; res[idx] = await tasks[idx](); } };
  await Promise.all(Array.from({ length: max }, run));
  return res;
}

export async function GET(_req, { params }) {
  try {
    const { employeeId, role } = await verifyReviewToken(params.token);
    const rows = await fetchEmployeeSkillRows(employeeId, /*employeeIsRelation*/ true);
    const items = rows.map((r) => {
      const p = r.properties;
      const skillName =
        p[PROP.skill]?.title?.[0]?.plain_text ??
        p[PROP.skill]?.rich_text?.[0]?.plain_text ?? "Skill";
      const current = p[ROLE_TO_FIELD[role]]?.number ?? null;
      return { pageId: r.id, skillName, current };
    });
    return NextResponse.json({ items, role });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
}

export async function POST(req, { params }) {
  try {
    const { role } = await verifyReviewToken(params.token);
    const { items, mode } = SubmitPayload.parse(await req.json());
    const field = ROLE_TO_FIELD[role];
    const commentProp = PROP.commentByRole(role);
    await throttle(items.map((it)=>()=>updateScore(it.pageId, field, it.value, it.comment, commentProp)), 2);
    return NextResponse.json({ ok: true, mode });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
