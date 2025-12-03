// app/api/batch/submit/route.js - Оптимизированный batch API с учётом лимита subrequests
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
  initKV,
  CLOUDFLARE_SUBREQUEST_LIMIT
} from "@/lib/kv-queue";
import { notion } from "@/lib/notion";
import { logger } from "@/lib/logger";

// Лимит для прямой обработки (с запасом от 50)
const SAFE_DIRECT_LIMIT = Math.min(
  CONFIG.DIRECT_PROCESSING.MAX_OPERATIONS,
  (CLOUDFLARE_SUBREQUEST_LIMIT || 50) - 10
);

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
  
  logger.info(`[BATCH SUBMIT] ${totalOperations} operations validated (direct limit: ${SAFE_DIRECT_LIMIT})`);

  // Определение режима обработки
  let kvAvailable = false;
  try {
    kvAvailable = await isKVConnected();
  } catch {
    kvAvailable = false;
  }

  const forceKV = options.forceKV === true || body.forceKV === true;
  let processingMode = 'direct';

  // КРИТИЧНО: Если операций больше лимита - требуем KV или разбиваем на части
  if (totalOperations > SAFE_DIRECT_LIMIT) {
    if (kvAvailable) {
      processingMode = 'kv_queue';
      logger.info(`[BATCH SUBMIT] Operations (${totalOperations}) > limit (${SAFE_DIRECT_LIMIT}), using KV queue`);
    } else if (forceKV) {
      throw Errors.ServiceUnavailable(
        "Cloudflare KV недоступно",
        `Для ${totalOperations} операций требуется KV. Максимум без KV: ${SAFE_DIRECT_LIMIT}`
      );
    } else {
      // Без KV - обрабатываем только часть операций и возвращаем информацию
      processingMode = 'partial_direct';
      logger.warn(`[BATCH SUBMIT] KV unavailable, will process only ${SAFE_DIRECT_LIMIT} of ${totalOperations} operations`);
    }
  }

  if (forceKV && kvAvailable) {
    processingMode = 'kv_queue';
  }

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
    useKV: processingMode === 'kv_queue',
    reviewerUserId: payload.reviewerUserId
  };

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
      
      // Fallback к частичной прямой обработке
      if (!forceKV) {
        processingMode = 'partial_direct';
        logger.warn('[BATCH SUBMIT] Falling back to partial direct processing');
      } else {
        throw Errors.ServiceUnavailable(
          "Ошибка добавления в очередь KV",
          kvError.message
        );
      }
    }
  }

  // Прямая обработка (полная или частичная)
  const processor = new NotionBatchProcessor(notion, processorOptions);
  
  // Определяем какие операции обрабатывать
  const opsToProcess = processingMode === 'partial_direct' 
    ? operations.slice(0, SAFE_DIRECT_LIMIT)
    : operations;
  
  const deferredOps = processingMode === 'partial_direct'
    ? operations.slice(SAFE_DIRECT_LIMIT)
    : [];

  logger.info(`[BATCH SUBMIT] Direct processing ${opsToProcess.length} operations (${deferredOps.length} deferred)`);
  
  const result = await processor.processBatchDirectly(opsToProcess);
  
  const successRate = result.stats.processedOperations > 0 ?
    (result.stats.successful / result.stats.processedOperations * 100).toFixed(1) : 0;

  logger.info(`[BATCH SUBMIT] Direct completed: ${result.stats.successful}/${result.stats.processedOperations}, deferred: ${deferredOps.length}`);

  // Формируем ответ
  const response = {
    success: true,
    mode: processingMode,
    results: result.results,
    stats: {
      ...result.stats,
      totalRequested: totalOperations,
      deferredCount: deferredOps.length,
      subrequestLimit: CLOUDFLARE_SUBREQUEST_LIMIT || 50
    },
    totalOperations: result.stats.processedOperations,
    message: `✅ ${result.stats.successful}/${result.stats.processedOperations} (${successRate}%)`,
    completed: deferredOps.length === 0,
    timestamp: new Date().toISOString()
  };

  // Если есть отложенные операции - информируем клиента
  if (deferredOps.length > 0) {
    response.warning = `⚠️ ${deferredOps.length} операций не обработано из-за лимита Cloudflare (${CLOUDFLARE_SUBREQUEST_LIMIT || 50} subrequests). Повторите запрос для оставшихся операций.`;
    response.deferredOperations = deferredOps.map(op => op.pageId);
    response.suggestion = 'Отправьте оставшиеся операции отдельным запросом или включите KV для автоматической очереди';
  }

  // Если были отложенные операции из-за лимита внутри процессора
  if (result.remainingOperations && result.remainingOperations.length > 0) {
    response.remainingOperations = result.remainingOperations.length;
    response.warning = (response.warning || '') + ` Дополнительно ${result.remainingOperations.length} операций требуют повторной отправки.`;
  }

  return NextResponse.json(response);
  
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
    kv: { 
      status: kvStatus, 
      available: kvStatus === 'available' 
    },
    limits: {
      cloudflare: {
        subrequestLimit: CLOUDFLARE_SUBREQUEST_LIMIT || 50,
        safeDirectLimit: SAFE_DIRECT_LIMIT
      },
      direct: CONFIG.DIRECT_PROCESSING,
      batch: CONFIG.BATCH
    },
    environment: {
      hasNotionToken: !!process.env.NOTION_TOKEN,
      hasJWTSecret: !!process.env.JWT_SECRET
    },
    recommendations: {
      smallBatch: `До ${SAFE_DIRECT_LIMIT} операций - прямая обработка`,
      largeBatch: `Более ${SAFE_DIRECT_LIMIT} операций - требуется KV очередь`,
      optimal: 'Рекомендуется отправлять по 30-40 операций за раз'
    }
  });
}