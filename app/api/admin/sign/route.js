export const runtime = "edge";

import { NextResponse } from "next/server";
import { signReviewToken } from "@/lib/token";

function t(s) { return (s || "").trim(); }

export async function POST(req) {
  // 1) берём ключ и из заголовка, и из body (любая опция подойдёт)
  const headerKey = t(req.headers.get("x-admin-key"));
  let body = {};
  try { body = await req.json(); } catch (_) {}
  const bodyKey = t(body.adminKey);
  const provided = headerKey || bodyKey;

  const required = t(process.env.ADMIN_KEY);
  if (!required) {
    return NextResponse.json({ error: "ADMIN_KEY missing in environment" }, { status: 500 });
  }
  if (!provided) {
    return NextResponse.json({ error: "No admin key provided" }, { status: 403 });
  }
  if (provided !== required) {
    return NextResponse.json({ error: "Admin key mismatch" }, { status: 403 });
  }

  const { employeeId, roles = ["self","p1","p2","manager"], expDays = 14 } = body;
  if (!employeeId) {
    return NextResponse.json({ error: "employeeId is required" }, { status: 400 });
  }

  const exp = Math.floor(Date.now()/1000) + Number(expDays)*24*3600;
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const links = [];
  for (const role of roles) {
    const token = await signReviewToken({ employeeId, role, exp });
    links.push({ role, url: `${base}/form/${token}` });
  }
  return NextResponse.json({ ok: true, links });
}
