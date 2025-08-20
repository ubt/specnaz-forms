// lib/kv-queue.js - ПОЛНАЯ исправленная версия для Next.js на Cloudflare Pages

// Глобальные переменные для KV
let KV_NAMESPACE = null;
let isKVAvailable = false;
let kvInitialized = false;
let lastContext = null;
let initAttempts = 0;

// ИСПРАВЛЕННАЯ инициализация KV для Next.js на Cloudflare Pages
export function initKV(context = null) {
  initAttempts++;
  console.log(`[KV INIT] 🔄 Попытка инициализации #${initAttempts} для Next.js на Cloudflare Pages...`);
  
  // Сохраняем context для использования в других функциях
  if (context) {
    lastContext = context;
    console.log(`[KV INIT] 📦 Context получен:`, {
      hasContext: !!context,
      hasEnv: !!context.env,
      contextKeys: Object.keys(context),
      contextType: typeof context
    });
  }
  
  const currentContext = context || lastContext;
  
  // Сброс предыдущего состояния
  KV_NAMESPACE = null;
  isKVAvailable = false;
  
  try {
    // СПОСОБ 1: Next.js на Cloudflare Pages - проверяем глобальные bindings
    if (typeof NOTION_QUEUE_KV !== 'undefined' && NOTION_QUEUE_KV) {
      KV_NAMESPACE = NOTION_QUEUE_KV;
      console.log('[KV INIT] ✅ KV найден через глобальную переменную NOTION_QUEUE_KV (Next.js на CF Pages)');
      console.log('[KV INIT] 📊 KV объект:', {
        type: typeof KV_NAMESPACE,
        constructor: KV_NAMESPACE.constructor?.name,
        hasPut: typeof KV_NAMESPACE.put === 'function',
        hasGet: typeof KV_NAMESPACE.get === 'function',
        hasDelete: typeof KV_NAMESPACE.delete === 'function'
      });
    }
    // СПОСОБ 2: Через globalThis (альтернативный доступ)
    else if (typeof globalThis !== 'undefined' && globalThis.NOTION_QUEUE_KV) {
      KV_NAMESPACE = globalThis.NOTION_QUEUE_KV;
      console.log('[KV INIT] ✅ KV найден через globalThis.NOTION_QUEUE_KV');
    }
    // СПОСОБ 3: Через process.env для Next.js (если binding попадает туда)
    else if (typeof process !== 'undefined' && process.env && process.env.NOTION_QUEUE_KV) {
      // В Next.js на CF Pages bindings могут попадать в process.env
      const envValue = process.env.NOTION_QUEUE_KV;
      if (envValue && typeof envValue === 'object' && typeof envValue.get === 'function') {
        KV_NAMESPACE = envValue;
        console.log('[KV INIT] ✅ KV найден через process.env.NOTION_QUEUE_KV (Next.js специфично)');
      }
    }
    // СПОСОБ 4: Стандартный context.env (для совместимости)
    else if (currentContext?.env?.NOTION_QUEUE_KV) {
      KV_NAMESPACE = currentContext.env.NOTION_QUEUE_KV;
      console.log('[KV INIT] ✅ KV найден через context.env.NOTION_QUEUE_KV');
    }
    // СПОСОБ 5: Альтернативные пути в context
    else if (currentContext?.NOTION_QUEUE_KV) {
      KV_NAMESPACE = currentContext.NOTION_QUEUE_KV;
      console.log('[KV INIT] ✅ KV найден через context.NOTION_QUEUE_KV');
    }
    // СПОСОБ 6: Проверяем bindings в context
    else if (currentContext?.bindings?.NOTION_QUEUE_KV) {
      KV_NAMESPACE = currentContext.bindings.NOTION_QUEUE_KV;
      console.log('[KV INIT] ✅ KV найден через context.bindings.NOTION_QUEUE_KV');
    }
    // СПОСОБ 7: Поиск среди всех глобальных переменных
    else if (typeof window === 'undefined') { // Только на сервере
      // Проверяем все возможные глобальные переменные с KV в названии
      const globalVars = ['NOTION_QUEUE_KV', 'NotionQueueKV', 'notionQueueKV'];
      for (const varName of globalVars) {
        if (typeof global !== 'undefined' && global[varName]) {
          KV_NAMESPACE = global[varName];
          console.log(`[KV INIT] ✅ KV найден через global.${varName}`);
          break;
        }
      }
    }
    
  } catch (error) {
    console.warn('[KV INIT] ⚠️ Ошибка при поиске KV namespace:', error.message);
  }
  
  const prevStatus = isKVAvailable;
  isKVAvailable = Boolean(KV_NAMESPACE);
  kvInitialized = true;

  console.log(`[KV INIT] 📊 Результат попытки #${initAttempts}:`, {
    kvAvailable: isKVAvailable,
    hadNamespace: !!KV_NAMESPACE,
    statusChanged: prevStatus !== isKVAvailable,
    contextProvided: !!currentContext,
    hasEnv: !!currentContext?.env,
    globalKVExists: typeof NOTION_QUEUE_KV !== 'undefined',
    processEnvKV: !!(process?.env?.NOTION_QUEUE_KV),
    namespaceType: KV_NAMESPACE ? typeof KV_NAMESPACE : 'undefined',
    namespaceConstructor: KV_NAMESPACE ? KV_NAMESPACE.constructor?.name : 'none'
  });

  if (isKVAvailable) {
    console.log('[KV INIT] ✅ Cloudflare KV подключено успешно');
    
    // Быстрый тест доступности KV (без ожидания)
    testKVAccessQuickly().catch(error => {
      console.error('[KV INIT] ❌ Быстрый тест KV неудачен:', error.message);
      isKVAvailable = false;
      KV_NAMESPACE = null;
    });
  } else {
    console.warn('[KV INIT] ⚠️ Cloudflare KV недоступно после попытки #' + initAttempts);
    logKVDiagnosticsForNextJS(currentContext);
  }
  
  return isKVAvailable;
}

// УЛУЧШЕННАЯ проверка статуса KV
export function isKVConnected() {
  // Сначала проверяем базовое состояние
  if (!isKVAvailable || !KV_NAMESPACE) {
    // Если KV недоступно, но есть context - пробуем переинициализировать один раз
    if (!isKVAvailable && lastContext && initAttempts < 3) {
      console.log('[KV CHECK] 🔄 Автоматическая переинициализация KV...');
      const reinitResult = initKV(lastContext);
      if (reinitResult) {
        console.log('[KV CHECK] ✅ Переинициализация успешна');
        return true;
      }
    }
    
    // Дополнительная проверка глобальных переменных
    if (!isKVAvailable && typeof NOTION_QUEUE_KV !== 'undefined') {
      console.log('[KV CHECK] 🔄 Обнаружена глобальная переменная, переинициализация...');
      const globalResult = initKV();
      if (globalResult) {
        console.log('[KV CHECK] ✅ Глобальная переинициализация успешна');
        return true;
      }
    }
    
    console.log(`[KV CHECK] ❌ KV недоступно после ${initAttempts} попыток инициализации`);
    return false;
  }
  
  // Дополнительная проверка что KV объект имеет необходимые методы
  const hasRequiredMethods = KV_NAMESPACE && 
    typeof KV_NAMESPACE.get === 'function' &&
    typeof KV_NAMESPACE.put === 'function' &&
    typeof KV_NAMESPACE.delete === 'function';
  
  if (!hasRequiredMethods) {
    console.error('[KV CHECK] ❌ KV объект не имеет необходимых методов');
    isKVAvailable = false;
    return false;
  }
  
  const result = isKVAvailable && !!KV_NAMESPACE;
  console.log(`[KV CHECK] 📊 Статус KV: ${result ? '✅ подключено' : '❌ недоступно'}`);
  return result;
}

// Быстрый тест KV без блокировки инициализации
async function testKVAccessQuickly() {
  if (!KV_NAMESPACE) {
    throw new Error('KV_NAMESPACE is null');
  }
  
  try {
    const testKey = 'quick_test_' + Date.now();
    const testValue = 'test_connectivity';
    
    // Быстрый тест с таймаутом
    await Promise.race([
      KV_NAMESPACE.put(testKey, testValue, { expirationTtl: 30 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
    ]);
    
    const retrievedValue = await Promise.race([
      KV_NAMESPACE.get(testKey),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
    ]);
    
    await KV_NAMESPACE.delete(testKey).catch(() => {}); // Игнорируем ошибки очистки
    
    const isWorking = retrievedValue === testValue;
    console.log(`[KV TEST] ⚡ Быстрый тест: ${isWorking ? 'УСПЕХ' : 'НЕУДАЧА'}`);
    
    if (!isWorking) {
      throw new Error('KV операции не работают корректно');
    }
    
    return true;
  } catch (error) {
    console.error('[KV TEST] ❌ Быстрый тест неудачен:', error.message);
    throw error;
  }
}

// Специальная диагностика для Next.js на Cloudflare Pages
function logKVDiagnosticsForNextJS(currentContext) {
  console.warn('📋 ДИАГНОСТИКА KV для Next.js на Cloudflare Pages:');
  
  console.warn('🔍 Проверка глобальных переменных:');
  console.warn('  - typeof NOTION_QUEUE_KV:', typeof NOTION_QUEUE_KV);
  console.warn('  - globalThis.NOTION_QUEUE_KV:', !!globalThis.NOTION_QUEUE_KV);
  console.warn('  - process.env.NOTION_QUEUE_KV тип:', typeof process?.env?.NOTION_QUEUE_KV);
  
  if (currentContext) {
    console.warn('🔍 Анализ context:');
    console.warn('  - context.env:', !!currentContext.env);
    console.warn('  - context ключи:', Object.keys(currentContext));
    if (currentContext.env) {
      console.warn('  - context.env ключи:', Object.keys(currentContext.env));
    }
  } else {
    console.warn('  ❌ Context не предоставлен');
  }
  
  console.warn('📋 СПЕЦИФИЧНЫЙ ЧЕКЛИСТ для Next.js на Cloudflare Pages:');
  console.warn('  1. ✅ KV binding настроен в Pages Dashboard (у вас настроен)');
  console.warn('  2. 🔄 Переразверните через: npm run cf:deploy');
  console.warn('  3. ⏳ Подождите 5 минут после развертывания');
  console.warn('  4. 🔍 Проверьте что @cloudflare/next-on-pages актуальной версии');
  console.warn('  5. 📝 Убедитесь что в next.config.mjs нет конфликтующих настроек');
}

// Принудительная переинициализация KV
export function reinitializeKV(context) {
  console.log('[KV REINIT] 🔄 Принудительная переинициализация KV');
  
  // Сброс состояния
  KV_NAMESPACE = null;
  isKVAvailable = false;
  kvInitialized = false;
  initAttempts = 0;
  
  // Новая инициализация
  return initKV(context);
}

// Принудительное отключение KV (для отладки)
export function disableKV() {
  console.log('[KV DISABLE] ⛔ Принудительно отключаем KV');
  isKVAvailable = false;
  KV_NAMESPACE = null;
}

// Получение расширенной информации о состоянии KV для диагностики
export function getKVDiagnostics() {
  return {
    isKVAvailable,
    hasNamespace: !!KV_NAMESPACE,
    kvInitialized,
    initAttempts,
    hasLastContext: !!lastContext,
    lastContextKeys: lastContext ? Object.keys(lastContext) : [],
    lastContextEnvKeys: lastContext?.env ? Object.keys(lastContext.env).filter(key => 
      key.includes('KV') || key.includes('NOTION')
    ) : [],
    namespaceType: KV_NAMESPACE ? typeof KV_NAMESPACE : 'undefined',
    namespaceConstructor: KV_NAMESPACE ? KV_NAMESPACE.constructor?.name : 'none',
    hasMethods: KV_NAMESPACE ? {
      get: typeof KV_NAMESPACE.get === 'function',
      put: typeof KV_NAMESPACE.put === 'function',
      delete: typeof KV_NAMESPACE.delete === 'function',
      list: typeof KV_NAMESPACE.list === 'function'
    } : {},
    globalKVAvailable: typeof NOTION_QUEUE_KV !== 'undefined',
    timestamp: new Date().toISOString()
  };
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

// Надежные утилиты для работы с KV
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
      console.log(`[KV PUT] ✍️ Записываем ключ: ${key} (${serializedValue.length} символов)`);
      const result = await this.withTimeout(() => 
        KV_NAMESPACE.put(key, serializedValue, { expirationTtl: ttl })
      );
      console.log(`[KV PUT] ✅ Успешно записан ключ: ${key}`);
      return result;
    } catch (error) {
      console.error(`[KV PUT] ❌ Ошибка записи ключа ${key}:`, error.message);
      throw new Error(`KV PUT failed: ${error.message}`);
    }
  }

  static async get(key, parseJSON = true) {
    if (!isKVAvailable || !KV_NAMESPACE) {
      throw new Error('Cloudflare KV недоступно для чтения');
    }
    
    try {
      console.log(`[KV GET] 📖 Читаем ключ: ${key}`);
      const value = await this.withTimeout(() => KV_NAMESPACE.get(key));
      
      if (value === null) {
        console.log(`[KV GET] ℹ️ Ключ не найден: ${key}`);
        return null;
      }
      
      console.log(`[KV GET] ✅ Получено ${value.length} символов для ключа: ${key}`);
      
      if (!parseJSON) {
        return value;
      }
      
      try {
        return JSON.parse(value);
      } catch (parseError) {
        console.warn(`[KV GET] ⚠️ Не удалось парсить JSON для ключа ${key}, возвращаем строку`);
        return value;
      }
    } catch (error) {
      console.error(`[KV GET] ❌ Ошибка чтения ключа ${key}:`, error.message);
      throw new Error(`KV GET failed: ${error.message}`);
    }
  }

  static async delete(key) {
    if (!isKVAvailable || !KV_NAMESPACE) {
      throw new Error('Cloudflare KV недоступно для удаления');
    }
    
    try {
      console.log(`[KV DELETE] 🗑️ Удаляем ключ: ${key}`);
      const result = await this.withTimeout(() => KV_NAMESPACE.delete(key));
      console.log(`[KV DELETE] ✅ Успешно удален ключ: ${key}`);
      return result;
    } catch (error) {
      console.error(`[KV DELETE] ❌ Ошибка удаления ключа ${key}:`, error.message);
      throw new Error(`KV DELETE failed: ${error.message}`);
    }
  }

  static async list(prefix = '', limit = 100) {
    if (!isKVAvailable || !KV_NAMESPACE) {
      throw new Error('Cloudflare KV недоступно для листинга');
    }
    
    try {
      console.log(`[KV LIST] 📋 Листинг с префиксом: ${prefix}, лимит: ${limit}`);
      const result = await this.withTimeout(() => 
        KV_NAMESPACE.list({ prefix, limit })
      );
      console.log(`[KV LIST] ✅ Найдено ${result.keys?.length || 0} ключей`);
      return result;
    } catch (error) {
      console.error(`[KV LIST] ❌ Ошибка листинга с префиксом ${prefix}:`, error.message);
      throw new Error(`KV LIST failed: ${error.message}`);
    }
  }
}

// Основной класс для batch обработки операций
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
    
    console.log(`[BATCH PROCESSOR] 🚀 Инициализация:`, {
      useKV: this.options.useKV,
      kvAvailable: isKVAvailable,
      batchSize: this.options.batchSize,
      concurrency: this.options.concurrency,
      rateLimitDelay: this.options.rateLimitDelay
    });
  }

  async processBatch(operations, progressCallback = null) {
    console.log(`[BATCH] 🔄 Начинаем обработку ${operations.length} операций`);
    
    // Автоматический выбор режима на основе размера и доступности KV
    if (this.options.useKV && operations.length > 10) {
      try {
        return await this.processBatchWithKV(operations, progressCallback);
      } catch (kvError) {
        console.error('[BATCH] ❌ KV обработка неудачна, переключаемся на прямую:', kvError.message);
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
      console.log('[BATCH KV] 📦 Используем Cloudflare KV для обработки');
      
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

      console.log(`[BATCH KV] ✅ Создано ${jobIds.length} задач для ${operations.length} операций`);

      return {
        mode: 'kv_queue',
        batchId,
        jobIds,
        totalOperations: operations.length,
        totalJobs: chunks.length,
        estimatedDuration: Math.ceil(operations.length * 3)
      };

    } catch (error) {
      console.error('[BATCH KV] ❌ Ошибка KV обработки:', error.message);
      throw error;
    }
  }

  async processBatchDirectly(operations, progressCallback) {
    console.log('[BATCH DIRECT] 🚀 Используем прямую обработку');
    
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
      console.log(`[BATCH DIRECT] 📦 Обрабатываем chunk ${i + 1}/${chunks.length} (${chunk.length} операций)`);
      
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
        console.error(`[BATCH DIRECT] ❌ Ошибка обработки chunk ${i + 1}:`, chunkError.message);
        
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
    
    console.log(`[BATCH DIRECT] ✅ Завершено. Успешно: ${stats.successful}/${stats.totalOperations}`);

    return {
      mode: 'direct_processing',
      results,
      stats,
      completed: true
    };
  }

  async processChunk(operations) {
    const results = [];
    
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
            console.warn(`[OPERATION] ⏱️ Rate limit для ${operation.pageId}, ждем ${retryAfter}с`);
            await this.delay(retryAfter * 1000);
          } else if (retries <= this.options.maxRetries) {
            console.warn(`[OPERATION] ⚠️ Ошибка для ${operation.pageId}, попытка ${retries}:`, error.message);
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

// Функция для добавления batch в KV очередь
export async function addBatchToKVQueue(operations, options = {}) {
  if (!isKVAvailable) {
    throw new Error('KV недоступно для создания очереди');
  }

  console.log(`[ADD BATCH] 📦 Добавляем ${operations.length} операций в KV очередь`);

  const processor = new NotionBatchProcessor(null, options);
  const result = await processor.processBatchWithKV(operations);
  
  return {
    batchId: result.batchId,
    jobIds: result.jobIds
  };
}

// Функция для получения статуса batch из KV
export async function getKVBatchStatus(jobIds) {
  if (!isKVAvailable) {
    throw new Error('KV недоступно для получения статуса');
  }

  console.log(`[GET STATUS] 📊 Получаем статус для ${jobIds.length} задач`);

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
      console.error(`[GET STATUS] ❌ Ошибка получения статуса для ${jobId}:`, error.message);
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

// Функция для получения результатов batch из KV
export async function getKVBatchResults(jobIds) {
  if (!isKVAvailable) {
    throw new Error('KV недоступно для получения результатов');
  }

  console.log(`[GET RESULTS] 📊 Получаем результаты для ${jobIds.length} задач`);

  const allResults = [];
  
  for (const jobId of jobIds) {
    try {
      const jobData = await KVUtils.get(`${KV_KEYS.JOB}${jobId}`);
      
      if (jobData && jobData.results) {
        allResults.push(...jobData.results);
      }
    } catch (error) {
      console.error(`[GET RESULTS] ❌ Ошибка получения результатов для ${jobId}:`, error.message);
    }
  }
  
  return allResults;
}

export { KVUtils, CONFIG, KV_KEYS };