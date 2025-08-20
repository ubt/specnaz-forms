// lib/kv-queue.js - НАДЕЖНАЯ версия для Cloudflare Pages с существующим binding

// Глобальные переменные для KV
let KV_NAMESPACE = null;
let isKVAvailable = false;
let kvInitialized = false;
let lastContext = null;
let initAttempts = 0;

// НАДЕЖНАЯ инициализация KV для Cloudflare Pages
export function initKV(context = null) {
  initAttempts++;
  console.log(`[KV INIT] 🔄 Попытка инициализации #${initAttempts}...`);
  
  // Сохраняем context для использования в других функциях
  if (context) {
    lastContext = context;
    console.log(`[KV INIT] 📦 Context получен:`, {
      hasContext: !!context,
      hasEnv: !!context.env,
      hasCloudflare: !!context.cloudflare,
      hasWaitUntil: !!context.waitUntil,
      envKeys: context.env ? Object.keys(context.env) : [],
      allKeys: Object.keys(context)
    });
  }
  
  const currentContext = context || lastContext;
  
  try {
    // СПОСОБ 1: Главный способ для Cloudflare Pages - через context.env
    if (currentContext?.env?.NOTION_QUEUE_KV) {
      KV_NAMESPACE = currentContext.env.NOTION_QUEUE_KV;
      console.log('[KV INIT] ✅ KV найден через context.env.NOTION_QUEUE_KV (основной способ для Pages)');
    }
    // СПОСОБ 2: Альтернативный доступ через context
    else if (currentContext?.NOTION_QUEUE_KV) {
      KV_NAMESPACE = currentContext.NOTION_QUEUE_KV;
      console.log('[KV INIT] ✅ KV найден через context.NOTION_QUEUE_KV');
    }
    // СПОСОБ 3: Проверяем bindings (если есть)
    else if (currentContext?.bindings?.NOTION_QUEUE_KV) {
      KV_NAMESPACE = currentContext.bindings.NOTION_QUEUE_KV;
      console.log('[KV INIT] ✅ KV найден через context.bindings.NOTION_QUEUE_KV');
    }
    // СПОСОБ 4: Глобальная переменная (для Workers)
    else if (typeof NOTION_QUEUE_KV !== 'undefined' && NOTION_QUEUE_KV) {
      KV_NAMESPACE = NOTION_QUEUE_KV;
      console.log('[KV INIT] ✅ KV найден через глобальную переменную NOTION_QUEUE_KV');
    }
    // СПОСОБ 5: Через globalThis
    else if (typeof globalThis !== 'undefined' && globalThis.NOTION_QUEUE_KV) {
      KV_NAMESPACE = globalThis.NOTION_QUEUE_KV;
      console.log('[KV INIT] ✅ KV найден через globalThis.NOTION_QUEUE_KV');
    }
    // СПОСОБ 6: Проверяем другие варианты названий
    else if (currentContext?.env && Object.keys(currentContext.env).some(key => key.includes('NOTION') && key.includes('KV'))) {
      const kvKey = Object.keys(currentContext.env).find(key => key.includes('NOTION') && key.includes('KV'));
      if (kvKey) {
        KV_NAMESPACE = currentContext.env[kvKey];
        console.log(`[KV INIT] ✅ KV найден через context.env.${kvKey}`);
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
    envHasKV: !!currentContext?.env?.NOTION_QUEUE_KV,
    globalKVExists: typeof NOTION_QUEUE_KV !== 'undefined',
    namespaceType: KV_NAMESPACE ? typeof KV_NAMESPACE : 'undefined',
    namespaceConstructor: KV_NAMESPACE ? KV_NAMESPACE.constructor?.name : 'none'
  });

  if (isKVAvailable) {
    console.log('[KV INIT] ✅ Cloudflare KV подключено успешно');
    
    // Тестируем KV доступность асинхронно
    testKVAccess().catch(error => {
      console.error('[KV INIT] ❌ Тест KV неудачен:', error.message);
      isKVAvailable = false;
      KV_NAMESPACE = null;
    });
  } else {
    console.warn('[KV INIT] ⚠️ Cloudflare KV недоступно после попытки #' + initAttempts);
    console.warn('📋 Диагностика:');
    if (!currentContext) {
      console.warn('  - Context не предоставлен');
    } else if (!currentContext.env) {
      console.warn('  - Context.env отсутствует');
    } else if (!currentContext.env.NOTION_QUEUE_KV) {
      console.warn('  - NOTION_QUEUE_KV отсутствует в context.env');
      console.warn('  - Доступные env переменные:', Object.keys(currentContext.env));
    }
    console.warn('📋 Проверьте:');
    console.warn('  1. KV binding настроен в Cloudflare Dashboard');
    console.warn('  2. Приложение переразвернуто после настройки binding');
    console.warn('  3. KV namespace существует и доступен');
  }
  
  return isKVAvailable;
}

// Расширенное тестирование доступности KV
async function testKVAccess() {
  if (!KV_NAMESPACE) {
    console.error('[KV TEST] ❌ KV_NAMESPACE is null');
    return false;
  }
  
  console.log('[KV TEST] 🧪 Начинаем тестирование KV...');
  console.log('[KV TEST] 📊 KV объект:', {
    type: typeof KV_NAMESPACE,
    constructor: KV_NAMESPACE.constructor?.name,
    hasPut: typeof KV_NAMESPACE.put === 'function',
    hasGet: typeof KV_NAMESPACE.get === 'function',
    hasDelete: typeof KV_NAMESPACE.delete === 'function'
  });
  
  try {
    const testKey = 'kv_test_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const testValue = 'test_connectivity_' + Date.now();
    
    console.log(`[KV TEST] ✍️ Тестируем PUT операцию с ключом: ${testKey}`);
    // Проверяем базовые операции KV
    await KV_NAMESPACE.put(testKey, testValue, { expirationTtl: 60 });
    console.log('[KV TEST] ✅ PUT операция успешна');
    
    console.log(`[KV TEST] 📖 Тестируем GET операцию...`);
    const retrievedValue = await KV_NAMESPACE.get(testKey);
    console.log(`[KV TEST] 📖 Получено значение: ${retrievedValue}`);
    
    console.log(`[KV TEST] 🗑️ Тестируем DELETE операцию...`);
    await KV_NAMESPACE.delete(testKey);
    console.log('[KV TEST] ✅ DELETE операция успешна');
    
    const isWorking = retrievedValue === testValue;
    console.log(`[KV TEST] ${isWorking ? '✅' : '❌'} Финальный результат: ${isWorking ? 'УСПЕХ' : 'НЕУДАЧА'}`);
    
    if (!isWorking) {
      console.error(`[KV TEST] ❌ Ожидалось: "${testValue}", получено: "${retrievedValue}"`);
      throw new Error('KV операции не работают корректно - данные не совпадают');
    }
    
    return true;
  } catch (error) {
    console.error('[KV TEST] ❌ KV тест неудачен:', {
      message: error.message,
      stack: error.stack,
      kvNamespace: !!KV_NAMESPACE,
      kvType: typeof KV_NAMESPACE
    });
    isKVAvailable = false;
    KV_NAMESPACE = null;
    return false;
  }
}

// Умная проверка статуса KV с автоматической переинициализацией
export function isKVConnected() {
  // Если KV недоступно, но есть context - пробуем переинициализировать
  if (!isKVAvailable && lastContext) {
    console.log('[KV CHECK] 🔄 Автоматическая переинициализация KV...');
    initKV(lastContext);
  }
  
  // Дополнительная проверка глобальных переменных
  if (!isKVAvailable && typeof NOTION_QUEUE_KV !== 'undefined') {
    console.log('[KV CHECK] 🔄 Обнаружена глобальная переменная, переинициализация...');
    initKV();
  }
  
  const result = isKVAvailable && !!KV_NAMESPACE;
  console.log(`[KV CHECK] 📊 Статус KV: ${result ? '✅ подключено' : '❌ недоступно'}`);
  return result;
}

// Принудительное отключение KV (для отладки)
export function disableKV() {
  console.log('[KV DISABLE] ⛔ Принудительно отключаем KV');
  isKVAvailable = false;
  KV_NAMESPACE = null;
}

// Получение информации о состоянии KV для диагностики
export function getKVDiagnostics() {
  return {
    isKVAvailable,
    hasNamespace: !!KV_NAMESPACE,
    kvInitialized,
    initAttempts,
    hasLastContext: !!lastContext,
    lastContextKeys: lastContext ? Object.keys(lastContext) : [],
    lastContextEnvKeys: lastContext?.env ? Object.keys(lastContext.env) : [],
    namespaceType: KV_NAMESPACE ? typeof KV_NAMESPACE : 'undefined',
    namespaceConstructor: KV_NAMESPACE ? KV_NAMESPACE.constructor?.name : 'none'
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

// Остальные классы и функции остаются такими же...
// (NotionBatchProcessor, addBatchToKVQueue, getKVBatchStatus)

export { KVUtils, CONFIG, KV_KEYS };