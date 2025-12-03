// app/api/batch/submit/route.js - Оптимизированный batch API
export const runtime = "edge";

import { NextResponse } from "next/server";
import { withErrorHandler, Errors, requireAuth } from "@/lib/errorHandler";
import { verifyReviewToken } from "@/lib/token";
import { BatchSubmitRequest } from "@/lib/schema";
import { CONFIG } from "@/lib/config";
import {
  addBatchToKVQueue,
  isKVConnected,
  initKV
} from "@/lib/kv-queue";
import { logger } from "@/lib/logger";

// POST - отправка batch операций
export const POST = withErrorHandler(async (req) => {
  logger.info('[BATCH SUBMIT] New request');
  
  initKV();
   
  // Парсинг тела запроса
  let body;
  try {
    body = await req.json();
  } catch {
    throw Errors.BadRequest("Некорректный JSON в теле запроса");
  }

  // Авторизация
  const authHeader = req.headers.get('authorization');
  const token = requireAuth(authHeader?.replace('Bearer ', ''));
  
  const payload = await verifyReviewToken(token);
  logger.debug('[BATCH SUBMIT] Token verified:', payload.reviewerUserId);

  // Валидация
  const validationResult = BatchSubmitRequest.safeParse(body);
  if (!validationResult.success) {
    throw Errors.BadRequest(
      "Некорректные данные",
      validationResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join("; ")
    );
  }

  const { operations, options = {} } = validationResult.data;
  logger.info(`[BATCH SUBMIT] ${operations.length} operations validated`);

  // Проверка доступности KV
  let kvAvailable = false;
  try {
    kvAvailable = await isKVConnected();
  } catch {
    kvAvailable = false;
  }

  if (!kvAvailable) {
    throw Errors.ServiceUnavailable(
      "Cloudflare KV недоступно",
      "Проверьте настройки KV"
    );
  }

  logger.info(`[BATCH SUBMIT] Processing via KV queue`);

  // Настройки процессора
  const processorOptions = {
    batchSize: Math.min(options.batchSize || CONFIG.BATCH.DEFAULT_BATCH_SIZE, CONFIG.BATCH.MAX_BATCH_SIZE),
    concurrency: Math.min(options.concurrency || CONFIG.BATCH.DEFAULT_CONCURRENCY, CONFIG.BATCH.MAX_CONCURRENCY),
    rateLimitDelay: Math.max(options.rateLimitDelay || CONFIG.BATCH.MIN_RATE_LIMIT_DELAY, 2000),
    maxRetries: Math.min(options.maxRetries || CONFIG.BATCH.MAX_RETRIES, 5),
    reviewerUserId: payload.reviewerUserId
  };

  // Отправка в KV очередь
  const { batchId, jobIds } = await addBatchToKVQueue(operations, processorOptions);

  logger.info(`[BATCH SUBMIT] KV batch created: ${batchId}, ${jobIds.length} jobs`);

  return NextResponse.json({
    success: true,
    batchId,
    jobIds,
    totalOperations: operations.length,
    totalJobs: jobIds.length,
    estimatedDuration: Math.ceil(operations.length * 2.5),
    message: `✅ ${operations.length} операций добавлено в очередь`,
    statusEndpoint: `/api/batch/status?jobIds=${jobIds.join(',')}`,
    resultsEndpoint: `/api/batch/results?jobIds=${jobIds.join(',')}`
  });
  
}, { operation: 'batch-submit' });

// GET - диагностика
export async function GET() {
  initKV();
  
  let kvStatus = 'unknown';
  try {
    kvStatus = await isKVConnected() ? 'available' : 'unavailable';
  } catch (error) {
    kvStatus = `error: ${error.message}`;
  }
  
  return NextResponse.json({
    service: "Notion Batch Processing API",
    status: "operational",
    runtime: "edge",
    timestamp: new Date().toISOString(),
    kv: { status: kvStatus, available: kvStatus === 'available' },
    limits: {
      batch: CONFIG.BATCH
    },
    environment: {
      hasNotionToken: !!process.env.NOTION_TOKEN,
      hasJWTSecret: !!process.env.JWT_SECRET
    }
  });
}