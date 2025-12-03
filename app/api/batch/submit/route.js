// app/api/batch/submit/route.js - Оптимизированный batch API
export const runtime = "edge";

import { NextResponse } from "next/server";
import { withErrorHandler, Errors, requireAuth } from "@/lib/errorHandler";
import { verifyReviewToken } from "@/lib/token";
import { BatchSubmitRequest } from "@/lib/schema";
import { CONFIG } from "@/lib/config";
import {
  NotionBatchProcessor,
  addBatchToKVQueue,
  isKVConnected,
  initKV
} from "@/lib/kv-queue";
import { notion } from "@/lib/notion";
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

  // Определение режима обработки
  let kvAvailable = false;
  try {
    kvAvailable = await isKVConnected();
  } catch {
    kvAvailable = false;
  }

  const forceKV = options.forceKV === true || body.forceKV === true;
  let processingMode = 'direct';

  if (forceKV && !kvAvailable) {
    throw Errors.ServiceUnavailable(
      "Cloudflare KV недоступно",
      "Проверьте настройки KV"
    );
  }

  if (operations.length > CONFIG.DIRECT_PROCESSING.MAX_OPERATIONS) {
    if (kvAvailable) {
      processingMode = 'kv_queue';
    } else {
      throw Errors.ServiceUnavailable(
        `Для ${operations.length} операций требуется KV`,
        `Максимум без KV: ${CONFIG.DIRECT_PROCESSING.MAX_OPERATIONS}`
      );
    }
  }

  if (forceKV && kvAvailable) {
    processingMode = 'kv_queue';
  }

  logger.info(`[BATCH SUBMIT] Mode: ${processingMode}, KV: ${kvAvailable}`);

  // Настройки процессора
  const processorOptions = {
    batchSize: Math.min(options.batchSize || CONFIG.BATCH.DEFAULT_BATCH_SIZE, CONFIG.BATCH.MAX_BATCH_SIZE),
    concurrency: Math.min(options.concurrency || CONFIG.BATCH.DEFAULT_CONCURRENCY, CONFIG.BATCH.MAX_CONCURRENCY),
    rateLimitDelay: Math.max(options.rateLimitDelay || CONFIG.BATCH.MIN_RATE_LIMIT_DELAY, 2000),
    maxRetries: Math.min(options.maxRetries || CONFIG.BATCH.MAX_RETRIES, 5),
    useKV: processingMode === 'kv_queue',
    reviewerUserId: payload.reviewerUserId
  };

  // Выполнение
  if (processingMode === 'kv_queue') {
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
  }

  // Прямая обработка
  const processor = new NotionBatchProcessor(notion, processorOptions);
  const result = await processor.processBatchDirectly(operations);
  
  const successRate = result.stats.totalOperations > 0 ?
    (result.stats.successful / result.stats.totalOperations * 100).toFixed(1) : 0;

  logger.info(`[BATCH SUBMIT] Direct completed: ${result.stats.successful}/${result.stats.totalOperations}`);

  return NextResponse.json({
    success: true,
    results: result.results,
    stats: result.stats,
    totalOperations: result.stats.totalOperations,
    message: `✅ ${result.stats.successful}/${result.stats.totalOperations} (${successRate}%)`,
    completed: true,
    timestamp: new Date().toISOString()
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
      direct: CONFIG.DIRECT_PROCESSING,
      batch: CONFIG.BATCH
    },
    environment: {
      hasNotionToken: !!process.env.NOTION_TOKEN,
      hasJWTSecret: !!process.env.JWT_SECRET
    }
  });
}
