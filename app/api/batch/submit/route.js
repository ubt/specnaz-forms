// app/api/batch/submit/route.js
export const runtime = "edge";

import { NextResponse } from "next/server";
import { initKV, isKVConnected, addBatchToKVQueue } from "@/lib/kv-queue";

const LIMITS = {
  DIRECT_PROCESSING: { maxOperations: 10 },
  KV_QUEUE: { maxOperations: 2000 }
};

async function handleDirectProcessing(operations) {
  return {
    success: true,
    mode: "direct_processing",
    processed: operations.length,
    message: "Прямая обработка выполнена (заглушка — замените на вашу реализацию)."
  };
}

export async function POST(req, context) {
  try {
    let env = context?.env || null;
    let waitUntil = context?.waitUntil || null;
    try {
      const mod = await import("@cloudflare/next-on-pages");
      if (mod?.getRequestContext) {
        const rc = mod.getRequestContext();
        env = env || rc?.env || null;
        waitUntil = waitUntil || rc?.waitUntil || null;
      }
    } catch {}

    initKV(env || {});

    const body = await req.json();
    const operations = Array.isArray(body?.operations) ? body.operations : [];
    const options = body?.options || {};
    if (!operations.length) {
      return NextResponse.json({ success: false, error: "operations must be a non-empty array" }, { status: 400 });
    }

    const kvAvailable = isKVConnected();
    const forceKV = options.forceKV === true || body.forceKV === true;
    let processingMode = "direct";
    let limits = LIMITS.DIRECT_PROCESSING;

    if (forceKV && kvAvailable) {
      processingMode = "kv_queue";
      limits = LIMITS.KV_QUEUE;
    } else if (!kvAvailable) {
      processingMode = "direct";
      limits = LIMITS.DIRECT_PROCESSING;
    } else if (operations.length > LIMITS.DIRECT_PROCESSING.maxOperations) {
      processingMode = "mixed";
      limits = LIMITS.KV_QUEUE;
    }

    console.log(`[BATCH SUBMIT] mode=${processingMode} kv=${kvAvailable} ops=${operations.length}`);

    if (processingMode === "direct" && operations.length > limits.maxOperations) {
      return NextResponse.json({
        success: false,
        error: "Для обработки более 10 операций требуется Cloudflare KV (Система автоматически переключилась на прямую обработку)",
        details: { provided: operations.length, maxDirect: limits.maxOperations },
        suggestion: "Включите KV на Cloudflare Pages/Workers, либо отправляйте ≤ 10 операций за один запрос"
      }, { status: 503 });
    }

    if (processingMode === "kv_queue") {
      const { batchId, jobIds } = await addBatchToKVQueue(operations, { expirationTtl: 60 * 60 * 24 });
      if (typeof globalThis.processKVJobs === "function" && typeof waitUntil === "function") {
        try {
          waitUntil(globalThis.processKVJobs(jobIds).catch(e => console.error("[KV] background error:", e?.message || e)));
        } catch {}
      }
      return NextResponse.json({
        success: true,
        mode: "kv_queue",
        batchId, jobIds,
        totalOperations: operations.length,
        totalJobs: jobIds.length,
        message: `Добавлено ${operations.length} операций в очередь KV.`,
        statusEndpoint: `/api/batch/status?jobIds=${jobIds.join(",")}`,
        resultsEndpoint: `/api/batch/results?jobIds=${jobIds.join(",")}`
      });
    }

    if (processingMode === "mixed") {
      const directOps = operations.slice(0, LIMITS.DIRECT_PROCESSING.maxOperations);
      const kvOps = operations.slice(LIMITS.DIRECT_PROCESSING.maxOperations);

      const directResult = await handleDirectProcessing(directOps);

      let kvData;
      try {
        const { batchId, jobIds } = await addBatchToKVQueue(kvOps, { expirationTtl: 60 * 60 * 24 });
        if (typeof globalThis.processKVJobs === "function" && typeof waitUntil === "function") {
          try {
            waitUntil(globalThis.processKVJobs(jobIds).catch(e => console.error("[KV] background error:", e?.message || e)));
          } catch {}
        }
        kvData = {
          success: true,
          mode: "kv_queue",
          batchId, jobIds,
          totalOperations: kvOps.length,
          totalJobs: jobIds.length,
          message: `Оставшиеся ${kvOps.length} операций добавлены в KV очередь.`,
          statusEndpoint: `/api/batch/status?jobIds=${jobIds.join(",")}`,
          resultsEndpoint: `/api/batch/results?jobIds=${jobIds.join(",")}`
        };
      } catch (kvErr) {
        console.error("[BATCH SUBMIT] KV enqueue error:", kvErr?.message || kvErr);
        kvData = { success: false, error: "Не удалось добавить задачи в KV" };
      }

      return NextResponse.json({ success: true, mode: "mixed", direct: directResult, kv: kvData });
    }

    const direct = await handleDirectProcessing(operations);
    return NextResponse.json({ success: true, mode: "direct", direct });
  } catch (e) {
    console.error("[BATCH SUBMIT] fatal:", e?.message || e);
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
