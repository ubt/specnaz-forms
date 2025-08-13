export const runtime = "edge";

import { NextResponse } from "next/server";
import { signReviewToken } from "@/lib/token";
import { findEmployeesByTeam, listReviewersForEmployees } from "@/lib/notion";

function t(s){return (s||"").trim();}

export async function POST(req) {
  const hdrKey = t(req.headers.get("x-admin-key"));
  let body = {};
  try { body = await req.json(); } catch {}
  const provided = hdrKey || t(body.adminKey);
  const required = t(process.env.ADMIN_KEY);
  if (!required) return NextResponse.json({ error: "ADMIN_KEY missing in environment" }, { status: 500 });
  if (!provided) return NextResponse.json({ error: "No admin key provided" }, { status: 403 });
  if (provided !== required) return NextResponse.json({ error: "Admin key mismatch" }, { status: 403 });

  const teamName = t(body.teamName);
  const expDays = Number(body.expDays ?? 14);
  if (!teamName) return NextResponse.json({ error: "teamName is required" }, { status: 400 });

  // 1) найдём сотрудников команды
  const employees = await findEmployeesByTeam(teamName); // [{pageId, name}]
  if (!employees.length) {
    return NextResponse.json({ links: [], teamName, note: "no_employees_found" });
  }

  // 2) соберём всех ревьюеров для этих сотрудников
  const reviewers = await listReviewersForEmployees(employees); // [{ reviewerId, reviewerUserId, name, idType }]
  if (!reviewers.length) {
    return NextResponse.json({ links: [], teamName, note: "no_reviewers_found" });
  }

  // 3) сгенерируем по ссылке на каждого
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const exp = Math.floor(Date.now()/1000) + expDays*24*3600;

  const links = [];
  for (const r of reviewers) {
    const token = await signReviewToken({ reviewerId: r.reviewerId, reviewerUserId: r.reviewerUserId, exp });
    links.push({
      name: r.name,
      idType: r.idType, // "page" или "user"
      url: `${base}/form/${token}`
    });
  }

  return NextResponse.json({ ok: true, teamName, count: links.length, links });
}
