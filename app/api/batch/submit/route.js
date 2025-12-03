<<<<<<< HEAD
// app/api/batch/submit/route.js - Оптимизированный batch API
=======
// app/api/batch/submit/route.js - Оптимизированный batch API с учётом лимита subrequests
>>>>>>> parent of 736d03a (Remove direct processing mode: enforce KV queue for all batch operations)
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
<<<<<<< HEAD
  initKV
=======
  initKV,
  CLOUDFLARE_SUBREQUEST_LIMIT,
  SAFE_SUBREQUEST_LIMIT
>>>>>>> parent of 736d03a (Remove direct processing mode: enforce KV queue for all batch operations)
} from "@/lib/kv-queue";
import { notion } from "@/lib/notion";
import { logger } from "@/lib/logger";

<<<<<<< HEAD
=======
// КРИТИЧНО: Используем безопасный лимит для прямой обработки
const SAFE_DIRECT_LIMIT = Math.min(
  CONFIG.DIRECT_PROCESSING.MAX_OPERATIONS,
  SAFE_SUBREQUEST_LIMIT
);

logger.info(`[BATCH SUBMIT INIT] Safe direct limit set to ${SAFE_DIRECT_LIMIT} operations`);

>>>>>>> parent of 736d03a (Remove direct processing mode: enforce KV queue for all batch operations)
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
<<<<<<< HEAD
  logger.info(`[BATCH SUBMIT] ${operations.length} operations validated`);
=======
  const totalOperations = operations.length;
  
  logger.info(`[BATCH SUBMIT] ${totalOperations} operations validated (direct limit: ${SAFE_DIRECT_LIMIT})`);
>>>>>>> parent of 736d03a (Remove direct processing mode: enforce KV queue for all batch operations)

  // Определение режима обработки
  let kvAvailable = false;
  try {
    kvAvailable = await isKVConnected();
  } catch {
    kvAvailable = false;
  }

  const forceKV = options.forceKV === true || body.forceKV === true;
  let processingMode = 'direct';

<<<<<<< HEAD
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

=======
  // КРИТИЧНО: Если операций больше безопасного лимита - ОБЯЗАТЕЛЬНО используем KV
  if (totalOperations > SAFE_DIRECT_LIMIT) {
    if (kvAvailable) {
      processingMode = 'kv_queue';
      logger.info(`[BATCH SUBMIT] Operations (${totalOperations}) > safe limit (${SAFE_DIRECT_LIMIT}), FORCING KV queue`);
    } else {
      // БЕЗ KV - строго отклоняем запросы, превышающие безопасный лимит
      throw Errors.BadRequest(
        "Слишком много операций для прямой обработки",
        `Получено ${totalOperations} операций, максимум без KV: ${SAFE_DIRECT_LIMIT}. ` +
        `KV недоступно. Разбейте запрос на части по ${SAFE_DIRECT_LIMIT} операций.`
      );
    }
  }

>>>>>>> parent of 736d03a (Remove direct processing mode: enforce KV queue for all batch operations)
  if (forceKV && kvAvailable) {
    processingMode = 'kv_queue';
  }

<<<<<<< HEAD
  logger.info(`[BATCH SUBMIT] Mode: ${processingMode}, KV: ${kvAvailable}`);

  // Настройки процессора
  const processorOptions = {
    batchSize: Math.min(options.batchSize || CONFIG.BATCH.DEFAULT_BATCH_SIZE, CONFIG.BATCH.MAX_BATCH_SIZE),
    concurrency: Math.min(options.concurrency || CONFIG.BATCH.DEFAULT_CONCURRENCY, CONFIG.BATCH.MAX_CONCURRENCY),
    rateLimitDelay: Math.max(options.rateLimitDelay || CONFIG.BATCH.MIN_RATE_LIMIT_DELAY, 2000),
    maxRetries: Math.min(options.maxRetries || CONFIG.BATCH.MAX_RETRIES, 5),
=======
  logger.info(`[BATCH SUBMIT] Mode: ${processingMode}, KV: ${kvAvailable}, Operations: ${totalOperations}`);

  // Настройки процессора с учётом лимитов
  const processorOptions = {
    batchSize: Math.min(
      options.batchSize || CONFIG.BATCH.DEFAULT_BATCH_SIZE, 
      SAFE_DIRECT_LIMIT
    ),
    concurrency: 1, // Последовательная обработка для стабильности
    rateLimitDelay: Math.max(options.rateLimitDelay || CONFIG.BATCH.MIN_RATE_LIMIT_DELAY, 2500),
    maxRetries: Math.min(options.maxRetries || CONFIG.BATCH.MAX_RETRIES, 3),
>>>>>>> parent of 736d03a (Remove direct processing mode: enforce KV queue for all batch operations)
    useKV: processingMode === 'kv_queue',
    reviewerUserId: payload.reviewerUserId
  };

<<<<<<< HEAD
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
=======
  // Обработка через KV очередь
  if (processingMode === 'kv_queue') {
    try {
      const { batchId, jobIds, operationsPerJob } = await addBatchToKVQueue(operations, processorOptions);
      
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
      
      // Если KV не работает - отклоняем запрос
      throw Errors.ServiceUnavailable(
        "Ошибка добавления в очередь KV",
        `${kvError.message}. Для ${totalOperations} операций требуется работающий KV. Попробуйте позже или разбейте на части по ${SAFE_DIRECT_LIMIT} операций.`
      );
    }
  }

  // Прямая обработка - только если в пределах безопасного лимита
  if (totalOperations > SAFE_DIRECT_LIMIT) {
    throw Errors.InternalError(
      "Внутренняя ошибка",
      `Попытка прямой обработки ${totalOperations} операций при лимите ${SAFE_DIRECT_LIMIT}`
    );
  }

  const processor = new NotionBatchProcessor(notion, processorOptions);
  logger.info(`[BATCH SUBMIT] Direct processing ${totalOperations} operations (within safe limit: ${SAFE_DIRECT_LIMIT})`);

  const result = await processor.processBatchDirectly(operations);

  const successRate = result.stats.processedOperations > 0 ?
    (result.stats.successful / result.stats.processedOperations * 100).toFixed(1) : 0;

  logger.info(`[BATCH SUBMIT] Direct completed: ${result.stats.successful}/${result.stats.processedOperations}`);

  // Формируем ответ
  const response = {
    success: true,
    mode: processingMode,
    results: result.results,
    stats: {
      ...result.stats,
      totalRequested: totalOperations,
      subrequestLimit: CLOUDFLARE_SUBREQUEST_LIMIT,
      safeLimit: SAFE_DIRECT_LIMIT
    },
    totalOperations: result.stats.processedOperations,
    message: `✅ ${result.stats.successful}/${result.stats.processedOperations} (${successRate}%)`,
    completed: true,
    timestamp: new Date().toISOString()
  };

  return NextResponse.json(response);
>>>>>>> parent of 736d03a (Remove direct processing mode: enforce KV queue for all batch operations)
  
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
<<<<<<< HEAD
    kv: { status: kvStatus, available: kvStatus === 'available' },
    limits: {
=======
    kv: { 
      status: kvStatus, 
      available: kvStatus === 'available' 
    },
    limits: {
      cloudflare: {
        hardLimit: CLOUDFLARE_SUBREQUEST_LIMIT,
        safeLimit: SAFE_DIRECT_LIMIT,
        explanation: `Жесткий лимит CF Workers: ${CLOUDFLARE_SUBREQUEST_LIMIT}, безопасный с запасом: ${SAFE_DIRECT_LIMIT}`
      },
>>>>>>> parent of 736d03a (Remove direct processing mode: enforce KV queue for all batch operations)
      direct: CONFIG.DIRECT_PROCESSING,
      batch: CONFIG.BATCH
    },
    environment: {
      hasNotionToken: !!process.env.NOTION_TOKEN,
      hasJWTSecret: !!process.env.JWT_SECRET
<<<<<<< HEAD
=======
    },
    recommendations: {
      smallBatch: `До ${SAFE_DIRECT_LIMIT} операций - прямая обработка (рекомендуется)`,
      largeBatch: `Более ${SAFE_DIRECT_LIMIT} операций - ОБЯЗАТЕЛЬНО KV очередь`,
      optimal: `Рекомендуется отправлять по ${Math.floor(SAFE_DIRECT_LIMIT * 0.8)}-${SAFE_DIRECT_LIMIT} операций за раз`,
      warning: `Запросы > ${SAFE_DIRECT_LIMIT} операций БЕЗ KV будут отклонены`
>>>>>>> parent of 736d03a (Remove direct processing mode: enforce KV queue for all batch operations)
    }
  });
}
