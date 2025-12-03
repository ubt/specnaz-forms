export const runtime = "edge";

import { NextResponse } from "next/server";
import { getEmployeePagesByUserId, setEmployeeUrl } from "@/lib/notion";

export async function POST(req) {
  try {
    const adminKey = (req.headers.get("x-admin-key") || "").trim();
    if (!adminKey || adminKey !== (process.env.ADMIN_KEY || "").trim()) {
      return NextResponse.json({ error: "Неверный ключ администратора" }, { status: 403 });
    }

    let body = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    }

    const items = Array.isArray(body.links) ? body.links : [];
    let updated = 0;

    for (const { userId, url } of items) {
      if (!userId || !url) continue;
      const pages = await getEmployeePagesByUserId(userId);
      if (!pages.length) continue;
      try {
        await setEmployeeUrl(pages[0].pageId, url);
        updated++;
      } catch (error) {
        // Update failed
      }
    }

    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
