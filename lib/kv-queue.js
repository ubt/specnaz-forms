// lib/kv-queue.js - Оптимизированный KV Queue с правильной обработкой лимитов Cloudflare
import { getRequestContext } from '@cloudflare/next-on-pages';
import { notionApiCall } from './notionRateLimit';
import { logger } from './logger';
import { CONFIG } from './config';

// Состояние инициализации
let kvInitialized = false;

// Диагностика
const diagnostics = {
  initAttempts: 0,
  lastError: null,
  lastSuccess: null,
  kvConnected: false
};

// Константы KV (из конфига)
const KV_LIMITS = CONFIG.KV;

// КРИТИЧНО: Лимит Cloudflare Workers на subrequests
const CLOUDFLARE_SUBREQUEST_LIMIT = 45; // Оставляем запас от 50

/**
 * Инициализация KV
 */
export function initKV() {
  diagnostics.initAttempts++;
  
  try {
    kvInitialized = true;
    logger.debug(`[KV INIT] Initialized (attempt #${diagnostics.initAttempts})`);
    return true;
  } catch (error) {
    logger.error('[KV INIT] Error:', error.message);
    diagnostics.lastError = error.message;
    return false;
  }
}

/**
 * Получение KV namespace
 */
export function getKV() {
  try {
    const { env } = getRequestContext();
    if (!env.NOTION_QUEUE_KV) {
      throw new Error('NOTION_QUEUE_KV binding not found');
    }
    return env.NOTION_QUEUE_KV;
  } catch (error) {
    logger.error('[KV ACCESS] Error:', error.message);
    throw new Error(`KV unavailable: ${error.message}`);
  }
}

/**
 * Проверка доступности KV с правильным TTL
 */
export async function isKVConnected() {
  try {
    const kv = getKV();
    
    const testKey = `health_${Date.now()}`;
    await kv.put(testKey, 'test', { expirationTtl: KV_LIMITS.MIN_TTL });
    const result = await kv.get(testKey);
    await kv.delete(testKey);
    
    const connected = result === 'test';
    diagnostics.kvConnected = connected;
    
    if (connected) {
      diagnostics.lastSuccess = new Date().toISOString();
    }
    
    return connected;
  } catch (error) {
    logger.error('[KV CONNECTION] Error:', error.message);
    diagnostics.kvConnected = false;
    diagnostics.lastError = error.message;
    return false;
  }
}

/**
 * Валидация данных для KV
 */
function validateKVData(key, value) {
  if (typeof key !== 'string') {
    throw new Error('KV key must be a string');
  }
  
  if (key.length > KV_LIMITS.MAX_KEY_LENGTH) {
    throw new Error(`KV key too long: ${key.length} > ${KV_LIMITS.MAX_KEY_LENGTH}`);
  }
  
  const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
  const valueSize = new TextEncoder().encode(valueStr).length;
  
  if (valueSize > KV_LIMITS.MAX_VALUE_SIZE) {
    throw new Error(`KV value too large: ${valueSize} > ${KV_LIMITS.MAX_VALUE_SIZE}`);
  }
  
  return { key, valueStr, valueSize };
}

/**
 * Генерация ID
 */
function generateBatchId() {
  return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateJobId(batchId, index) {
  return `job_${batchId}_${index}`;
}

/**
 * Добавление batch в KV очередь
 * ИСПРАВЛЕНО: Уменьшенный размер батча для соблюдения лимита subrequests
 */
export async function addBatchToKVQueue(operations, options = {}) {
  logger.info(`[KV QUEUE] Adding ${operations.length} operations`);
  
  try {
    const kv = getKV();
    const batchId = generateBatchId();
    
    // КРИТИЧНО: Размер батча не должен превышать лимит subrequests
    // Каждая операция = 1 subrequest к Notion API
    const maxBatchSize = Math.min(
      options.batchSize || CONFIG.BATCH.DEFAULT_BATCH_SIZE,
      CLOUDFLARE_SUBREQUEST_LIMIT - 5 // Оставляем запас на KV операции
    );
    
    const jobs = [];
    
    for (let i = 0; i < operations.length; i += maxBatchSize) {
      const chunk = operations.slice(i, i + maxBatchSize);
      const jobId = generateJobId(batchId, jobs.length);
      
      jobs.push({
        jobId,
        operations: chunk,
        status: 'pending',
        created: Date.now(),
        retries: 0,
        processed: 0,
        successful: 0,
        failed: 0
      });
    }
    
    logger.info(`[KV QUEUE] Created ${jobs.length} jobs for batch ${batchId} (max ${maxBatchSize} ops per job)`);
    
    // Сохраняем jobs с задержками для rate limiting
    for (const job of jobs) {
      const key = `queue:job:${job.jobId}`;
      const { valueStr } = validateKVData(key, job);
      
      await kv.put(key, valueStr, { 
        expirationTtl: KV_LIMITS.BATCH_TTL
      });
      
      // Небольшая задержка между записями
      if (jobs.indexOf(job) < jobs.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    // Метаданные batch
    const batchMeta = {
      batchId,
      totalJobs: jobs.length,
      totalOperations: operations.length,
      jobIds: jobs.map(j => j.jobId),
      status: 'pending',
      created: Date.now(),
      options: {
        ...options,
        maxBatchSize // Сохраняем фактический размер батча
      }
    };
    
    const batchKey = `queue:batch:${batchId}`;
    const { valueStr: batchValueStr } = validateKVData(batchKey, batchMeta);
    
    await kv.put(batchKey, batchValueStr, {
      expirationTtl: KV_LIMITS.BATCH_TTL
    });
    
    logger.info(`[KV QUEUE] Batch ${batchId} saved successfully`);
    
    return {
      batchId,
      jobIds: jobs.map(j => j.jobId),
      totalJobs: jobs.length,
      totalOperations: operations.length,
      operationsPerJob: maxBatchSize
    };
    
  } catch (error) {
    logger.error('[KV QUEUE] Error adding to queue:', error.message);
    throw new Error(`KV queue error: ${error.message}`);
  }
}

/**
 * Получение статуса batch операций - оптимизировано
 */
export async function getKVBatchStatus(jobIds) {
  try {
    const kv = getKV();
    logger.debug(`[KV STATUS] Getting status for ${jobIds.length} jobs`);

    // Параллельная загрузка всех статусов
    const statusPromises = jobIds.map(async (jobId) => {
      try {
        const key = `queue:job:${jobId}`;
        const jobData = await kv.get(key, 'json');

        if (!jobData) {
          return { jobId, status: 'not_found', error: 'Job not found' };
        }

        return {
          jobId,
          status: jobData.status,
          operations: jobData.operations?.length || 0,
          processed: jobData.processed || 0,
          successful: jobData.successful || 0,
          failed: jobData.failed || 0,
          progress: jobData.operations?.length > 0 ?
            Math.round((jobData.processed / jobData.operations.length) * 100) : 0,
          created: jobData.created,
          updated: jobData.updated || jobData.created,
          retries: jobData.retries || 0
        };
      } catch (error) {
        return { jobId, status: 'error', error: error.message };
      }
    });

    return await Promise.all(statusPromises);

  } catch (error) {
    logger.error('[KV STATUS] Error:', error.message);
    throw new Error(`Status error: ${error.message}`);
  }
}

/**
 * Получение результатов - оптимизировано
 */
export async function getKVBatchResults(jobIds) {
  try {
    const kv = getKV();
    logger.debug(`[KV RESULTS] Getting results for ${jobIds.length} jobs`);

    const resultPromises = jobIds.map(async (jobId) => {
      try {
        const key = `queue:results:${jobId}`;
        const results = await kv.get(key, 'json');
        return Array.isArray(results) ? results : results ? [results] : [];
      } catch {
        return [];
      }
    });

    const allResultsArrays = await Promise.all(resultPromises);
    return allResultsArrays.flat();

  } catch (error) {
    logger.error('[KV RESULTS] Error:', error.message);
    throw new Error(`Results error: ${error.message}`);
  }
}

/**
 * Batch Processor для Notion операций
 * ИСПРАВЛЕНО: Строгое соблюдение лимита subrequests Cloudflare
 */
export class NotionBatchProcessor {
  constructor(notionClient, options = {}) {
    this.notion = notionClient;
    
    // КРИТИЧНО: Ограничиваем размер батча лимитом subrequests
    const safeBatchSize = Math.min(
      options.batchSize || CONFIG.BATCH.DEFAULT_BATCH_SIZE,
      CLOUDFLARE_SUBREQUEST_LIMIT - 5
    );
    
    this.options = {
      batchSize: safeBatchSize,
      concurrency: 1, // ПОСЛЕДОВАТЕЛЬНАЯ обработка для избежания проблем
      rateLimitDelay: Math.max(options.rateLimitDelay || CONFIG.BATCH.MIN_RATE_LIMIT_DELAY, 2000),
      maxRetries: Math.min(options.maxRetries || CONFIG.BATCH.MAX_RETRIES, 5),
      useKV: options.useKV || false,
      ...options
    };
    
    logger.info(`[BATCH PROCESSOR] Initialized with batchSize=${this.options.batchSize}, delay=${this.options.rateLimitDelay}ms`);
  }
  
  /**
   * Прямая обработка с учётом лимита subrequests
   * ИСПРАВЛЕНО: Строго последовательная обработка с задержками
   */
  async processBatchDirectly(operations) {
    const totalOps = operations.length;
    logger.info(`[DIRECT PROCESSING] Processing ${totalOps} operations (limit: ${CLOUDFLARE_SUBREQUEST_LIMIT})`);
    
    // Проверяем лимит
    if (totalOps > CLOUDFLARE_SUBREQUEST_LIMIT) {
      logger.warn(`[DIRECT PROCESSING] Operations (${totalOps}) exceed subrequest limit (${CLOUDFLARE_SUBREQUEST_LIMIT}). Will process first ${CLOUDFLARE_SUBREQUEST_LIMIT - 5} only.`);
    }
    
    const startTime = Date.now();
    const results = [];
    let successful = 0;
    let failed = 0;
    let subrequestCount = 0;
    
    // КРИТИЧНО: Ограничиваем количество операций в одном invocation
    const maxOpsThisInvocation = Math.min(totalOps, CLOUDFLARE_SUBREQUEST_LIMIT - 5);
    const opsToProcess = operations.slice(0, maxOpsThisInvocation);
    const remainingOps = operations.slice(maxOpsThisInvocation);
    
    // Обрабатываем СТРОГО последовательно с задержками
    for (let i = 0; i < opsToProcess.length; i++) {
      const operation = opsToProcess[i];
      
      // Проверяем лимит subrequests перед каждой операцией
      if (subrequestCount >= CLOUDFLARE_SUBREQUEST_LIMIT - 2) {
        logger.warn(`[DIRECT PROCESSING] Approaching subrequest limit at operation ${i + 1}/${opsToProcess.length}`);
        
        // Добавляем оставшиеся операции как "отложенные"
        for (let j = i; j < opsToProcess.length; j++) {
          results.push({
            pageId: opsToProcess[j].pageId,
            operation: opsToProcess[j],
            status: 'deferred',
            error: 'Subrequest limit reached, operation deferred'
          });
        }
        break;
      }
      
      try {
        logger.debug(`[DIRECT PROCESSING] Operation ${i + 1}/${opsToProcess.length}: ${operation.pageId}`);
        
        const result = await notionApiCall(() => this.executeNotionOperation(operation));
        subrequestCount++;
        
        results.push({ 
          ...result, 
          status: 'success', 
          pageId: operation.pageId 
        });
        successful++;
        
        // Задержка между операциями для rate limiting
        if (i < opsToProcess.length - 1) {
          const delay = Math.max(this.options.rateLimitDelay / opsToProcess.length, 100);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
      } catch (error) {
        subrequestCount++; // Неудачный запрос тоже считается
        
        logger.error(`[DIRECT PROCESSING] Operation ${i + 1} error:`, error.message);
        results.push({
          pageId: operation.pageId,
          operation,
          status: 'error',
          error: error.message
        });
        failed++;
        
        // При rate limit ошибке - увеличиваем задержку
        if (error.message?.includes('429') || error.message?.includes('rate')) {
          logger.warn('[DIRECT PROCESSING] Rate limit hit, adding extra delay');
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }

    const duration = Date.now() - startTime;
    
    // Добавляем информацию об оставшихся операциях
    const deferredCount = remainingOps.length + results.filter(r => r.status === 'deferred').length;
    
    logger.info(`[DIRECT PROCESSING] Done: ${successful} success, ${failed} errors, ${deferredCount} deferred, ${duration}ms, ${subrequestCount} subrequests`);

    return {
      results,
      stats: {
        totalOperations: totalOps,
        processedOperations: successful + failed,
        successful,
        failed,
        deferred: deferredCount,
        duration,
        subrequestCount,
        subrequestLimit: CLOUDFLARE_SUBREQUEST_LIMIT
      },
      // Возвращаем оставшиеся операции для повторной обработки
      remainingOperations: remainingOps.length > 0 ? remainingOps : undefined
    };
  }
  
  async executeNotionOperation(operation) {
    const { pageId, properties } = operation;
    
    return await this.notion.pages.update({
      page_id: pageId,
      properties
    });
  }
  
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

/**
 * Диагностическая информация
 */
export function getKVDiagnostics() {
  return {
    ...diagnostics,
    kvInitialized,
    isConfigured: kvInitialized,
    timestamp: new Date().toISOString(),
    limits: {
      ...KV_LIMITS,
      subrequestLimit: CLOUDFLARE_SUBREQUEST_LIMIT
    }
  };
}

/**
 * Очистка старых данных из KV
 */
export async function cleanupKVQueue() {
  try {
    const kv = getKV();
    
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 часа
    let cleaned = 0;
    
    const prefixes = ['queue:job:', 'queue:batch:', 'queue:results:'];
    
    for (const prefix of prefixes) {
      try {
        const list = await kv.list({ prefix, limit: 100 });
        
        for (const key of list.keys) {
          try {
            const data = await kv.get(key.name, 'json');
            if (data && data.created && (now - data.created) > maxAge) {
              await kv.delete(key.name);
              cleaned++;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
          } catch {
            // Игнорируем ошибки отдельных ключей
          }
        }
      } catch {
        // Игнорируем ошибки префиксов
      }
    }
    
    logger.info(`[KV CLEANUP] Cleaned ${cleaned} old entries`);
    return cleaned;
  } catch (error) {
    logger.error('[KV CLEANUP] Error:', error.message);
    return 0;
  }
}

export { KV_LIMITS, CLOUDFLARE_SUBREQUEST_LIMIT };