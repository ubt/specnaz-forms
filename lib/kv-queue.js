// lib/kv-queue.js - ОБНОВЛЕННАЯ версия с учетом ограничений Cloudflare KV
import { getRequestContext } from '@cloudflare/next-on-pages';
import { notionRateLimit } from './notionRateLimit';
import { logger } from './logger';

// Глобальные переменные для состояния
let kvInitialized = false;
let initAttempts = 0;
let lastInitTime = 0;

// Диагностическая информация
const diagnostics = {
  initAttempts: 0,
  lastError: null,
  lastSuccess: null,
  kvConnected: false
};

// КОНСТАНТЫ для Cloudflare KV
const KV_LIMITS = {
  MIN_TTL: 60,           // Минимальный TTL 60 секунд
  MAX_VALUE_SIZE: 25000000, // 25MB максимальный размер значения
  MAX_KEY_LENGTH: 512,   // Максимальная длина ключа
  DEFAULT_TTL: 3600,     // 1 час по умолчанию
  BATCH_TTL: 7200,       // 2 часа для batch операций
  RESULT_TTL: 1800       // 30 минут для результатов
};

// ИСПРАВЛЕННАЯ инициализация KV для Next.js на Pages
export function initKV() {
  initAttempts++;
  diagnostics.initAttempts = initAttempts;
  
  try {
    // В Next.js на Pages KV доступен только внутри request handlers
    // через getRequestContext(), поэтому просто отмечаем что инициализация вызвана
    kvInitialized = true;
    lastInitTime = Date.now();
    
    console.log(`[KV INIT] Инициализация помечена успешной (попытка #${initAttempts})`);
    return true;
  } catch (error) {
    console.error('[KV INIT] Ошибка инициализации:', error.message);
    diagnostics.lastError = error.message;
    return false;
  }
}

// Получение KV namespace внутри request handler
export function getKV() {
  try {
    const { env } = getRequestContext();
    if (!env.NOTION_QUEUE_KV) {
      throw new Error('NOTION_QUEUE_KV binding not found');
    }
    return env.NOTION_QUEUE_KV;
  } catch (error) {
    console.error('[KV ACCESS] Ошибка доступа к KV:', error.message);
    throw new Error(`KV недоступен: ${error.message}`);
  }
}

// ИСПРАВЛЕННАЯ проверка доступности KV с правильным TTL
export async function isKVConnected() {
  try {
    const kv = getKV();
    
    // Быстрый тест доступности с правильным TTL
    const testKey = `health_${Date.now()}`;
    await kv.put(testKey, 'test', { expirationTtl: KV_LIMITS.MIN_TTL }); // Минимум 60 секунд
    const result = await kv.get(testKey);
    await kv.delete(testKey); // Удаляем сразу, не ждем истечения
    
    const connected = result === 'test';
    diagnostics.kvConnected = connected;
    
    if (connected) {
      diagnostics.lastSuccess = new Date().toISOString();
    }
    
    return connected;
  } catch (error) {
    console.error('[KV CONNECTION] Ошибка проверки:', error.message);
    diagnostics.kvConnected = false;
    diagnostics.lastError = error.message;
    return false;
  }
}

// Валидация данных для KV
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

// Генерация уникального ID для batch операций
function generateBatchId() {
  return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Генерация ID для job
function generateJobId(batchId, index) {
  return `job_${batchId}_${index}`;
}

// ОБНОВЛЕННОЕ добавление batch в KV очередь с правильными TTL
export async function addBatchToKVQueue(operations, options = {}) {
  console.log(`[KV QUEUE] Добавляем ${operations.length} операций в KV очередь`);
  
  try {
    const kv = getKV();
    const batchId = generateBatchId();
    
    // Разделяем операции на job'ы
    const batchSize = options.batchSize || 50;
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
    
    console.log(`[KV QUEUE] Создано ${jobs.length} job'ов для batch ${batchId}`);
    
    // Сохраняем каждый job в KV с правильным TTL
    const savePromises = jobs.map(async (job) => {
      const key = `queue:job:${job.jobId}`;
      const { valueStr } = validateKVData(key, job);
      
      await kv.put(key, valueStr, { 
        expirationTtl: KV_LIMITS.BATCH_TTL // 2 часа на выполнение
      });
    });
    
    // Сохраняем с небольшими задержками для избежания rate limits
    for (let i = 0; i < savePromises.length; i++) {
      await savePromises[i];
      if (i < savePromises.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 50)); // 50ms задержка
      }
    }
    
    // Сохраняем метаданные batch
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
    
    console.log(`[KV QUEUE] Batch ${batchId} успешно сохранен в KV`);
    
    return {
      batchId,
      jobIds: jobs.map(j => j.jobId),
      totalJobs: jobs.length,
      totalOperations: operations.length
    };
    
  } catch (error) {
    console.error('[KV QUEUE] Ошибка добавления в очередь:', error.message);
    throw new Error(`Ошибка KV очереди: ${error.message}`);
  }
}

// ОПТИМИЗИРОВАННОЕ получение статуса batch операций с параллелизмом
export async function getKVBatchStatus(jobIds) {
  try {
    const kv = getKV();
    logger.info(`[KV STATUS] Получаем статус для ${jobIds.length} задач`);

    // Параллельная обработка всех jobIds
    const statusPromises = jobIds.map(async (jobId) => {
      try {
        const key = `queue:job:${jobId}`;
        const jobData = await kv.get(key, 'json');

        if (!jobData) {
          return {
            jobId,
            status: 'not_found',
            error: 'Job not found in KV'
          };
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
        logger.error(`[KV STATUS] Ошибка получения статуса ${jobId}:`, error.message);
        return {
          jobId,
          status: 'error',
          error: error.message
        };
      }
    });

    // Ждем завершения всех параллельных запросов
    const results = await Promise.all(statusPromises);

    logger.info(`[KV STATUS] Получен статус для ${results.length} задач`);
    return results;

  } catch (error) {
    logger.error('[KV STATUS] Критическая ошибка:', error.message);
    throw new Error(`Ошибка получения статуса: ${error.message}`);
  }
}

// ОПТИМИЗИРОВАННОЕ получение результатов выполнения с параллелизмом
export async function getKVBatchResults(jobIds) {
  try {
    const kv = getKV();
    logger.info(`[KV RESULTS] Получаем результаты для ${jobIds.length} задач`);

    // Параллельная обработка всех jobIds
    const resultPromises = jobIds.map(async (jobId) => {
      try {
        const key = `queue:results:${jobId}`;
        const results = await kv.get(key, 'json');

        if (results && Array.isArray(results)) {
          return results;
        } else if (results) {
          return [results];
        }
        return [];
      } catch (error) {
        logger.error(`[KV RESULTS] Ошибка получения результатов ${jobId}:`, error.message);
        return [];
      }
    });

    // Ждем завершения всех параллельных запросов
    const allResultsArrays = await Promise.all(resultPromises);

    // Объединяем все результаты
    const allResults = allResultsArrays.flat();

    logger.info(`[KV RESULTS] Получено ${allResults.length} результатов`);
    return allResults;

  } catch (error) {
    logger.error('[KV RESULTS] Критическая ошибка:', error.message);
    throw new Error(`Ошибка получения результатов: ${error.message}`);
  }
}

// ОБНОВЛЕННЫЙ класс для batch обработки с учетом KV ограничений
export class NotionBatchProcessor {
  constructor(notionClient, options = {}) {
    this.notion = notionClient;
    this.options = {
      batchSize: Math.min(options.batchSize || 50, 100), // Ограничение для стабильности
      concurrency: Math.min(options.concurrency || 2, 2), // Максимум 2 параллельных
      rateLimitDelay: Math.max(options.rateLimitDelay || 2500, 2000), // Минимум 2 секунды
      maxRetries: Math.min(options.maxRetries || 3, 3),
      useKV: options.useKV || false,
      ...options
    };
  }
  
  async processBatchDirectly(operations) {
    logger.info(`[DIRECT PROCESSING] Начинаем обработку ${operations.length} операций`);
    const startTime = Date.now();

    const results = [];
    let successful = 0;
    let failed = 0;

    // Разбиваем на chunks для rate limiting
    const chunks = this.chunkArray(operations, this.options.batchSize);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      logger.debug(`[DIRECT PROCESSING] Обрабатываем chunk ${i + 1}/${chunks.length} (${chunk.length} операций)`);

      // Обрабатываем операции в chunk'е последовательно для стабильности
      for (const operation of chunk) {
        try {
          await notionRateLimit(); // Use centralized rate limiter
          const result = await this.executeNotionOperation(operation);
          results.push({ ...result, status: 'success' });
          successful++;
        } catch (error) {
          logger.error(`[DIRECT PROCESSING] Ошибка операции:`, error.message);
          results.push({
            operation,
            status: 'error',
            error: error.message
          });
          failed++;
        }
      }
    }

    const duration = Date.now() - startTime;

    logger.info(`[DIRECT PROCESSING] Завершено: ${successful} успешно, ${failed} ошибок, ${duration}ms`);

    return {
      results,
      stats: {
        totalOperations: operations.length,
        successful,
        failed,
        duration
      }
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

// Получение диагностической информации
export function getKVDiagnostics() {
  return {
    ...diagnostics,
    kvInitialized,
    lastInitTime,
    isConfigured: kvInitialized,
    timestamp: new Date().toISOString(),
    limits: KV_LIMITS
  };
}

// УЛУЧШЕННАЯ функция для очистки старых данных из KV
export async function cleanupKVQueue() {
  try {
    const kv = getKV();
    
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 часа
    let cleaned = 0;
    
    // Очищаем по префиксам
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
            
            // Задержка между операциями
            await new Promise(resolve => setTimeout(resolve, 10));
          } catch (error) {
            console.warn(`[KV CLEANUP] Ошибка очистки ${key.name}:`, error.message);
          }
        }
      } catch (prefixError) {
        console.warn(`[KV CLEANUP] Ошибка очистки префикса ${prefix}:`, prefixError.message);
      }
    }
    
    console.log(`[KV CLEANUP] Очищено ${cleaned} устаревших записей`);
    return cleaned;
  } catch (error) {
    console.error('[KV CLEANUP] Ошибка очистки:', error.message);
    return 0;
  }
}

// Экспорт констант для использования в других модулях
export { KV_LIMITS };