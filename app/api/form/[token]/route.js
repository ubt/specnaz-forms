export const runtime = "edge";

import { NextResponse } from "next/server";
import { verifyReviewToken } from "@/lib/token";
import { SubmitPayload } from "@/lib/schema";
import {
  listEvaluateesForReviewerUser,
  fetchEmployeeSkillRowsForReviewerUser,
  ROLE_TO_FIELD,
  updateScore,
  detectCommentProp,
} from "@/lib/notion";
import { rateLimit } from "@/lib/rateLimit";

function t(s){return (s||"").trim();}

export async function GET(req, { params }) {
  try {
    const payload = await verifyReviewToken(params.token);
    const reviewerUserId = t(payload?.reviewerUserId);
    if (!reviewerUserId) return NextResponse.json({ error: "Недействительный токен" }, { status: 401 });
    const employees = await listEvaluateesForReviewerUser(reviewerUserId);
    if (!employees?.length) return NextResponse.json({ rows: [] }, { headers: { "Cache-Control": "no-store" } });
    const rows = await fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId);
    return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(req, { params }) {
  try {
    const payload = await verifyReviewToken(params.token);
    const reviewerUserId = t(payload?.reviewerUserId);
    const role = t(payload?.role);
    if (!reviewerUserId) return NextResponse.json({ error: "Недействительный токен" }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch {}
    const parsed = SubmitPayload.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });

    const { items, mode } = parsed.data;
    const field = ROLE_TO_FIELD[role] || ROLE_TO_FIELD.peer; // fallback
    const commentProp = await detectCommentProp();

    // Gentle concurrency (2 workers) + rate limit to avoid 429
    const q = [...items];
    const workers = Array.from({ length: 2 }, async () => {
      while (q.length) {
        const it = q.shift();
        await rateLimit();
        await updateScore(it.pageId, field, it.value, it.comment, commentProp);
      }
    });
    await Promise.all(workers);

    return NextResponse.json({ ok: true, role });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
