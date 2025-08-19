// lib/kv-queue.js - Исправленная система очередей на основе Cloudflare KV
// Основные исправления: правильная инициализация, обработка ошибок, fallback логика

// Глобальные переменные для KV
let KV_NAMESPACE = null;
let isKVAvailable = false;
let kvInitialized = false;

// Инициализация KV с улучшенной диагностикой
export function initKV(env = {}) {
  console.log('[KV INIT] Начинаем инициализацию KV с env:', Object.keys(env));
  
  // Ищем KV namespace в разных местах
  KV_NAMESPACE = env?.NOTION_QUEUE_KV || 
                 (typeof NOTION_QUEUE_KV !== 'undefined' ? NOTION_QUEUE_KV : null) ||
                 env?.KV ||
                 env?.QUEUE_KV;
  
  const prevStatus = isKVAvailable;
  isKVAvailable = Boolean(KV_NAMESPACE);
  kvInitialized = true;

  console.log(`[KV INIT] Результат инициализации:`, {
    kvAvailable: isKVAvailable,
    hadNamespace: !!KV_NAMESPACE,
    statusChanged: prevStatus !== isKVAvailable,
    envKeys: Object.keys(env),
    globalKVExists: typeof NOTION_QUEUE_KV !== 'undefined'
  });

  if (isKVAvailable) {
    console.log('[KV INIT] ✅ Cloudflare KV подключено успешно');
    
    // Тестируем KV доступность
    testKVAccess();
  } else {
    console.warn('[KV INIT] ⚠️ Cloudflare KV недоступно. Причины:');
    console.warn('- NOTION_QUEUE_KV binding не найден в env');
    console.warn('- Проверьте wrangler.toml конфигурацию');
    console.warn('- Убедитесь что KV namespace создан и привязан');
  }
  
  return isKVAvailable;
}

// Тестирование доступности KV
async function testKVAccess() {
  if (!KV_NAMESPACE) return false;
  
  try {
    const testKey = 'kv_test_' + Date.now();
    await KV_NAMESPACE.put(testKey, 'test', { expirationTtl: 60 });
    const value = await KV_NAMESPACE.get(testKey);
    await KV_NAMESPACE.delete(testKey);
    
    console.log('[KV TEST] ✅ KV работает корректно');
    return value === 'test';
  } catch (error) {
    console.error('[KV TEST] ❌ KV тест неудачен:', error.message);
    isKVAvailable = false;
    return false;
  }
}

// Ключи для организации данных в KV
const KV_KEYS = {
  JOB: 'job:',
  QUEUE: 'queue:',
  STATUS: 'status:',
  RESULT: 'result:',
  PROGRESS: 'progress:',
  ACTIVE_JOBS: 'system:active_jobs',
  QUEUE_STATS: 'system:queue_stats'
};

// Конфигурация
const CONFIG = {
  MAX_BATCH_SIZE: 75,              // Уменьшено для стабильности
  DEFAULT_CONCURRENCY: 2,          // Уменьшено для избежания rate limits
  DEFAULT_RATE_LIMIT: 2500,        // Увеличено для стабильности
  MAX_RETRIES: 3,
  JOB_TTL: 3600,
  RESULT_TTL: 7200,
  PROGRESS_UPDATE_INTERVAL: 5,
  KV_OPERATION_TIMEOUT: 5000       // Таймаут для KV операций
};

// Генераторы ID
function generateJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

function generateBatchId() {
  return `batch_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

// Утилиты для работы с KV с таймаутами и retry
class KVUtils {
  static async withTimeout(operation, timeout = CONFIG.KV_OPERATION_TIMEOUT) {
    return Promise.race([
      operation(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('KV operation timeout')), timeout)
      )
    ]);
  }

  static async put(key, value, ttl = CONFIG.JOB_TTL) {
    if (!isKVAvailable) {
      throw new Error('Cloudflare KV недоступно');
    }
    
    try {
      const serializedValue = JSON.stringify({
        data: value,
        timestamp: Date.now(),
        ttl: ttl
      });
      
      await this.withTimeout(async () => {
        await KV_NAMESPACE.put(key, serializedValue, {
          expirationTtl: ttl
        });
      });
      
      console.log(`[KV PUT] Сохранено: ${key} (TTL: ${ttl}s)`);
    } catch (error) {
      console.error(`[KV PUT] Ошибка сохранения ${key}:`, error.message);
      throw error;
    }
  }

  static async get(key, defaultValue = null) {
    if (!isKVAvailable) {
      return defaultValue;
    }
    
    try {
      const rawValue = await this.withTimeout(async () => {
        return await KV_NAMESPACE.get(key);
      });
      
      if (!rawValue) {
        return defaultValue;
      }
      
      const parsed = JSON.parse(rawValue);
      return parsed.data;
    } catch (error) {
      console.error(`[KV GET] Ошибка получения ${key}:`, error.message);
      return defaultValue;
    }
  }

  static async delete(key) {
    if (!isKVAvailable) return;
    
    try {
      await this.withTimeout(async () => {
        await KV_NAMESPACE.delete(key);
      });
      console.log(`[KV DELETE] Удалено: ${key}`);
    } catch (error) {
      console.error(`[KV DELETE] Ошибка удаления ${key}:`, error.message);
    }
  }

  static async listKeys(prefix, limit = 100) {
    if (!isKVAvailable) return [];
    
    try {
      const result = await this.withTimeout(async () => {
        return await KV_NAMESPACE.list({
          prefix: prefix,
          limit: limit
        });
      });
      
      return result.keys.map(k => k.name);
    } catch (error) {
      console.error(`[KV LIST] Ошибка получения списка ${prefix}:`, error.message);
      return [];
    }
  }

  static async atomicUpdate(key, updateFunction, ttl = CONFIG.JOB_TTL) {
    const currentValue = await this.get(key);
    const newValue = updateFunction(currentValue);
    await this.put(key, newValue, ttl);
    return newValue;
  }
}

// Основной класс для управления batch операциями
export class NotionBatchProcessor {
  constructor(notionClient, options = {}) {
    this.notion = notionClient;
    this.options = {
      batchSize: Math.min(options.batchSize || 50, CONFIG.MAX_BATCH_SIZE),
      concurrency: Math.min(options.concurrency || CONFIG.DEFAULT_CONCURRENCY, 5),
      rateLimitDelay: Math.max(options.rateLimitDelay || CONFIG.DEFAULT_RATE_LIMIT, 1500),
      maxRetries: Math.min(options.maxRetries || CONFIG.MAX_RETRIES, 5),
      useKV: options.useKV !== false && isKVAvailable,
      reviewerUserId: options.reviewerUserId || 'unknown',
      ...options
    };
    
    console.log(`[BATCH PROCESSOR] Инициализация:`, {
      useKV: this.options.useKV,
      kvAvailable: isKVAvailable,
      batchSize: this.options.batchSize,
      concurrency: this.options.concurrency,
      rateLimitDelay: this.options.rateLimitDelay
    });
  }

  async processBatch(operations, progressCallback = null) {
    console.log(`[BATCH] Начинаем обработку ${operations.length} операций`);
    
    // Автоматический выбор режима на основе размера и доступности KV
    if (this.options.useKV && operations.length > 10) {
      try {
        return await this.processBatchWithKV(operations, progressCallback);
      } catch (kvError) {
        console.error('[BATCH] KV обработка неудачна, переключаемся на прямую:', kvError.message);
        return await this.processBatchDirectly(operations, progressCallback);
      }
    } else {
      return await this.processBatchDirectly(operations, progressCallback);
    }
  }

  async processBatchWithKV(operations, progressCallback) {
    if (!isKVAvailable) {
      throw new Error('KV недоступно для batch обработки');
    }

    try {
      console.log('[BATCH KV] Используем Cloudflare KV для обработки');
      
      const batchId = generateBatchId();
      const chunks = this.chunkArray(operations, this.options.batchSize);
      const jobIds = [];

      // Сохраняем информацию о batch
      await KVUtils.put(`${KV_KEYS.QUEUE}${batchId}`, {
        batchId: batchId,
        totalOperations: operations.length,
        totalChunks: chunks.length,
        status: 'queued',
        createdAt: new Date().toISOString(),
        reviewerUserId: this.options.reviewerUserId,
        processorOptions: this.options
      }, CONFIG.JOB_TTL);

      // Создаем задачи для каждого chunk
      for (let i = 0; i < chunks.length; i++) {
        const jobId = generateJobId();
        const chunk = chunks[i];
        
        await KVUtils.put(`${KV_KEYS.JOB}${jobId}`, {
          jobId: jobId,
          batchId: batchId,
          chunkIndex: i,
          operations: chunk,
          status: 'pending',
          createdAt: new Date().toISOString(),
          processorOptions: this.options
        }, CONFIG.JOB_TTL);

        jobIds.push(jobId);
        console.log(`[BATCH KV] Создана задача ${i + 1}/${chunks.length}: ${jobId}`);
      }

      // Обновляем список активных задач
      await this.updateActiveJobsList(jobIds, 'add');

      return {
        mode: 'kv_queue',
        batchId: batchId,
        jobIds: jobIds,
        totalOperations: operations.length,
        totalJobs: jobIds.length,
        message: `Создано ${jobIds.length} задач для обработки ${operations.length} операций`
      };

    } catch (error) {
      console.error('[BATCH KV] Ошибка при обработке через KV:', error.message);
      throw error;
    }
  }

  async processKVJobs(jobIds, progressCallback) {
    console.log(`[KV WORKER] Начинаем обработку ${jobIds.length} задач`);
    
    // Последовательная обработка задач для избежания rate limits
    for (let i = 0; i < jobIds.length; i++) {
      const jobId = jobIds[i];
      
      try {
        console.log(`[KV WORKER] Обрабатываем задачу ${i + 1}/${jobIds.length}: ${jobId}`);
        await this.processKVJob(jobId, progressCallback);
        
        // Применяем rate limiting между задачами
        if (i < jobIds.length - 1) {
          console.log(`[KV WORKER] Пауза ${this.options.rateLimitDelay}ms перед следующей задачей`);
          await this.delay(this.options.rateLimitDelay);
        }
      } catch (error) {
        console.error(`[KV WORKER] Ошибка обработки задачи ${jobId}:`, error.message);
        
        // Помечаем задачу как неудачную
        try {
          await KVUtils.atomicUpdate(`${KV_KEYS.STATUS}${jobId}`, (current) => ({
            ...current,
            status: 'failed',
            error: error.message,
            finishedAt: new Date().toISOString()
          }));
        } catch (statusError) {
          console.error(`[KV WORKER] Не удалось обновить статус неудачной задачи ${jobId}:`, statusError.message);
        }
      }
    }

    // Удаляем задачи из списка активных
    await this.updateActiveJobsList(jobIds, 'remove');
    
    console.log('[KV WORKER] Все задачи обработаны');
  }

  async processKVJob(jobId, progressCallback) {
    console.log(`[KV JOB] Начинаем обработку задачи: ${jobId}`);
    
    // Получаем информацию о задаче
    const jobData = await KVUtils.get(`${KV_KEYS.JOB}${jobId}`);
    
    if (!jobData) {
      throw new Error(`Задача ${jobId} не найдена в KV`);
    }

    // Обновляем статус на "выполняется"
    await KVUtils.put(`${KV_KEYS.STATUS}${jobId}`, {
      jobId: jobId,
      batchId: jobData.batchId,
      status: 'processing',
      startedAt: new Date().toISOString(),
      totalOperations: jobData.operations.length,
      processedOperations: 0,
      successfulOperations: 0,
      failedOperations: 0
    }, CONFIG.RESULT_TTL);

    const results = [];
    let processedCount = 0;

    // Обрабатываем операции в задаче с контролем concurrency
    const operations = jobData.operations;
    
    for (let i = 0; i < operations.length; i += this.options.concurrency) {
      const batch = operations.slice(i, i + this.options.concurrency);
      
      // Обрабатываем batch операций параллельно
      const batchPromises = batch.map(async (operation) => {
        try {
          const result = await this.processOperation(operation);
          return {
            operation: operation,
            result: result,
            status: 'success'
          };
        } catch (error) {
          console.error(`[KV JOB] Ошибка операции в задаче ${jobId}:`, error.message);
          return {
            operation: operation,
            error: error.message,
            status: 'error'
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      processedCount += batch.length;
      
      // Обновляем прогресс
      if (processedCount % CONFIG.PROGRESS_UPDATE_INTERVAL === 0 || processedCount === operations.length) {
        await this.updateJobProgress(jobId, processedCount, operations.length, results);
        
        if (progressCallback) {
          progressCallback({
            jobId: jobId,
            processed: processedCount,
            total: operations.length,
            progress: (processedCount / operations.length) * 100
          });
        }
      }

      // Rate limiting между batch-ами
      if (i + this.options.concurrency < operations.length) {
        await this.delay(this.options.rateLimitDelay / 2);
      }
    }

    // Сохраняем финальные результаты
    await KVUtils.put(`${KV_KEYS.RESULT}${jobId}`, {
      jobId: jobId,
      batchId: jobData.batchId,
      results: results,
      stats: {
        total: operations.length,
        successful: results.filter(r => r.status === 'success').length,
        failed: results.filter(r => r.status === 'error').length
      },
      completedAt: new Date().toISOString()
    }, CONFIG.RESULT_TTL);

    // Обновляем финальный статус
    await KVUtils.put(`${KV_KEYS.STATUS}${jobId}`, {
      jobId: jobId,
      batchId: jobData.batchId,
      status: 'completed',
      startedAt: (await KVUtils.get(`${KV_KEYS.STATUS}${jobId}`))?.startedAt,
      finishedAt: new Date().toISOString(),
      totalOperations: operations.length,
      processedOperations: processedCount,
      successfulOperations: results.filter(r => r.status === 'success').length,
      failedOperations: results.filter(r => r.status === 'error').length
    }, CONFIG.RESULT_TTL);

    console.log(`[KV JOB] Задача ${jobId} завершена. Успешно: ${results.filter(r => r.status === 'success').length}/${operations.length}`);
    
    return results;
  }

  async processBatchDirectly(operations, progressCallback) {
    console.log('[BATCH DIRECT] Используем прямую обработку без KV');
    
    const chunks = this.chunkArray(operations, this.options.batchSize);
    const allResults = [];
    let totalProcessed = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[BATCH DIRECT] Обрабатываем пакет ${i + 1}/${chunks.length} (${chunk.length} операций)`);

      try {
        const chunkResults = await this.processChunkWithConcurrency(chunk);
        allResults.push(...chunkResults);
        totalProcessed += chunk.length;

        if (progressCallback) {
          progressCallback({
            processed: totalProcessed,
            total: operations.length,
            progress: (totalProcessed / operations.length) * 100,
            currentChunk: i + 1,
            totalChunks: chunks.length,
            mode: 'direct'
          });
        }

        if (i < chunks.length - 1) {
          console.log(`[BATCH DIRECT] Пауза ${this.options.rateLimitDelay}ms перед следующим пакетом`);
          await this.delay(this.options.rateLimitDelay);
        }

      } catch (error) {
        console.error(`[BATCH DIRECT] Ошибка в пакете ${i + 1}:`, error.message);
        
        const errorResults = chunk.map(op => ({
          operation: op,
          status: 'error',
          error: error.message
        }));
        allResults.push(...errorResults);
        totalProcessed += chunk.length;
      }
    }

    console.log(`[BATCH DIRECT] Завершена прямая обработка. Успешно: ${allResults.filter(r => r.status === 'success').length}/${operations.length}`);
    return {
      mode: 'direct',
      results: allResults,
      stats: {
        total: operations.length,
        successful: allResults.filter(r => r.status === 'success').length,
        failed: allResults.filter(r => r.status === 'error').length
      }
    };
  }

  async processChunkWithConcurrency(chunk) {
    const results = [];
    
    for (let i = 0; i < chunk.length; i += this.options.concurrency) {
      const concurrentGroup = chunk.slice(i, i + this.options.concurrency);
      
      const groupPromises = concurrentGroup.map(operation => 
        this.processOperation(operation)
      );
      
      const groupResults = await Promise.allSettled(groupPromises);
      
      for (let j = 0; j < groupResults.length; j++) {
        const result = groupResults[j];
        const operation = concurrentGroup[j];
        
        if (result.status === 'fulfilled') {
          results.push({
            operation: operation,
            result: result.value,
            status: 'success'
          });
        } else {
          results.push({
            operation: operation,
            error: result.reason.message,
            status: 'error'
          });
        }
      }

      if (i + this.options.concurrency < chunk.length) {
        await this.delay(Math.max(500, this.options.rateLimitDelay / 4));
      }
    }

    return results;
  }

  async processOperation(operation) {
    let lastError;

    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = Math.min(2 ** attempt * 1000, 10000);
          console.log(`[OPERATION] Повтор ${attempt + 1} для ${operation.pageId}, ожидание ${delay}ms`);
          await this.delay(delay);
        }

        const result = await this.notion.pages.update({
          page_id: operation.pageId,
          properties: operation.properties
        });

        return result;

      } catch (error) {
        lastError = error;
        console.error(`[OPERATION] Попытка ${attempt + 1} неудачна для ${operation.pageId}:`, error.message);

        if (!this.shouldRetry(error) || attempt === this.options.maxRetries - 1) {
          break;
        }

        if (error.status === 429 && error.headers?.['retry-after']) {
          const retryAfter = parseInt(error.headers['retry-after']) * 1000;
          console.log(`[OPERATION] Rate limit. Ждем ${retryAfter}ms`);
          await this.delay(retryAfter);
        }
      }
    }

    throw lastError;
  }

  shouldRetry(error) {
    const retryableStatuses = [429, 500, 502, 503, 504];
    const retryableCodes = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'];
    
    return retryableStatuses.includes(error.status) || 
           retryableCodes.includes(error.code) ||
           error.message.includes('timeout');
  }

  async updateJobProgress(jobId, processed, total, results) {
    try {
      const successful = results.filter(r => r.status === 'success').length;
      const failed = results.filter(r => r.status === 'error').length;
      
      await KVUtils.put(`${KV_KEYS.PROGRESS}${jobId}`, {
        jobId: jobId,
        processed: processed,
        total: total,
        progress: (processed / total) * 100,
        successful: successful,
        failed: failed,
        updatedAt: new Date().toISOString()
      }, CONFIG.RESULT_TTL);
    } catch (error) {
      console.error(`[KV PROGRESS] Ошибка обновления прогресса для ${jobId}:`, error.message);
    }
  }

  async updateActiveJobsList(jobIds, action) {
    try {
      await KVUtils.atomicUpdate(KV_KEYS.ACTIVE_JOBS, (current) => {
        const activeJobs = current || [];
        
        if (action === 'add') {
          const newJobs = jobIds.filter(id => !activeJobs.includes(id));
          return [...activeJobs, ...newJobs];
        } else if (action === 'remove') {
          return activeJobs.filter(id => !jobIds.includes(id));
        }
        
        return activeJobs;
      });
    } catch (error) {
      console.error('[KV ACTIVE JOBS] Ошибка обновления списка активных задач:', error.message);
    }
  }

  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Экспортные функции для управления очередями
export async function addBatchToKVQueue(operations, options = {}) {
  if (!isKVAvailable) {
    throw new Error('Cloudflare KV недоступно для добавления в очередь');
  }

  const processor = new NotionBatchProcessor(null, {
    ...options,
    useKV: true
  });
  
  const batchId = generateBatchId();
  const chunks = processor.chunkArray(operations, options.batchSize || 50);
  const jobIds = [];

  try {
    // Создаем batch информацию
    await KVUtils.put(`${KV_KEYS.QUEUE}${batchId}`, {
      batchId: batchId,
      totalOperations: operations.length,
      totalChunks: chunks.length,
      status: 'created',
      createdAt: new Date().toISOString(),
      options: options
    }, CONFIG.JOB_TTL);

    // Создаем задачи
    for (let i = 0; i < chunks.length; i++) {
      const jobId = generateJobId();
      
      await KVUtils.put(`${KV_KEYS.JOB}${jobId}`, {
        jobId: jobId,
        batchId: batchId,
        chunkIndex: i,
        operations: chunks[i],
        status: 'pending',
        createdAt: new Date().toISOString(),
        processorOptions: options
      }, CONFIG.JOB_TTL);

      jobIds.push(jobId);
    }

    console.log(`[ADD BATCH] Добавлено в KV: batch ${batchId}, задач: ${jobIds.length}`);
    return { batchId, jobIds };
  } catch (error) {
    console.error('[ADD BATCH] Ошибка добавления в KV:', error.message);
    throw error;
  }
}

export async function getKVBatchStatus(jobIds) {
  if (!isKVAvailable) {
    console.warn('[GET STATUS] KV недоступно');
    return null;
  }

  const statuses = [];

  for (const jobId of jobIds) {
    try {
      const status = await KVUtils.get(`${KV_KEYS.STATUS}${jobId}`);
      const progress = await KVUtils.get(`${KV_KEYS.PROGRESS}${jobId}`);
      
      if (status) {
        statuses.push({
          id: jobId,
          ...status,
          progress: progress?.progress || 0,
          processed: progress?.processed || 0,
          total: progress?.total || 0
        });
      } else {
        const job = await KVUtils.get(`${KV_KEYS.JOB}${jobId}`);
        
        statuses.push({
          id: jobId,
          status: job ? 'pending' : 'not_found',
          progress: 0,
          processed: 0,
          total: job?.operations?.length || 0
        });
      }
    } catch (error) {
      console.error(`[GET STATUS] Ошибка получения статуса для ${jobId}:`, error.message);
      statuses.push({
        id: jobId,
        status: 'error',
        error: error.message,
        progress: 0
      });
    }
  }

  return statuses;
}

export async function getKVBatchResults(jobIds) {
  if (!isKVAvailable) {
    console.warn('[GET RESULTS] KV недоступно');
    return null;
  }

  const allResults = [];

  for (const jobId of jobIds) {
    try {
      const result = await KVUtils.get(`${KV_KEYS.RESULT}${jobId}`);
      
      if (result && result.results) {
        allResults.push(...result.results);
      }
    } catch (error) {
      console.error(`[GET RESULTS] Ошибка получения результатов для ${jobId}:`, error.message);
    }
  }

  return allResults;
}

// Экспорт статуса KV
export const isKVConnected = () => isKVAvailable;
export const getKVNamespace = () => KV_NAMESPACE;

// Принудительное отключение KV (для тестирования)
export function disableKV() {
  isKVAvailable = false;
  KV_NAMESPACE = null;
  console.log('[KV] Принудительно отключено');
}

// Переинициализация KV
export function reinitKV(env) {
  kvInitialized = false;
  return initKV(env);
}