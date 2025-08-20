import { Client } from '@notionhq/client';

const KV_LIMITS = {
  BATCH_TTL: 7200,      // 2 hours
  RESULT_TTL: 1800      // 30 minutes
};

async function processQueue(env) {
  const kv = env.NOTION_QUEUE_KV;
  if (!kv) {
    return { error: 'KV namespace NOTION_QUEUE_KV not bound' };
  }

  const notion = new Client({ auth: env.NOTION_TOKEN });
  const list = await kv.list({ prefix: 'queue:job:', limit: 10 });
  const processedJobs = [];

  for (const { name } of list.keys) {
    const job = await kv.get(name, 'json');
    if (!job || job.status !== 'pending') continue;

    job.status = 'processing';
    job.started = Date.now();
    job.processed = 0;
    await kv.put(name, JSON.stringify(job), { expirationTtl: KV_LIMITS.BATCH_TTL });

    const results = [];
    let successful = 0;
    let failed = 0;

    for (const op of job.operations) {
      try {
        await notion.pages.update({ page_id: op.pageId, properties: op.properties });
        results.push({ ...op, status: 'success' });
        successful++;
      } catch (err) {
        results.push({ ...op, status: 'error', error: err.message });
        failed++;
      }
      job.processed++;
    }

    job.status = failed ? 'completed_with_errors' : 'completed';
    job.successful = successful;
    job.failed = failed;
    job.updated = Date.now();

    await kv.put(name, JSON.stringify(job), { expirationTtl: KV_LIMITS.BATCH_TTL });
    await kv.put(`queue:results:${job.jobId}`, JSON.stringify(results), {
      expirationTtl: KV_LIMITS.RESULT_TTL
    });

    const parts = job.jobId.split('_');
    const batchId = parts.slice(1, parts.length - 1).join('_');
    if (batchId) {
      const batchKey = `queue:batch:${batchId}`;
      const batch = await kv.get(batchKey, 'json');
      if (batch) {
        batch.completedJobs = (batch.completedJobs || 0) + 1;
        if (batch.completedJobs >= batch.totalJobs) {
          batch.status = 'completed';
          batch.completed = Date.now();
        }
        await kv.put(batchKey, JSON.stringify(batch), { expirationTtl: KV_LIMITS.BATCH_TTL });
      }
    }

    processedJobs.push({ jobId: job.jobId, successful, failed });
  }

  return { processed: processedJobs.length, jobs: processedJobs };
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/process') {
      const result = await processQueue(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('Notion Queue Worker');
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(processQueue(env));
  }
};
