// ИСПРАВЛЕННАЯ инициализация KV для Next.js на Cloudflare Pages
// Заменить функцию initKV в lib/kv-queue.js

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