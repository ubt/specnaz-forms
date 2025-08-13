export const runtime = "edge";

import { NextResponse } from "next/server";
import { signReviewToken } from "@/lib/token";

export async function POST(req) {
  // Простая защита: заголовок X-Admin-Key должен совпадать с ADMIN_KEY (env)
  const adminKey = req.headers.get("x-admin-key");
  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { employeeId, roles = ["self","p1","p2","manager"], expDays = 14 } = await req.json();
  const exp = Math.floor(Date.now()/1000) + expDays*24*3600;
  const base = process.env.NEXT_PUBLIC_BASE_URL;

  const links = [];
  for (const role of roles) {
    const token = await signReviewToken({ employeeId, role, exp });
    links.push({ role, url: `${base}/form/${token}` });
  }
  return NextResponse.json({ links });
}
