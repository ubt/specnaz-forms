export const runtime = "edge";

import { NextResponse } from "next/server";
import { z } from "zod";
import { signReviewToken } from "@/lib/token";
import { findEmployeesByTeam, listReviewersForEmployees } from "@/lib/notion";

const ReqSchema = z.object({
  teamName: z.string().min(1),
  expDays: z.number().int().min(1).max(365).default(14),
  adminKey: z.string().optional()
});

function t(s){return (s||"").trim();}

export async function POST(req) {
  try {
    const hdrKey = t(req.headers.get("x-admin-key"));
    let body = {};
    try { body = await req.json(); } catch {}
    const parsed = ReqSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Некорректные параметры" }, { status: 400 });
    const { teamName, expDays } = parsed.data;

    const provided = hdrKey || t(parsed.data.adminKey);
    const required = t(process.env.ADMIN_KEY);
    if (!required) return NextResponse.json({ error: "ADMIN_KEY missing in environment" }, { status: 500 });
    if (provided !== required) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const base = t(process.env.NEXT_PUBLIC_BASE_URL);
    if (!base) return NextResponse.json({ error: "NEXT_PUBLIC_BASE_URL not set" }, { status: 500 });

    const employees = await findEmployeesByTeam(teamName);
    if (!employees?.length) return NextResponse.json({ error: "Команда не найдена или пуста" }, { status: 404 });

    const reviewers = await listReviewersForEmployees(employees);
    const exp = Math.floor(Date.now() / 1000) + expDays * 24 * 3600;

    const links = [];
    for (const r of reviewers) {
      const token = await signReviewToken({ reviewerUserId: r.reviewerUserId, role: r.role, exp });
      links.push({ name: r.name, url: `${base}/form/${token}` });
    }

    return NextResponse.json({ ok: true, teamName, count: links.length, links });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Internal Server Error" }, { status: 500 });
  }
}
