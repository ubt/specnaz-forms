// lib/kv-queue.js
// Cloudflare KV utilities + minimal queue helpers.
// This file focuses on reliable KV initialization and explicit, loud logging.
// If your project already has more helpers here, merge the initKV / isKVConnected changes.

let KV_NAMESPACE = null;
let _kvAvailable = false;

/**
 * Initialize KV by reading from Cloudflare runtime env or a global fallback.
 * @param {any} env - Cloudflare binding container (Pages/Workers: context.env)
 */
export function initKV(env = {}) {
  // Try context.env binding first, then global binding (some CF setups expose globals)
  // Expected binding name: NOTION_QUEUE_KV
  KV_NAMESPACE = (env && env.NOTION_QUEUE_KV) || (typeof NOTION_QUEUE_KV !== "undefined" ? NOTION_QUEUE_KV : null);

  // If your binding name is different, you may also try env.KV or a custom name as a fallback:
  if (!KV_NAMESPACE && env && env.KV) {
    console.warn("[KV] Binding NOTION_QUEUE_KV not found, but 'KV' exists. Using env.KV as fallback.");
    KV_NAMESPACE = env.KV;
  }

  // Validate the minimal interface
  if (KV_NAMESPACE && typeof KV_NAMESPACE.put !== "function") {
    console.error("[KV] Supplied KV binding does not implement KVNamespace API (put/get/delete).");
    KV_NAMESPACE = null;
  }

  _kvAvailable = Boolean(KV_NAMESPACE);

  if (_kvAvailable) {
    const source = env && env.NOTION_QUEUE_KV ? "context.env.NOTION_QUEUE_KV" : (env && env.KV ? "context.env.KV" : "globalThis.NOTION_QUEUE_KV");
    console.log(`[KV] Cloudflare KV подключено успешно (${source}).`);
  } else {
    if (env && "NOTION_QUEUE_KV" in env) {
      console.warn("[KV] Binding NOTION_QUEUE_KV присутствует в env, но не инициализировалось корректно (тип/значение неизвестны).");
    } else {
      console.warn("[KV] Cloudflare KV недоступно: binding NOTION_QUEUE_KV не найден в context.env и в глобальном пространстве.");
    }
  }
}

export function isKVConnected() {
  return _kvAvailable;
}

/**
 * Enqueue a batch of operations to KV (lightweight queue).
 * Writes: batch:{batchId}, stats:{batchId}, payload:{jobId}, job:{jobId}
 * @param {Array<any>} operations
 * @param {{expirationTtl?: number}} options
 * @returns {Promise<{batchId: string, jobIds: string[]}>}
 */
export async function addBatchToKVQueue(operations, options = {}) {
  if (!_kvAvailable || !KV_NAMESPACE) {
    throw new Error("Cloudflare KV недоступно (binding NOTION_QUEUE_KV не инициализирован).");
  }
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("operations must be a non-empty array.");
  }
  const expirationTtl = Number(options.expirationTtl ?? 60 * 60 * 24); // 24h
  const shortTtl = Number(options.shortTtl ?? 60 * 60); // 1h

  const batchId = crypto.randomUUID();
  const jobIds = operations.map(() => crypto.randomUUID());

  await KV_NAMESPACE.put(`batch:${batchId}`, JSON.stringify({
    createdAt: new Date().toISOString(),
    jobIds
  }), { expirationTtl });

  await KV_NAMESPACE.put(`stats:${batchId}`, JSON.stringify({
    total: jobIds.length, done: 0, error: 0
  }), { expirationTtl });

  // Store payloads & initial job state
  await Promise.all(jobIds.map((id, i) => KV_NAMESPACE.put(`payload:${id}`, JSON.stringify(operations[i]), { expirationTtl: shortTtl })));
  await Promise.all(jobIds.map((id) => KV_NAMESPACE.put(`job:${id}`, JSON.stringify({ state: "pending" }), { expirationTtl })));

  return { batchId, jobIds };
}

/**
 * Update a job record in KV.
 */
export async function setJobState(jobId, patch) {
  if (!_kvAvailable || !KV_NAMESPACE) return;
  const key = `job:${jobId}`;
  const current = await KV_NAMESPACE.get(key, "json") || {};
  const next = { ...current, ...patch };
  await KV_NAMESPACE.put(key, JSON.stringify(next), { expirationTtl: 60 * 60 * 24 });
}

/**
 * Read a batch summary by id.
 */
export async function readBatchSummary(batchId) {
  if (!_kvAvailable || !KV_NAMESPACE) return null;
  const batch = await KV_NAMESPACE.get(`batch:${batchId}`, "json");
  if (!batch) return null;
  const states = await Promise.all(
    (batch.jobIds || []).map(async (id) => {
      const jr = await KV_NAMESPACE.get(`job:${id}`, "json");
      return { jobId: id, state: jr?.state || "pending" };
    })
  );
  const done = states.filter(s => s.state === "done").length;
  const error = states.filter(s => s.state === "error").length;
  const total = states.length;
  return { total, done, error, pending: total - done - error, states };
}

export const KVInternal = {
  get namespace() { return KV_NAMESPACE; }
};
