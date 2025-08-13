export const runtime = "edge";

import { NextResponse } from "next/server";
import { signReviewToken } from "@/lib/token";

function t(s){return (s||"").trim();}

export async function POST(req) {
  const adminKey = t(req.headers.get("x-admin-key"));
  let body = {};
  try { body = await req.json(); } catch {}
  const bodyKey = t(body.adminKey);
  const provided = adminKey || bodyKey;

  const required = t(process.env.ADMIN_KEY);
  if (!required) return NextResponse.json({ error: "ADMIN_KEY missing in environment" }, { status: 500 });
  if (!provided) return NextResponse.json({ error: "No admin key provided" }, { status: 403 });
  if (provided !== required) return NextResponse.json({ error: "Admin key mismatch" }, { status: 403 });

  const reviewerId = t(body.reviewerId);
  const expDays = Number(body.expDays ?? 14);
  if (!reviewerId) return NextResponse.json({ error: "reviewerId is required" }, { status: 400 });

  const exp = Math.floor(Date.now()/1000) + expDays*24*3600;
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const token = await signReviewToken({ reviewerId, exp });
  const url = `${base}/form/${token}`;
  return NextResponse.json({ ok: true, url });
}
