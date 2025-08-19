// lib/kv-queue.js - Система очередей на основе Cloudflare KV для оптимизации Notion API batch операций
// Cloudflare KV - это глобально распределенное key-value хранилище, идеально подходящее для Edge Runtime

// Проверяем доступность Cloudflare KV
let KV_NAMESPACE = null;
let isKVAvailable = false;

// Инициализация KV с передачей объекта окружения
export function initKV(env = {}) {
  KV_NAMESPACE = env?.NOTION_QUEUE_KV || null;
  isKVAvailable = Boolean(KV_NAMESPACE);

  if (isKVAvailable) {
    console.log('[KV] Cloudflare KV подключено успешно');
  } else {
    console.warn('[KV] Cloudflare KV недоступно (вероятно, локальная разработка)');
  }
}

// Ключи для организации данных в KV
const KV_KEYS = {
  // Префиксы для разных типов данных
  JOB: 'job:',           // Информация о задаче
  QUEUE: 'queue:',       // Очередь задач
  STATUS: 'status:',     // Статус выполнения
  RESULT: 'result:',     // Результаты выполнения
  PROGRESS: 'progress:', // Прогресс выполнения
  
  // Системные ключи
  ACTIVE_JOBS: 'system:active_jobs',    // Список активных задач
  QUEUE_STATS: 'system:queue_stats',    // Статистика очереди
  WORKER_STATUS: 'system:worker_status'  // Статус воркеров
};

// Конфигурация для обработки
const CONFIG = {
  MAX_BATCH_SIZE: 100,           // Максимальный размер пакета
  DEFAULT_CONCURRENCY: 3,        // Стандартное количество одновременных операций
  DEFAULT_RATE_LIMIT: 2000,      // Стандартная задержка между запросами (мс)
  MAX_RETRIES: 3,               // Максимальное количество попыток
  JOB_TTL: 3600,                // Время жизни задачи в секундах (1 час)
  RESULT_TTL: 7200,             // Время жизни результатов в секундах (2 часа)
  PROGRESS_UPDATE_INTERVAL: 5,   // Интервал обновления прогресса (каждые N операций)
};

// Генератор уникальных ID
function generateJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

function generateBatchId() {
  return `batch_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

// Утилиты для работы с KV
class KVUtils {
  // Сохранение данных с TTL
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
      
      await KV_NAMESPACE.put(key, serializedValue, {
        expirationTtl: ttl
      });
      
      console.log(`[KV] Сохранено: ${key} (TTL: ${ttl}s)`);
    } catch (error) {
      console.error(`[KV] Ошибка сохранения ${key}:`, error.message);
      throw error;
    }
  }

  // Получение данных
  static async get(key, defaultValue = null) {
    if (!isKVAvailable) {
      return defaultValue;
    }
    
    try {
      const rawValue = await KV_NAMESPACE.get(key);
      
      if (!rawValue) {
        return defaultValue;
      }
      
      const parsed = JSON.parse(rawValue);
      return parsed.data;
    } catch (error) {
      console.error(`[KV] Ошибка получения ${key}:`, error.message);
      return defaultValue;
    }
  }

  // Удаление данных
  static async delete(key) {
    if (!isKVAvailable) {
      return;
    }
    
    try {
      await KV_NAMESPACE.delete(key);
      console.log(`[KV] Удалено: ${key}`);
    } catch (error) {
      console.error(`[KV] Ошибка удаления ${key}:`, error.message);
    }
  }

  // Получение списка ключей по префиксу
  static async listKeys(prefix, limit = 100) {
    if (!isKVAvailable) {
      return [];
    }
    
    try {
      const result = await KV_NAMESPACE.list({
        prefix: prefix,
        limit: limit
      });
      
      return result.keys.map(k => k.name);
    } catch (error) {
      console.error(`[KV] Ошибка получения списка ${prefix}:`, error.message);
      return [];
    }
  }

  // Атомарное обновление (эмуляция через get-modify-put)
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
      concurrency: Math.min(options.concurrency || CONFIG.DEFAULT_CONCURRENCY, 10),
      rateLimitDelay: Math.max(options.rateLimitDelay || CONFIG.DEFAULT_RATE_LIMIT, 1000),
      maxRetries: Math.min(options.maxRetries || CONFIG.MAX_RETRIES, 5),
      useKV: options.useKV !== false && isKVAvailable,
      reviewerUserId: options.reviewerUserId || 'unknown',
      ...options
    };
    
    console.log(`[BATCH PROCESSOR] Инициализация. KV: ${this.options.useKV ? 'включен' : 'отключен'}`);
  }

  // Основной метод для обработки batch операций
  async processBatch(operations, progressCallback = null) {
    console.log(`[BATCH] Начинаем обработку ${operations.length} операций`);
    
    if (this.options.useKV && operations.length > 5) {
      // Используем KV очереди для больших batch операций
      return await this.processBatchWithKV(operations, progressCallback);
    } else {
      // Обрабатываем напрямую для небольших операций или когда KV недоступен
      return await this.processBatchDirectly(operations, progressCallback);
    }
  }

  // Обработка через KV очереди (для больших объемов)
  async processBatchWithKV(operations, progressCallback) {
    try {
      console.log('[BATCH] Используем Cloudflare KV для обработки больших batch операций');
      
      // Создаем batch задачу
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
        console.log(`[BATCH] Создана задача ${i + 1}/${chunks.length}: ${jobId}`);
      }

      // Обновляем список активных задач
      await this.updateActiveJobsList(jobIds, 'add');

      // Запускаем фоновую обработку
      this.processKVJobs(jobIds, progressCallback);

      console.log(`[BATCH] Создано ${jobIds.length} задач в KV очереди`);
      
      return {
        mode: 'kv_queue',
        batchId: batchId,
        jobIds: jobIds,
        totalOperations: operations.length,
        totalJobs: jobIds.length,
        message: `Создано ${jobIds.length} задач для обработки ${operations.length} операций`
      };

    } catch (error) {
      console.error('[BATCH] Ошибка при обработке через KV:', error.message);
      
      // Fallback к прямой обработке
      console.log('[BATCH] Переходим к прямой обработке');
      return await this.processBatchDirectly(operations, progressCallback);
    }
  }

  // Фоновая обработка задач из KV
  async processKVJobs(jobIds, progressCallback) {
    console.log(`[KV WORKER] Начинаем обработку ${jobIds.length} задач`);
    
    // Обрабатываем задачи последовательно с учетом rate limiting
    for (const jobId of jobIds) {
      try {
        await this.processKVJob(jobId, progressCallback);
        
        // Применяем rate limiting между задачами
        await this.delay(this.options.rateLimitDelay);
      } catch (error) {
        console.error(`[KV WORKER] Ошибка обработки задачи ${jobId}:`, error.message);
        
        // Помечаем задачу как неудачную
        await KVUtils.atomicUpdate(`${KV_KEYS.STATUS}${jobId}`, (current) => ({
          ...current,
          status: 'failed',
          error: error.message,
          finishedAt: new Date().toISOString()
        }));
      }
    }

    // Удаляем задачи из списка активных
    await this.updateActiveJobsList(jobIds, 'remove');
    
    console.log('[KV WORKER] Все задачи обработаны');
  }

  // Обработка одной задачи из KV
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

    // Обрабатываем операции в задаче
    for (const operation of jobData.operations) {
      try {
        const result = await this.processOperation(operation);
        results.push({
          operation: operation,
          result: result,
          status: 'success'
        });
        
        processedCount++;
        
        // Обновляем прогресс каждые N операций
        if (processedCount % CONFIG.PROGRESS_UPDATE_INTERVAL === 0 || processedCount === jobData.operations.length) {
          await this.updateJobProgress(jobId, processedCount, jobData.operations.length, results);
          
          // Уведомляем о прогрессе
          if (progressCallback) {
            progressCallback({
              jobId: jobId,
              processed: processedCount,
              total: jobData.operations.length,
              progress: (processedCount / jobData.operations.length) * 100
            });
          }
        }

        // Rate limiting между операциями
        if (processedCount < jobData.operations.length) {
          await this.delay(this.options.rateLimitDelay);
        }

      } catch (error) {
        results.push({
          operation: operation,
          error: error.message,
          status: 'error'
        });
        processedCount++;
        
        console.error(`[KV JOB] Ошибка операции в задаче ${jobId}:`, error.message);
      }
    }

    // Сохраняем финальные результаты
    await KVUtils.put(`${KV_KEYS.RESULT}${jobId}`, {
      jobId: jobId,
      batchId: jobData.batchId,
      results: results,
      stats: {
        total: jobData.operations.length,
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
      totalOperations: jobData.operations.length,
      processedOperations: processedCount,
      successfulOperations: results.filter(r => r.status === 'success').length,
      failedOperations: results.filter(r => r.status === 'error').length
    }, CONFIG.RESULT_TTL);

    console.log(`[KV JOB] Задача ${jobId} завершена. Успешно: ${results.filter(r => r.status === 'success').length}/${jobData.operations.length}`);
    
    return results;
  }

  // Прямая обработка без KV (fallback)
  async processBatchDirectly(operations, progressCallback) {
    console.log('[BATCH] Используем прямую обработку без KV');
    
    const chunks = this.chunkArray(operations, this.options.batchSize);
    const allResults = [];
    let totalProcessed = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[BATCH] Обрабатываем пакет ${i + 1}/${chunks.length} (${chunk.length} операций)`);

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
          console.log(`[BATCH] Пауза ${this.options.rateLimitDelay}ms перед следующим пакетом`);
          await this.delay(this.options.rateLimitDelay);
        }

      } catch (error) {
        console.error(`[BATCH] Ошибка в пакете ${i + 1}:`, error.message);
        
        const errorResults = chunk.map(op => ({
          operation: op,
          status: 'error',
          error: error.message
        }));
        allResults.push(...errorResults);
        totalProcessed += chunk.length;
      }
    }

    console.log(`[BATCH] Завершена прямая обработка. Успешно: ${allResults.filter(r => r.status === 'success').length}/${operations.length}`);
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

  // Обработка пакета с контролем concurrency
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
        await this.delay(500);
      }
    }

    return results;
  }

  // Обработка одной операции с retry логикой
  async processOperation(operation) {
    let lastError;

    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
      try {
        console.log(`[OPERATION] Попытка ${attempt + 1} для операции ${operation.pageId}`);
        
        if (attempt > 0) {
          const delay = Math.min(2 ** attempt * 1000, 10000);
          await this.delay(delay);
        }

        const result = await this.notion.pages.update({
          page_id: operation.pageId,
          properties: operation.properties
        });

        console.log(`[OPERATION] Успешно обновлена страница ${operation.pageId}`);
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

  // Проверка, стоит ли повторять операцию
  shouldRetry(error) {
    const retryableStatuses = [429, 500, 502, 503, 504];
    const retryableCodes = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'];
    
    return retryableStatuses.includes(error.status) || 
           retryableCodes.includes(error.code) ||
           error.message.includes('timeout');
  }

  // Обновление прогресса задачи в KV
  async updateJobProgress(jobId, processed, total, results) {
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
  }

  // Управление списком активных задач
  async updateActiveJobsList(jobIds, action) {
    try {
      await KVUtils.atomicUpdate(KV_KEYS.ACTIVE_JOBS, (current) => {
        const activeJobs = current || [];
        
        if (action === 'add') {
          // Добавляем новые задачи
          const newJobs = jobIds.filter(id => !activeJobs.includes(id));
          return [...activeJobs, ...newJobs];
        } else if (action === 'remove') {
          // Удаляем задачи
          return activeJobs.filter(id => !jobIds.includes(id));
        }
        
        return activeJobs;
      });
    } catch (error) {
      console.error('[KV] Ошибка обновления списка активных задач:', error.message);
    }
  }

  // Утилиты
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

// Функции для управления очередями в KV
export async function addBatchToKVQueue(operations, options = {}) {
  if (!isKVAvailable) {
    throw new Error('Cloudflare KV недоступно');
  }

  const processor = new NotionBatchProcessor(null, options);
  const batchId = generateBatchId();
  const chunks = processor.chunkArray(operations, options.batchSize || 50);
  const jobIds = [];

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

  return { batchId, jobIds };
}

export async function getKVBatchStatus(jobIds) {
  if (!isKVAvailable) {
    return null;
  }

  const statuses = [];

  for (const jobId of jobIds) {
    try {
      // Получаем статус задачи
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
        // Если нет статуса, проверяем исходную задачу
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
      console.error(`[KV] Ошибка получения результатов для ${jobId}:`, error.message);
    }
  }

  return allResults;
}

// Очистка старых данных в KV
export async function cleanupKVQueue() {
  if (!isKVAvailable) {
    return;
  }

  try {
    console.log('[KV CLEANUP] Начинаем очистку старых данных');
    
    // Получаем список всех ключей с префиксами
    const prefixes = [KV_KEYS.JOB, KV_KEYS.STATUS, KV_KEYS.RESULT, KV_KEYS.PROGRESS];
    
    for (const prefix of prefixes) {
      const keys = await KVUtils.listKeys(prefix, 1000);
      
      for (const key of keys) {
        try {
          const data = await KVUtils.get(key);
          
          // Проверяем возраст данных
          if (data && data.timestamp) {
            const age = Date.now() - data.timestamp;
            const maxAge = CONFIG.RESULT_TTL * 1000; // Конвертируем в миллисекунды
            
            if (age > maxAge) {
              await KVUtils.delete(key);
              console.log(`[KV CLEANUP] Удален старый ключ: ${key}`);
            }
          }
        } catch (error) {
          // Если не можем прочитать ключ, удаляем его
          await KVUtils.delete(key);
        }
      }
    }
    
    console.log('[KV CLEANUP] Очистка завершена');
  } catch (error) {
    console.error('[KV CLEANUP] Ошибка очистки:', error.message);
  }
}

// Экспорт статуса KV
export const isKVConnected = () => isKVAvailable;
export const getKVNamespace = () => KV_NAMESPACE;