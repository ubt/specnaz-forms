// app/api/batch/submit/route.js
// Next.js App Router (Edge) style handler with Cloudflare KV-aware batch submission.
// If you deploy on Cloudflare Pages/Workers, `context.env` should contain the KV bindings.

export const runtime = "edge";

import { NextResponse } from "next/server";
import { initKV, isKVConnected, addBatchToKVQueue } from "@/lib/kv-queue";

// Hard limits to avoid timeouts when KV is unavailable
const LIMITS = {
  DIRECT_PROCESSING: { maxOperations: 5 },
  KV_QUEUE: { maxOperations: 1000 }
};

// Stub: replace with your real direct processor if it exists
async function handleDirectProcessing(operations) {
  // WARNING: this is a stub to avoid 60s timeouts; replace with your existing logic.
  // Here we just echo back what would be processed.
  return {
    success: true,
    mode: "direct_processing",
    processed: operations.length,
    message: `Прямая обработка имитирована (замените handleDirectProcessing на вашу реализацию).`
  };
}

export async function POST(req, context) {
  try {
    initKV(context?.env || {});

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

    console.log(`[BATCH SUBMIT] mode=${processingMode} kvAvailable=${kvAvailable} ops=${operations.length}`);

    // Guard against direct mode overload without KV
    if (processingMode === "direct" && operations.length > limits.maxOperations) {
      console.error("[BATCH SUBMIT] Too many operations for direct mode without KV");
      return NextResponse.json({
        success: false,
        error: "Cloudflare KV недоступна и лимит прямой обработки превышен",
        details: { provided: operations.length, maxDirect: limits.maxOperations },
        suggestion: "Включите KV или отправляйте ≤ 5 операций за запрос"
      }, { status: 503 });
    }

    if (processingMode === "kv_queue") {
      // Put all to KV and kick background worker on your side
      const { batchId, jobIds } = await addBatchToKVQueue(operations, { expirationTtl: 60 * 60 * 24 });
      // If your runtime provides waitUntil, you can start background processing here.
      if (context?.waitUntil && typeof context.waitUntil === "function" && typeof globalThis.processKVJobs === "function") {
        try {
          context.waitUntil(globalThis.processKVJobs(jobIds).catch(e => console.error("[KV QUEUE] background error:", e?.message || e)));
        } catch (e) {
          console.warn("[KV QUEUE] waitUntil not available or background processor missing.");
        }
      }
      return NextResponse.json({
        success: true,
        mode: "kv_queue",
        batchId,
        jobIds,
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
        if (context?.waitUntil && typeof context.waitUntil === "function" && typeof globalThis.processKVJobs === "function") {
          try {
            context.waitUntil(globalThis.processKVJobs(jobIds).catch(e => console.error("[KV QUEUE] background error:", e?.message || e)));
          } catch (e) {
            console.warn("[KV QUEUE] waitUntil not available or background processor missing.");
          }
        }
        kvData = {
          success: true,
          mode: "kv_queue",
          batchId,
          jobIds,
          totalOperations: kvOps.length,
          totalJobs: jobIds.length,
          message: `Оставшиеся ${kvOps.length} операций добавлены в KV очередь.`,
          statusEndpoint: `/api/batch/status?jobIds=${jobIds.join(",")}`,
          resultsEndpoint: `/api/batch/results?jobIds=${jobIds.join(",")}`
        };
      } catch (kvErr) {
        console.error("[BATCH SUBMIT] KV queue error, cannot enqueue:", kvErr?.message || kvErr);
        kvData = { success: false, error: "Не удалось добавить задачи в KV" };
      }

      return NextResponse.json({ success: true, mode: "mixed", direct: directResult, kv: kvData });
    }

    // Default: direct
    const direct = await handleDirectProcessing(operations);
    return NextResponse.json({ success: true, mode: "direct", direct });
  } catch (e) {
    console.error("[BATCH SUBMIT] fatal error:", e?.message || e);
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
