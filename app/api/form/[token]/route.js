export const runtime = "edge";

import { NextResponse } from "next/server";
import { verifyReviewToken } from "@/lib/token";
import {
  listEvaluateesForReviewer,
  fetchEmployeeSkillRowsForReviewer,
  ROLE_TO_FIELD,
  updateScore,
} from "@/lib/notion";

function t(s){return (s||"").trim();}

export async function GET(req, { params }) {
  try {
    const { reviewerId } = await verifyReviewToken(params.token);
    if (!t(reviewerId)) {
      return NextResponse.json({ error: "Invalid token (no reviewerId)" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const employeeId = t(searchParams.get("employeeId"));

    if (!employeeId) {
      // МОД 1: вернуть список сотрудников, которых этот ревьюер может оценить
      const evaluatees = await listEvaluateesForReviewer(reviewerId);
      return NextResponse.json({ evaluatees }); // [{employeeId, employeeName, role}]
    } else {
      // МОД 2: вернуть навыки для выбранного сотрудника + роль
      const { role, items } = await fetchEmployeeSkillRowsForReviewer(employeeId, reviewerId);
      if (!role) {
        return NextResponse.json({ error: "You are not assigned to this employee", items: [], role: null }, { status: 403 });
      }
      return NextResponse.json({ role, items });
    }
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function POST(req, { params }) {
  try {
    const { reviewerId } = await verifyReviewToken(params.token);
    const body = await req.json();
    const employeeId = t(body.employeeId);
    const items = Array.isArray(body.items) ? body.items : [];
    const commentProp = null; // комментарии пока отключим; включите нужную колонку, если хотите

    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required" }, { status: 400 });
    }

    // Определим роль по этому сотруднику и ревьюеру
    const { role } = await fetchEmployeeSkillRowsForReviewer(employeeId, reviewerId);
    if (!role) {
      return NextResponse.json({ error: "You are not assigned to this employee" }, { status: 403 });
    }
    const field = ROLE_TO_FIELD[role];

    // Бережно к лимитам Notion
    const queue = [...items];
    const workers = Array.from({ length: 2 }, async () => {
      while (queue.length) {
        const it = queue.shift();
        await updateScore(it.pageId, field, it.value, it.comment, commentProp);
      }
    });
    await Promise.all(workers);

    return NextResponse.json({ ok: true, role });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
