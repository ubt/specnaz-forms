// app/api/batch/submit/route.js - Batch API только через KV Queue
export const runtime = "edge";

import { NextResponse } from "next/server";
import { withErrorHandler, Errors, requireAuth } from "@/lib/errorHandler";
import { verifyReviewToken } from "@/lib/token";
import { BatchSubmitRequest } from "@/lib/schema";
import { CONFIG } from "@/lib/config";
import {
  addBatchToKVQueue,
  isKVConnected,
  initKV,
  SAFE_SUBREQUEST_LIMIT
} from "@/lib/kv-queue";
import { logger } from "@/lib/logger";

logger.info(`[BATCH SUBMIT INIT] All requests will use KV queue (max ${SAFE_SUBREQUEST_LIMIT} ops per job)`);

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
  const totalOperations = operations.length;

  logger.info(`[BATCH SUBMIT] ${totalOperations} operations validated, will use KV queue`);

  // Проверка доступности KV
  let kvAvailable = false;
  try {
    kvAvailable = await isKVConnected();
  } catch (error) {
    logger.error('[BATCH SUBMIT] KV connection check failed:', error.message);
    kvAvailable = false;
  }

  // KV обязательно для всех запросов
  if (!kvAvailable) {
    throw Errors.ServiceUnavailable(
      "Cloudflare KV недоступно",
      "Сервис обработки batch операций временно недоступен. KV queue обязателен для всех запросов. Попробуйте позже."
    );
  }

  // Настройки для KV queue
  const queueOptions = {
    batchSize: Math.min(
      options.batchSize || CONFIG.BATCH.DEFAULT_BATCH_SIZE,
      SAFE_SUBREQUEST_LIMIT
    ),
    rateLimitDelay: Math.max(options.rateLimitDelay || CONFIG.BATCH.MIN_RATE_LIMIT_DELAY, 2500),
    maxRetries: Math.min(options.maxRetries || CONFIG.BATCH.MAX_RETRIES, 3),
    reviewerUserId: payload.reviewerUserId
  };

  // Все операции идут через KV очередь
  try {
    const { batchId, jobIds, operationsPerJob } = await addBatchToKVQueue(operations, queueOptions);

    logger.info(`[BATCH SUBMIT] KV batch created: ${batchId}, ${jobIds.length} jobs, ${operationsPerJob} ops/job`);

    return NextResponse.json({
      success: true,
      mode: 'kv_queue',
      batchId,
      jobIds,
      totalOperations,
      totalJobs: jobIds.length,
      operationsPerJob,
      estimatedDuration: Math.ceil(totalOperations * 3), // ~3 сек на операцию
      message: `✅ ${totalOperations} операций добавлено в очередь (${jobIds.length} jobs)`,
      statusEndpoint: `/api/batch/status?jobIds=${jobIds.join(',')}`,
      resultsEndpoint: `/api/batch/results?jobIds=${jobIds.join(',')}`,
      note: `Операции разбиты на ${jobIds.length} частей по ${operationsPerJob} для соблюдения лимитов Cloudflare`
    });
  } catch (kvError) {
    logger.error('[BATCH SUBMIT] KV queue error:', kvError.message);

    throw Errors.ServiceUnavailable(
      "Ошибка добавления в очередь KV",
      `${kvError.message}. Попробуйте повторить запрос позже.`
    );
  }
  
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

  const isOperational = kvStatus === 'available';

  return NextResponse.json({
    service: "Notion Batch Processing API - KV Queue Only",
    status: isOperational ? "operational" : "degraded",
    runtime: "edge",
    timestamp: new Date().toISOString(),
    kv: {
      status: kvStatus,
      available: isOperational,
      required: true,
      note: "KV queue обязателен для всех batch операций"
    },
    limits: {
      batch: {
        maxOperationsPerJob: SAFE_SUBREQUEST_LIMIT,
        defaultBatchSize: CONFIG.BATCH.DEFAULT_BATCH_SIZE,
        maxBatchSize: CONFIG.BATCH.MAX_BATCH_SIZE,
        explanation: `Операции автоматически разбиваются на jobs по ${SAFE_SUBREQUEST_LIMIT} операций`
      }
    },
    environment: {
      hasNotionToken: !!process.env.NOTION_TOKEN,
      hasJWTSecret: !!process.env.JWT_SECRET
    },
    mode: {
      processing: "kv_queue_only",
      directProcessing: "disabled",
      reason: "Все запросы обрабатываются через KV queue для надежности и соблюдения лимитов Cloudflare"
    },
    recommendations: {
      anySize: "Все запросы обрабатываются через KV queue",
      optimal: `Рекомендуется любое количество операций - они автоматически разобьются на jobs по ${SAFE_SUBREQUEST_LIMIT}`,
      maxTotal: `До ${CONFIG.BATCH.MAX_OPERATIONS} операций в одном запросе`,
      note: "KV queue должен быть доступен, иначе запросы будут отклонены"
    }
  });
}