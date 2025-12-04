// Cloudflare Worker для обработки очереди Notion операций
// ИСПРАВЛЕНО: Защита от превышения лимита subrequests (50)
//
// Переменные окружения:
// - NOTION_TOKEN (обязательно)
// - NOTION_QUEUE_KV (KV binding, обязательно)
// - SAFE_SUBREQUEST_LIMIT (по умолчанию 40)
// - MAX_JOBS_PER_RUN (по умолчанию 5)
// - CONCURRENCY (по умолчанию 1)
// - RATE_LIMIT_MS (по умолчанию 2000)
// - MAX_RETRIES (по умолчанию 3)
// - NOTION_VERSION (по умолчанию "2022-06-28")
// - DRAIN_TOKEN (опционально, для защиты endpoints)

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(drainOnce(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    // Ручной запуск дренажа очереди
    if (url.pathname === "/drain" && (request.method === "POST" || request.method === "GET")) {
      if (env.DRAIN_TOKEN) {
        const auth = request.headers.get("authorization") || "";
        const ok = auth.toLowerCase().startsWith("bearer ") && auth.slice(7) === env.DRAIN_TOKEN;
        if (!ok) return new Response("Unauthorized", { status: 401 });
      }
      const res = await drainOnce(env);
      return json(res);
    }

    // Быстрый healthcheck
    if (url.pathname === "/health") {
      return json({ ok: true, now: new Date().toISOString() });
    }

    // Проверка токена Notion
    if (url.pathname === "/self-test" && request.method === "GET") {
      if (env.DRAIN_TOKEN) {
        const auth = request.headers.get("authorization") || "";
        const ok = auth.toLowerCase().startsWith("bearer ") && auth.slice(7) === env.DRAIN_TOKEN;
        if (!ok) return new Response("Unauthorized", { status: 401 });
      }
      const res = await fetch("https://api.notion.com/v1/users/me", {
        headers: {
          "Authorization": `Bearer ${env.NOTION_TOKEN}`,
          "Notion-Version": env.NOTION_VERSION || "2022-06-28"
        }
      });
      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    return new Response("OK", { status: 200 });
  }
};

/**
 * Основная функция обработки очереди
 * ИСПРАВЛЕНО: Добавлен контроль общего количества операций за запуск
 */
async function drainOnce(env) {
  const defaultRateLimitMs = parseInt(env.RATE_LIMIT_MS || "2000", 10);
  const defaultMaxJobs     = parseInt(env.MAX_JOBS_PER_RUN || "5", 10);
  const defaultConcurrency = parseInt(env.CONCURRENCY || "1", 10);
  const notionVersion      = env.NOTION_VERSION || "2022-06-28";

  // ✅ КРИТИЧНО: Безопасный лимит операций за один запуск worker'а
  // Cloudflare Workers имеет лимит 50 subrequests, оставляем запас для KV операций
  const SAFE_SUBREQUEST_LIMIT = parseInt(env.SAFE_SUBREQUEST_LIMIT || "40", 10);

  let processedJobs = 0;
  let totalOps = 0;
  let totalErrors = 0;
  let totalOpsProcessed = 0; // ✅ Глобальный счётчик обработанных операций
  let partialJobs = 0; // ✅ Счётчик частично обработанных jobs

  const codeRe = /HTTP (\d{3})/;
  const byCode = {};
  const byType = {};

  console.log(`[DRAIN] Starting drain cycle. Safe limit: ${SAFE_SUBREQUEST_LIMIT} ops`);

  // Получаем список pending jobs
  const list = await env.NOTION_QUEUE_KV.list({ prefix: "queue:job:" });
  const jobKeys = list.keys.slice(0, defaultMaxJobs);

  console.log(`[DRAIN] Found ${list.keys.length} jobs, processing up to ${jobKeys.length}`);

  for (const { name } of jobKeys) {
    const job = await env.NOTION_QUEUE_KV.get(name, "json");
    if (!job) {
      console.log(`[DRAIN] Job ${name} not found, skipping`);
      continue;
    }

    const jobId = job.jobId || name.replace("queue:job:", "");
    const ops = job.operations || job.ops || [];

    if (!Array.isArray(ops) || ops.length === 0) {
      console.log(`[DRAIN] Job ${jobId} has no operations, deleting`);
      await env.NOTION_QUEUE_KV.delete(name);
      continue;
    }

    // ✅ КРИТИЧНО: Проверяем, сколько операций можем обработать
    const availableSlots = SAFE_SUBREQUEST_LIMIT - totalOpsProcessed;

    if (availableSlots <= 0) {
      console.log(`[DRAIN] STOPPING: Reached safe limit (${SAFE_SUBREQUEST_LIMIT}). ` +
                  `Processed ${totalOpsProcessed} ops from ${processedJobs} jobs. ` +
                  `Remaining jobs will be processed in next run.`);
      break;
    }

    // ✅ Обрабатываем только доступное количество операций
    const opsToProcess = ops.slice(0, availableSlots);
    const remainingOps = ops.slice(availableSlots);

    console.log(`[DRAIN] Job ${jobId}: ${ops.length} total ops, ` +
                `processing ${opsToProcess.length}, ` +
                `${remainingOps.length} will remain`);

    // Загружаем опции из batch метаданных
    const batchId = inferBatchId(jobId);
    const batchOptions = batchId ? await tryLoadBatchOptions(env, batchId) : null;

    const rateLimitMs   = clampInt(batchOptions?.rateLimitDelay, 0, 60_000, defaultRateLimitMs);
    const jobConcurrency= clampInt(batchOptions?.concurrency, 1, 10, defaultConcurrency);
    const maxRetries    = clampInt(batchOptions?.maxRetries, 0, 10, parseInt(env.MAX_RETRIES || "3", 10));

    console.log(`[DRAIN] Job ${jobId} options: concurrency=${jobConcurrency}, ` +
                `rateLimitMs=${rateLimitMs}, maxRetries=${maxRetries}`);

    const results = [];
    const pool = new ConcurrencyPool(jobConcurrency);

    // Обрабатываем операции
    for (let i = 0; i < opsToProcess.length; i++) {
      const op = opsToProcess[i];
      await pool.run(async () => {
        try {
          const r = await updatePageProperties(op, env, { notionVersion, maxRetries });
          results[i] = { ok: true, result: r };
        } catch (err) {
          results[i] = { ok: false, error: stringifyErr(err), op };
          console.error(`[DRAIN] Job ${jobId} op ${i} failed:`, stringifyErr(err));
        } finally {
          // Мягкий rate limit между операциями
          await sleep(rateLimitMs);
        }
      });
    }

    await pool.drain();

    const errors = results.filter(r => !r?.ok);
    totalOps += opsToProcess.length;
    totalOpsProcessed += opsToProcess.length;
    totalErrors += errors.length;

    // Агрегируем ошибки по кодам
    for (const e of errors) {
      const m = (e.error || "").match(codeRe);
      const code = m ? m[1] : "unknown";
      byCode[code] = (byCode[code] || 0) + 1;
      const t = "updateProperties";
      byType[t] = (byType[t] || 0) + 1;
    }

    // ✅ КРИТИЧНО: Обрабатываем частично обработанные jobs
    if (remainingOps.length > 0) {
      // Job обработан частично, сохраняем оставшиеся операции
      console.log(`[DRAIN] Job ${jobId}: PARTIAL completion. ` +
                  `Processed ${opsToProcess.length}/${ops.length} ops, ` +
                  `${remainingOps.length} remaining for next run`);

      partialJobs++;

      // Обновляем job с оставшимися операциями
      await env.NOTION_QUEUE_KV.put(
        name,
        JSON.stringify({
          ...job,
          operations: remainingOps,
          processed: (job.processed || 0) + opsToProcess.length,
          lastProcessed: new Date().toISOString()
        }),
        { expirationTtl: 60 * 60 * 2 } // 2 часа
      );

      // Сохраняем частичные результаты
      const resultKey = `queue:results:${jobId}`;
      const existingResults = await env.NOTION_QUEUE_KV.get(resultKey, "json");
      const allErrors = existingResults?.errors || [];

      await env.NOTION_QUEUE_KV.put(
        resultKey,
        JSON.stringify({
          jobId,
          ts: new Date().toISOString(),
          status: 'partial',
          processed: (job.processed || 0) + opsToProcess.length,
          remaining: remainingOps.length,
          total: (job.processed || 0) + ops.length,
          ok: opsToProcess.length - errors.length,
          errors: [...allErrors, ...errors]
        }),
        { expirationTtl: 60 * 60 * 24 } // 1 день
      );
    } else {
      // Job полностью обработан
      console.log(`[DRAIN] Job ${jobId}: COMPLETED. ` +
                  `Processed ${opsToProcess.length} ops, ` +
                  `${errors.length} errors`);

      // Сохраняем финальные результаты
      const resultKey = `queue:results:${jobId}`;
      const existingResults = await env.NOTION_QUEUE_KV.get(resultKey, "json");
      const allErrors = existingResults?.errors || [];

      await env.NOTION_QUEUE_KV.put(
        resultKey,
        JSON.stringify({
          jobId,
          ts: new Date().toISOString(),
          status: 'completed',
          total: (job.processed || 0) + opsToProcess.length,
          ok: opsToProcess.length - errors.length,
          errors: [...allErrors, ...errors]
        }),
        { expirationTtl: 60 * 60 * 24 } // 1 день
      );

      // Удаляем обработанный job
      await env.NOTION_QUEUE_KV.delete(name);
    }

    processedJobs++;
  }

  const result = {
    success: true,
    processedJobs,
    partialJobs,
    totalOps,
    totalOpsProcessed,
    totalErrors,
    byCode,
    byType,
    safeLimit: SAFE_SUBREQUEST_LIMIT,
    utilizationPercent: Math.round((totalOpsProcessed / SAFE_SUBREQUEST_LIMIT) * 100),
    timestamp: new Date().toISOString()
  };

  console.log(`[DRAIN] Drain cycle completed:`, result);

  return result;
}

/**
 * Обновление свойств страницы Notion
 * Включает retry логику для 429 и 5xx ошибок
 */
async function updatePageProperties(op, env, { notionVersion, maxRetries }) {
  const token = env.NOTION_TOKEN;
  assert(token, "NOTION_TOKEN secret is missing");

  const pageId = op.pageId || op.page_id;
  assert(pageId, "updateProperties: pageId/page_id is required");
  assert(op.properties && typeof op.properties === "object", "updateProperties: properties is required");

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Notion-Version": notionVersion
  };
  const url = `https://api.notion.com/v1/pages/${pageId}`;
  const body = JSON.stringify({ properties: op.properties });

  let attempt = 0;
  const hardMaxRetries = Math.max(0, Number.isFinite(maxRetries) ? maxRetries : 3);

  while (true) {
    const res = await fetch(url, { method: "PATCH", headers, body });

    // 429 Rate Limited - Уважаем Retry-After заголовок
    if (res.status === 429) {
      if (attempt >= hardMaxRetries) {
        let text = "";
        try { text = await res.text(); } catch {}
        throw new Error(`updateProperties: HTTP 429 — reached max retries (${attempt}). ${text}`);
      }
      attempt++;
      const raSec = parseInt(res.headers.get("retry-after") || "1", 10);
      const waitMs = (isFinite(raSec) ? raSec : 1) * 1000;
      console.log(`[NOTION] Rate limited (429), waiting ${waitMs}ms before retry ${attempt}/${hardMaxRetries}`);
      await sleep(waitMs);
      continue;
    }

    // 5xx Server errors - Exponential backoff
    if (res.status >= 500 && res.status < 600) {
      if (attempt >= hardMaxRetries) {
        await ensureOk(res, "updateProperties");
      }
      attempt++;
      const backoffMs = Math.min(8000, 500 * Math.pow(2, attempt - 1));
      console.log(`[NOTION] Server error (${res.status}), waiting ${backoffMs}ms before retry ${attempt}/${hardMaxRetries}`);
      await sleep(backoffMs);
      continue;
    }

    // Все остальные ответы
    await ensureOk(res, "updateProperties");
    return await res.json();
  }
}

/**
 * Извлечение batchId из jobId
 * "job_batch_1755704748882_cmw5x0odi_0" -> "batch_1755704748882_cmw5x0odi"
 */
function inferBatchId(jobId) {
  if (!jobId || !jobId.startsWith("job_")) return null;
  const noIdx = jobId.replace(/_\d+$/, ""); // убираем суффикс "_0"
  const rest = noIdx.slice(4);              // отрезаем "job_"
  return rest.startsWith("batch_") ? rest : null;
}

/**
 * Загрузка опций batch из KV
 */
async function tryLoadBatchOptions(env, batchId) {
  const candidates = [
    `queue:batch:${batchId}`,
    `batch:${batchId}`,
    batchId
  ];
  for (const key of candidates) {
    const meta = await env.NOTION_QUEUE_KV.get(key, "json");
    if (meta && meta.options) return meta.options;
  }
  return null;
}

/**
 * Проверка успешности ответа
 */
async function ensureOk(res, label) {
  if (res.ok) return;
  let body;
  try { body = await res.text(); } catch { body = "<no body>"; }
  if (body.length > 1200) body = body.slice(0, 1200) + "…";
  throw new Error(`${label}: HTTP ${res.status} ${res.statusText} — ${body}`);
}

/**
 * Утилиты
 */
function clampInt(n, min, max, fallback) {
  const v = Number.isFinite(+n) ? +n : NaN;
  if (Number.isNaN(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function stringifyErr(err) {
  try {
    return (err && err.stack) || String(err);
  } catch {
    return "Unknown error";
  }
}

/**
 * Пул для контроля concurrency
 */
class ConcurrencyPool {
  constructor(limit) {
    this.limit = Math.max(1, limit || 1);
    this.running = 0;
    this.queue = [];
  }

  async run(fn) {
    if (this.running >= this.limit) {
      await new Promise(res => this.queue.push(res));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  async drain() {
    while (this.running > 0 || this.queue.length > 0) {
      await sleep(10);
    }
  }
}

/**
 * JSON response helper
 */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
