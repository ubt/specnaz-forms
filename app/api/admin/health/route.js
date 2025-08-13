export const runtime = "edge";

import { NextResponse } from "next/server";

export async function GET() {
  const hasAdmin = !!(process.env.ADMIN_KEY && String(process.env.ADMIN_KEY).trim());
  const base = process.env.NEXT_PUBLIC_BASE_URL || null;
  return NextResponse.json({ hasAdminKey: hasAdmin, baseUrlSet: !!base });
}
