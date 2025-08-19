// lib/kv-queue.js - ИСПРАВЛЕННАЯ система очередей на основе Cloudflare KV
// Главное исправление: правильная работа с глобальными переменными Cloudflare Pages

// Глобальные переменные для KV
let KV_NAMESPACE = null;
let isKVAvailable = false;
let kvInitialized = false;

// ИСПРАВЛЕНИЕ: Правильная инициализация KV для Cloudflare Pages
export function initKV(env = {}) {
  console.log('[KV INIT] Начинаем инициализацию KV...');
  
  // В Cloudflare Pages/Workers KV namespace доступен как глобальная переменная
  // Проверяем несколько способов доступа к KV
  try {
    // Способ 1: Прямой доступ к глобальной переменной (основной для Pages)
    if (typeof NOTION_QUEUE_KV !== 'undefined' && NOTION_QUEUE_KV) {
      KV_NAMESPACE = NOTION_QUEUE_KV;
      console.log('[KV INIT] KV найден через глобальную переменную NOTION_QUEUE_KV');
    }
    // Способ 2: Через переданный env (для Workers)
    else if (env?.NOTION_QUEUE_KV) {
      KV_NAMESPACE = env.NOTION_QUEUE_KV;
      console.log('[KV INIT] KV найден через env.NOTION_QUEUE_KV');
    }
    // Способ 3: Альтернативные имена
    else if (env?.KV) {
      KV_NAMESPACE = env.KV;
      console.log('[KV INIT] KV найден через env.KV');
    }
    // Способ 4: Проверка глобального контекста
    else if (typeof globalThis !== 'undefined' && globalThis.NOTION_QUEUE_KV) {
      KV_NAMESPACE = globalThis.NOTION_QUEUE_KV;
      console.log('[KV INIT] KV найден через globalThis.NOTION_QUEUE_KV');
    }
  } catch (error) {
    console.warn('[KV INIT] Ошибка при поиске KV namespace:', error.message);
  }
  
  const prevStatus = isKVAvailable;
  isKVAvailable = Boolean(KV_NAMESPACE);
  kvInitialized = true;

  console.log(`[KV INIT] Результат инициализации:`, {
    kvAvailable: isKVAvailable,
    hadNamespace: !!KV_NAMESPACE,
    statusChanged: prevStatus !== isKVAvailable,
    envKeys: Object.keys(env),
    globalKVExists: typeof NOTION_QUEUE_KV !== 'undefined',
    globalThisKVExists: typeof globalThis !== 'undefined' && !!globalThis.NOTION_QUEUE_KV
  });

  if (isKVAvailable) {
    console.log('[KV INIT] ✅ Cloudflare KV подключено успешно');
    
    // Тестируем KV доступность асинхронно
    testKVAccess().catch(error => {
      console.error('[KV INIT] Тест KV неудачен:', error.message);
      isKVAvailable = false;
      KV_NAMESPACE = null;
    });
  } else {
    console.warn('[KV INIT] ⚠️ Cloudflare KV недоступно. Возможные причины:');
    console.warn('- NOTION_QUEUE_KV binding не найден');
    console.warn('- Проверьте wrangler.toml конфигурацию');
    console.warn('- Убедитесь что KV namespace создан и привязан');
    console.warn('- Переразверните приложение после изменений в wrangler.toml');
  }
  
  return isKVAvailable;
}

// ИСПРАВЛЕНИЕ: Более надежное тестирование доступности KV
async function testKVAccess() {
  if (!KV_NAMESPACE) return false;
  
  try {
    const testKey = 'kv_test_' + Date.now();
    const testValue = 'test_connectivity';
    
    // Проверяем базовые операции KV
    await KV_NAMESPACE.put(testKey, testValue, { expirationTtl: 60 });
    const retrievedValue = await KV_NAMESPACE.get(testKey);
    await KV_NAMESPACE.delete(testKey);
    
    const isWorking = retrievedValue === testValue;
    console.log(`[KV TEST] ${isWorking ? '✅' : '❌'} KV тест ${isWorking ? 'прошел' : 'провален'}`);
    
    if (!isWorking) {
      throw new Error('KV операции не работают корректно');
    }
    
    return true;
  } catch (error) {
    console.error('[KV TEST] ❌ KV тест неудачен:', error.message);
    isKVAvailable = false;
    KV_NAMESPACE = null;
    return false;
  }
}

// ИСПРАВЛЕНИЕ: Более простая проверка статуса KV
export function isKVConnected() {
  // Автоматическая переинициализация если KV стал доступен
  if (!kvInitialized || (!isKVAvailable && typeof NOTION_QUEUE_KV !== 'undefined')) {
    console.log('[KV CHECK] Переинициализация KV...');
    initKV();
  }
  
  return isKVAvailable && !!KV_NAMESPACE;
}

// Принудительное отключение KV (для отладки)
export function disableKV() {
  console.log('[KV DISABLE] Принудительно отключаем KV');
  isKVAvailable = false;
  KV_NAMESPACE = null;
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
  MAX_BATCH_SIZE: 75,
  DEFAULT_CONCURRENCY: 2,
  DEFAULT_RATE_LIMIT: 2500,
  MAX_RETRIES: 3,
  JOB_TTL: 3600,
  RESULT_TTL: 7200,
  PROGRESS_UPDATE_INTERVAL: 5,
  KV_OPERATION_TIMEOUT: 5000
};

// Генераторы ID
function generateJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

function generateBatchId() {
  return `batch_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

// ИСПРАВЛЕНИЕ: Более надежные утилиты для работы с KV
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
    if (!isKVAvailable || !KV_NAMESPACE) {
      throw new Error('Cloudflare KV недоступно для записи');
    }
    
    try {
      const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
      return await this.withTimeout(() => 
        KV_NAMESPACE.put(key, serializedValue, { expirationTtl: ttl })
      );
    } catch (error) {
      console.error(`[KV PUT] Ошибка записи ключа ${key}:`, error.message);
      throw new Error(`KV PUT failed: ${error.message}`);
    }
  }

  static async get(key, parseJSON = true) {
    if (!isKVAvailable || !KV_NAMESPACE) {
      throw new Error('Cloudflare KV недоступно для чтения');
    }
    
    try {
      const value = await this.withTimeout(() => KV_NAMESPACE.get(key));
      
      if (value === null) {
        return null;
      }
      
      if (!parseJSON) {
        return value;
      }
      
      try {
        return JSON.parse(value);
      } catch (parseError) {
        console.warn(`[KV GET] Не удалось парсить JSON для ключа ${key}, возвращаем строку`);
        return value;
      }
    } catch (error) {
      console.error(`[KV GET] Ошибка чтения ключа ${key}:`, error.message);
      throw new Error(`KV GET failed: ${error.message}`);
    }
  }

  static async delete(key) {
    if (!isKVAvailable || !KV_NAMESPACE) {
      throw new Error('Cloudflare KV недоступно для удаления');
    }
    
    try {
      return await this.withTimeout(() => KV_NAMESPACE.delete(key));
    } catch (error) {
      console.error(`[KV DELETE] Ошибка удаления ключа ${key}:`, error.message);
      throw new Error(`KV DELETE failed: ${error.message}`);
    }
  }

  static async list(prefix = '', limit = 100) {
    if (!isKVAvailable || !KV_NAMESPACE) {
      throw new Error('Cloudflare KV недоступно для листинга');
    }
    
    try {
      return await this.withTimeout(() => 
        KV_NAMESPACE.list({ prefix, limit })
      );
    } catch (error) {
      console.error(`[KV LIST] Ошибка листинга с префиксом ${prefix}:`, error.message);
      throw new Error(`KV LIST failed: ${error.message}`);
    }
  }
}

// ИСПРАВЛЕНИЕ: Основной класс для batch обработки операций
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
        totalJobs: chunks.length,
        status: 'pending',
        createdAt: new Date().toISOString(),
        options: this.options
      });

      // Создаем задачи для каждого chunk
      for (let i = 0; i < chunks.length; i++) {
        const jobId = generateJobId();
        const jobData = {
          jobId,
          batchId,
          operations: chunks[i],
          status: 'pending',
          chunkIndex: i,
          totalChunks: chunks.length,
          createdAt: new Date().toISOString(),
          retries: 0,
          maxRetries: this.options.maxRetries
        };

        await KVUtils.put(`${KV_KEYS.JOB}${jobId}`, jobData);
        jobIds.push(jobId);
      }

      console.log(`[BATCH KV] Создано ${jobIds.length} задач для ${operations.length} операций`);

      return {
        mode: 'kv_queue',
        batchId,
        jobIds,
        totalOperations: operations.length,
        totalJobs: chunks.length,
        estimatedDuration: Math.ceil(operations.length * 3)
      };

    } catch (error) {
      console.error('[BATCH KV] Ошибка KV обработки:', error.message);
      throw error;
    }
  }

  async processBatchDirectly(operations, progressCallback) {
    console.log('[BATCH DIRECT] Используем прямую обработку');
    
    const startTime = Date.now();
    const results = [];
    const stats = {
      totalOperations: operations.length,
      successful: 0,
      failed: 0,
      duration: 0
    };

    const chunks = this.chunkArray(operations, this.options.batchSize);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[BATCH DIRECT] Обрабатываем chunk ${i + 1}/${chunks.length} (${chunk.length} операций)`);
      
      try {
        const chunkResults = await this.processChunk(chunk);
        results.push(...chunkResults);
        
        // Подсчет статистики
        chunkResults.forEach(result => {
          if (result.status === 'success') {
            stats.successful++;
          } else {
            stats.failed++;
          }
        });

        // Обновляем прогресс
        if (progressCallback) {
          progressCallback({
            processed: results.length,
            total: operations.length,
            currentChunk: i + 1,
            totalChunks: chunks.length
          });
        }

        // Задержка между chunks для избежания rate limits
        if (i < chunks.length - 1) {
          await this.delay(this.options.rateLimitDelay);
        }

      } catch (chunkError) {
        console.error(`[BATCH DIRECT] Ошибка обработки chunk ${i + 1}:`, chunkError.message);
        
        // Добавляем результаты с ошибками для всех операций в chunk
        const errorResults = chunk.map(op => ({
          pageId: op.pageId,
          status: 'error',
          error: chunkError.message,
          retries: 0
        }));
        
        results.push(...errorResults);
        stats.failed += chunk.length;
      }
    }

    stats.duration = Date.now() - startTime;
    
    console.log(`[BATCH DIRECT] Завершено. Успешно: ${stats.successful}/${stats.totalOperations}`);

    return {
      mode: 'direct_processing',
      results,
      stats,
      completed: true
    };
  }

  async processChunk(operations) {
    const results = [];
    const semaphore = new Array(this.options.concurrency).fill(null);
    
    const processOperation = async (operation) => {
      let retries = 0;
      
      while (retries <= this.options.maxRetries) {
        try {
          await this.notion.pages.update({
            page_id: operation.pageId,
            properties: operation.properties
          });
          
          return {
            pageId: operation.pageId,
            status: 'success',
            retries
          };
          
        } catch (error) {
          retries++;
          
          if (error.status === 429) {
            // Rate limit - увеличиваем задержку
            const retryAfter = error.headers?.['retry-after'] || 30;
            console.warn(`[OPERATION] Rate limit для ${operation.pageId}, ждем ${retryAfter}с`);
            await this.delay(retryAfter * 1000);
          } else if (retries <= this.options.maxRetries) {
            console.warn(`[OPERATION] Ошибка для ${operation.pageId}, попытка ${retries}:`, error.message);
            await this.delay(1000 * retries);
          }
          
          if (retries > this.options.maxRetries) {
            return {
              pageId: operation.pageId,
              status: 'error',
              error: error.message,
              retries: retries - 1
            };
          }
        }
      }
    };

    // Обрабатываем операции с учетом concurrency
    for (let i = 0; i < operations.length; i += this.options.concurrency) {
      const batch = operations.slice(i, i + this.options.concurrency);
      const batchPromises = batch.map(op => processOperation(op));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Задержка между батчами
      if (i + this.options.concurrency < operations.length) {
        await this.delay(this.options.rateLimitDelay / this.options.concurrency);
      }
    }
    
    return results;
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

// ИСПРАВЛЕНИЕ: Функция для добавления batch в KV очередь
export async function addBatchToKVQueue(operations, options = {}) {
  if (!isKVAvailable) {
    throw new Error('KV недоступно для создания очереди');
  }

  console.log(`[ADD BATCH] Добавляем ${operations.length} операций в KV очередь`);

  const processor = new NotionBatchProcessor(null, options);
  const result = await processor.processBatchWithKV(operations);
  
  return {
    batchId: result.batchId,
    jobIds: result.jobIds
  };
}

// ИСПРАВЛЕНИЕ: Функция для получения статуса batch из KV
export async function getKVBatchStatus(jobIds) {
  if (!isKVAvailable) {
    throw new Error('KV недоступно для получения статуса');
  }

  console.log(`[GET STATUS] Получаем статус для ${jobIds.length} задач`);

  const statuses = [];
  
  for (const jobId of jobIds) {
    try {
      const jobData = await KVUtils.get(`${KV_KEYS.JOB}${jobId}`);
      
      if (jobData) {
        statuses.push({
          jobId,
          status: jobData.status || 'unknown',
          progress: jobData.progress || 0,
          operations: jobData.operations?.length || 0,
          results: jobData.results || [],
          createdAt: jobData.createdAt,
          updatedAt: jobData.updatedAt
        });
      } else {
        statuses.push({
          jobId,
          status: 'not_found',
          progress: 0,
          operations: 0,
          results: []
        });
      }
    } catch (error) {
      console.error(`[GET STATUS] Ошибка получения статуса для ${jobId}:`, error.message);
      statuses.push({
        jobId,
        status: 'error',
        error: error.message,
        progress: 0,
        operations: 0,
        results: []
      });
    }
  }
  
  return statuses;
}