export const runtime = "edge";

import { signReviewToken } from "@/lib/token";
import { findEmployeesByTeam, listReviewersForEmployees } from "@/lib/notion";

function t(s) {
  return (s || "").trim();
}

export async function POST(req) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (data) => writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

  (async () => {
    try {
      let body = {};
      try {
        body = await req.json();
      } catch {
        send({ error: "Некорректный JSON" });
        return;
      }

      const teamName = t(body.teamName);
      const expDays = Number(body.expDays || 14);
      const adminKey = t(body.adminKey);

      if (!teamName) {
        send({ error: "Название команды обязательно" });
        return;
      }
      if (t(process.env.ADMIN_KEY) !== adminKey) {
        send({ error: "Неверный ключ администратора" });
        return;
      }

      const employees = await findEmployeesByTeam(teamName);
      if (!employees?.length) {
        send({ error: `Команда \"${teamName}\" не найдена` });
        return;
      }

      const reviewers = await listReviewersForEmployees(employees);
      if (!reviewers?.length) {
        send({ error: `Не найдено ревьюеров для команды \"${teamName}\"` });
        return;
      }

      send({ progress: 0, total: reviewers.length });

      const exp = Math.floor(Date.now() / 1000) + expDays * 24 * 3600;
      const links = [];

      for (const reviewer of reviewers) {
        try {
          const token = await signReviewToken({
            reviewerUserId: reviewer.reviewerUserId,
            role: reviewer.role || "peer",
            teamName,
            exp
          });
          links.push({
            name: reviewer.name,
            url: `${process.env.NEXT_PUBLIC_BASE_URL}/form/${token}`,
            userId: reviewer.reviewerUserId,
            role: reviewer.role || "peer"
          });
        } catch (error) {
          send({ error: `Ошибка генерации для ${reviewer.name}: ${error.message}` });
        }
        send({ progress: Math.round((links.length / reviewers.length) * 100) });
      }

      send({ done: true, teamName, count: links.length, links, progress: 100 });
    } catch (error) {
      send({ error: error.message || "Неизвестная ошибка" });
    } finally {
      writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    }
  });
}
