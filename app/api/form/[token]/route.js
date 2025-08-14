export const runtime = "edge";

import { NextResponse } from "next/server";
import { verifyReviewToken } from "@/lib/token";
import {
  listEvaluateesForReviewerUser,
  fetchEmployeeSkillRowsForReviewerUser,
  ROLE_TO_FIELD,
  updateScore,
} from "@/lib/notion";

function t(s){return (s||"").trim();}

export async function GET(req, { params }) {
  try {
    const payload = await verifyReviewToken(params.token);
    const reviewerUserId = t(payload.reviewerUserId);
    if (!reviewerUserId) {
      return NextResponse.json({ error: "Invalid token (no reviewerUserId)" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const employeeId = t(searchParams.get("employeeId"));

    if (!employeeId) {
      const { evaluatees, warning } = await listEvaluateesForReviewerUser(reviewerUserId);
      if (warning === "no_compatible_filters") {
        return NextResponse.json({
          error: "В БД не найдены совместимые поля для фильтрации по People/Relation.",
          evaluatees: []
        }, { status: 400 });
      }
      return NextResponse.json({ evaluatees });
    } else {
      const { role, items } = await fetchEmployeeSkillRowsForReviewerUser(employeeId, reviewerUserId);
      if (!role) {
        return NextResponse.json({ error: "Вы не назначены оценивать этого сотрудника", items: [], role: null }, { status: 403 });
      }
      return NextResponse.json({ role, items });
    }
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function POST(req, { params }) {
  try {
    const payload = await verifyReviewToken(params.token);
    const reviewerUserId = t(payload.reviewerUserId);
    if (!reviewerUserId) {
      return NextResponse.json({ error: "Invalid token (no reviewerUserId)" }, { status: 401 });
    }

    const body = await req.json();
    const employeeId = t(body.employeeId);
    const items = Array.isArray(body.items) ? body.items : [];
    const commentProp = null; // при необходимости укажите имя поля для комментариев

    if (!employeeId) return NextResponse.json({ error: "employeeId is required" }, { status: 400 });

    const { role } = await fetchEmployeeSkillRowsForReviewerUser(employeeId, reviewerUserId);
    if (!role) return NextResponse.json({ error: "Вы не назначены оценивать этого сотрудника" }, { status: 403 });

    const field = ROLE_TO_FIELD[role];
    const q = [...items];
    const workers = Array.from({ length: 2 }, async () => {
      while (q.length) {
        const it = q.shift();
        await updateScore(it.pageId, field, it.value, it.comment, commentProp);
      }
    });
    await Promise.all(workers);

    return NextResponse.json({ ok: true, role });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
