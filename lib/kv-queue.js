// lib/kv-queue.js - Оптимизированный KV Queue с правильной обработкой TTL
import { getRequestContext } from '@cloudflare/next-on-pages';
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
 */
export async function addBatchToKVQueue(operations, options = {}) {
  logger.info(`[KV QUEUE] Adding ${operations.length} operations`);
  
  try {
    const kv = getKV();
    const batchId = generateBatchId();
    
    const batchSize = options.batchSize || CONFIG.BATCH.DEFAULT_BATCH_SIZE;
    const jobs = [];
    
    for (let i = 0; i < operations.length; i += batchSize) {
      const chunk = operations.slice(i, i + batchSize);
      const jobId = generateJobId(batchId, jobs.length);
      
      jobs.push({
        jobId,
        operations: chunk,
        status: 'pending',
        created: Date.now(),
        retries: 0
      });
    }
    
    logger.debug(`[KV QUEUE] Created ${jobs.length} jobs for batch ${batchId}`);
    
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
      options
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
      totalOperations: operations.length
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
 * Диагностическая информация
 */
export function getKVDiagnostics() {
  return {
    ...diagnostics,
    kvInitialized,
    isConfigured: kvInitialized,
    timestamp: new Date().toISOString(),
    limits: KV_LIMITS
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

export { KV_LIMITS };