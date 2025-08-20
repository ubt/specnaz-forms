// app/api/kv/diagnostics/route.js - ОБНОВЛЕННАЯ диагностика для выявления проблем
export const runtime = "edge";

import { NextResponse } from "next/server";
import { initKV, isKVConnected, getKVDiagnostics } from "@/lib/kv-queue";

export async function GET(req, context) {
  console.log('[KV DIAGNOSTICS] 🔍 УГЛУБЛЕННАЯ диагностика Cloudflare KV для Pages');
  
  const diagnostics = {
    timestamp: new Date().toISOString(),
    runtime: "edge",
    platform: "Cloudflare Pages",
    url: req.url
  };

  // 1. ДЕТАЛЬНАЯ проверка context
  diagnostics.context = {
    provided: !!context,
    type: typeof context,
    isNull: context === null,
    isUndefined: context === undefined,
    
    // Проверяем все возможные свойства context
    hasEnv: !!context?.env,
    hasBindings: !!context?.bindings,
    hasCloudflare: !!context?.cloudflare,
    hasWaitUntil: !!context?.waitUntil,
    hasParams: !!context?.params,
    
    // Ключи объектов
    contextKeys: context ? Object.keys(context) : [],
    envKeys: context?.env ? Object.keys(context.env) : [],
    bindingsKeys: context?.bindings ? Object.keys(context.bindings) : [],
    
    // СПЕЦИФИЧНАЯ проверка KV в context
    contextEnvKV: !!context?.env?.NOTION_QUEUE_KV,
    contextEnvKVType: context?.env?.NOTION_QUEUE_KV ? typeof context.env.NOTION_QUEUE_KV : 'undefined',
    contextBindingsKV: !!context?.bindings?.NOTION_QUEUE_KV,
    contextDirectKV: !!context?.NOTION_QUEUE_KV,
    
    // Проверяем альтернативные названия KV в env
    envKVVariations: context?.env ? Object.keys(context.env).filter(key => 
      key.includes('KV') || key.includes('NOTION') || key.includes('QUEUE')
    ) : [],
    
    // Сериализация context для анализа (обрезанная)
    contextSample: context ? {
      keys: Object.keys(context),
      envSample: context.env ? Object.keys(context.env).slice(0, 10) : null,
      hasEnvNotionKV: !!context.env?.NOTION_QUEUE_KV
    } : null
  };

  // 2. Проверка глобальных переменных
  diagnostics.globalVariables = {
    NOTION_QUEUE_KV_exists: typeof NOTION_QUEUE_KV !== 'undefined',
    NOTION_QUEUE_KV_truthy: typeof NOTION_QUEUE_KV !== 'undefined' && !!NOTION_QUEUE_KV,
    NOTION_QUEUE_KV_type: typeof NOTION_QUEUE_KV !== 'undefined' ? typeof NOTION_QUEUE_KV : 'undefined',
    globalThis_exists: typeof globalThis !== 'undefined',
    globalThis_NOTION_QUEUE_KV: typeof globalThis !== 'undefined' && !!globalThis.NOTION_QUEUE_KV
  };

  // 3. Проверка переменных окружения
  diagnostics.environment = {
    NODE_ENV: process.env.NODE_ENV || 'unknown',
    hasNotionToken: !!process.env.NOTION_TOKEN,
    hasJWTSecret: !!process.env.JWT_SECRET,
    hasMatrixDbId: !!process.env.MATRIX_DB_ID,
    processEnvKeys: Object.keys(process.env).filter(key => 
      key.includes('NOTION') || key.includes('KV') || key.includes('JWT')
    )
  };

  // 4. МНОЖЕСТВЕННЫЕ попытки инициализации KV с детальным логированием
  console.log('[KV DIAGNOSTICS] 🔧 Попытка инициализации KV БЕЗ context...');
  const kvInitWithoutContext = initKV();
  
  console.log('[KV DIAGNOSTICS] 🔧 Попытка инициализации KV С context...');
  const kvInitWithContext = initKV(context);
  
  // Получаем детальную диагностику из KV модуля
  const kvDiagnostics = getKVDiagnostics();
  
  diagnostics.kvInitialization = {
    withoutContext: {
      success: kvInitWithoutContext,
      connected: isKVConnected()
    },
    withContext: {
      success: kvInitWithContext,
      connected: isKVConnected()
    },
    details: kvDiagnostics,
    finalStatus: {
      connected: isKVConnected(),
      hasNamespace: kvDiagnostics.hasNamespace,
      initAttempts: kvDiagnostics.initAttempts
    }
  };

  // 5. Тестирование KV операций (если доступно)
  if (isKVConnected()) {
    console.log('[KV DIAGNOSTICS] 🧪 KV доступно, проводим тестирование...');
    try {
      const testKey = `diagnostic_test_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const testValue = JSON.stringify({
        test: 'diagnostic_value', 
        timestamp: Date.now(),
        random: Math.random()
      });
      
      console.log(`[KV DIAGNOSTICS] ✍️ Тестируем PUT: ${testKey}`);
      
      // Тест записи
      await context?.env?.NOTION_QUEUE_KV?.put(testKey, testValue, { expirationTtl: 60 }) ||
            NOTION_QUEUE_KV?.put(testKey, testValue, { expirationTtl: 60 });
      
      console.log(`[KV DIAGNOSTICS] 📖 Тестируем GET: ${testKey}`);
      
      // Тест чтения
      const retrievedValue = await context?.env?.NOTION_QUEUE_KV?.get(testKey) ||
                            NOTION_QUEUE_KV?.get(testKey);
      
      console.log(`[KV DIAGNOSTICS] 🗑️ Тестируем DELETE: ${testKey}`);
      
      // Тест удаления
      await context?.env?.NOTION_QUEUE_KV?.delete(testKey) ||
            NOTION_QUEUE_KV?.delete(testKey);
      
      const testSuccess = retrievedValue === testValue;
      
      diagnostics.kvOperations = {
        put: true,
        get: testSuccess,
        delete: true,
        overall: testSuccess,
        testKey: testKey,
        expectedValue: testValue,
        retrievedValue: retrievedValue,
        valuesMatch: retrievedValue === testValue
      };
      
    } catch (kvError) {
      console.error('[KV DIAGNOSTICS] ❌ Ошибка KV операций:', kvError);
      diagnostics.kvOperations = {
        put: false,
        get: false,
        delete: false,
        overall: false,
        error: kvError.message,
        stack: kvError.stack
      };
    }
  } else {
    diagnostics.kvOperations = {
      put: false,
      get: false,
      delete: false,
      overall: false,
      reason: 'KV не подключен или недоступен',
      kvConnected: isKVConnected(),
      kvDiagnostics: kvDiagnostics
    };
  }

  // 6. ДЕТАЛЬНЫЙ анализ проблем для Pages
  const issues = [];
  const recommendations = [];

  // Анализ по приоритету проблем
  if (!diagnostics.context.provided) {
    issues.push('🚨 КРИТИЧНО: Context не предоставлен в API route');
    recommendations.push('❗ Убедитесь что context передается во все API endpoints');
    recommendations.push('📝 Пример: export async function GET(req, context) { ... }');
  } else if (!diagnostics.context.hasEnv) {
    issues.push('🚨 КРИТИЧНО: Context предоставлен, но не содержит env объект');
    recommendations.push('❗ Проверьте что context.env доступен');
    recommendations.push('🔍 Context должен содержать: { env: { NOTION_QUEUE_KV: ... } }');
  } else if (!diagnostics.context.contextEnvKV) {
    issues.push('🚨 КРИТИЧНО: NOTION_QUEUE_KV отсутствует в context.env');
    recommendations.push('❗ Проверьте настройки KV binding в Cloudflare Pages Dashboard');
    recommendations.push('🔧 Pages → Settings → Functions → KV namespace bindings');
    recommendations.push('📝 Variable name должно быть: NOTION_QUEUE_KV');
    recommendations.push('🔄 После изменений ОБЯЗАТЕЛЬНО переразверните: npm run cf:deploy');
  } else if (!diagnostics.kvInitialization.withContext.success) {
    issues.push('⚠️ KV найден в context, но инициализация неудачна');
    recommendations.push('🔄 Переразверните приложение: npm run cf:deploy');
    recommendations.push('🔍 Проверьте логи развертывания на наличие ошибок');
  } else if (!diagnostics.kvOperations.overall) {
    issues.push('⚠️ KV инициализирован, но операции не работают');
    recommendations.push('📊 Проверьте статус KV namespace в Cloudflare Dashboard');
    recommendations.push('🔧 Убедитесь что KV namespace не был удален или поврежден');
    recommendations.push('💾 Попробуйте создать новый KV namespace');
  }

  // Дополнительные проверки
  if (diagnostics.context.envKVVariations.length > 0 && !diagnostics.context.contextEnvKV) {
    issues.push(`🔍 В context.env найдены KV-подобные переменные: ${diagnostics.context.envKVVariations.join(', ')}`);
    recommendations.push('🔧 Проверьте правильность названия KV binding (должно быть NOTION_QUEUE_KV)');
  }

  if (diagnostics.kvInitialization.details.initAttempts > 3) {
    issues.push(`⚠️ Слишком много попыток инициализации: ${diagnostics.kvInitialization.details.initAttempts}`);
    recommendations.push('🔄 Очистите кэш и переразверните приложение');
  }

  if (issues.length === 0) {
    issues.push('✅ Проблем не найдено');
    recommendations.push('🎉 Cloudflare KV настроен и работает корректно');
  }

  diagnostics.analysis = {
    issues,
    recommendations,
    status: issues.length === 1 && issues[0] === '✅ Проблем не найдено' ? 'healthy' : 'issues_found',
    priority: issues.length > 0 && issues[0].includes('КРИТИЧНО') ? 'critical' : 'normal'
  };

  // 7. Специфичное руководство для этой ситуации
  diagnostics.troubleshooting = {
    currentSituation: "KV binding настроен в Dashboard, но код не может получить доступ",
    mostLikelyIssue: !diagnostics.context.provided ? "Context не передается" :
                     !diagnostics.context.hasEnv ? "Context.env недоступен" :
                     !diagnostics.context.contextEnvKV ? "Нужно переразвернуть приложение" :
                     "Проблема с KV namespace",
    
    immediateActions: [
      "1. 🔄 Переразверните приложение: npm run cf:deploy",
      "2. ⏳ Подождите 2-3 минуты после развертывания", 
      "3. 🔍 Обновите эту страницу диагностики",
      "4. 📋 Если не помогло - проверьте логи развертывания"
    ],
    
    verificationSteps: [
      "✅ KV binding настроен в Dashboard: " + (diagnostics.context.contextEnvKV ? "ДА" : "НЕТ"),
      "✅ Context передается в API: " + (diagnostics.context.provided ? "ДА" : "НЕТ"), 
      "✅ Context.env доступен: " + (diagnostics.context.hasEnv ? "ДА" : "НЕТ"),
      "✅ NOTION_QUEUE_KV в context.env: " + (diagnostics.context.contextEnvKV ? "ДА" : "НЕТ"),
      "✅ KV операции работают: " + (diagnostics.kvOperations.overall ? "ДА" : "НЕТ")
    ],
    
    nextSteps: diagnostics.kvOperations.overall ? 
      ["🎉 Все работает! Можете использовать KV для больших операций"] :
      [
        "🔄 Если только что изменили настройки - переразверните приложение",
        "⏳ Подождите несколько минут после развертывания",
        "🔍 Проверьте логи в Cloudflare Dashboard → Pages → Functions",
        "📞 Если проблема остается - обратитесь к администратору Cloudflare"
      ]
  };

  // 8. Определяем статус ответа
  const statusCode = diagnostics.analysis.status === 'healthy' ? 200 : 503;

  console.log(`[KV DIAGNOSTICS] 📊 Диагностика завершена. Статус: ${diagnostics.analysis.status}`);
  
  return NextResponse.json(diagnostics, { status: statusCode });
}

// POST endpoint для принудительного тестирования
export async function POST(req, context) {
  try {
    const body = await req.json();
    
    if (body.action === 'force_test') {
      console.log('[KV DIAGNOSTICS] 🧪 ПРИНУДИТЕЛЬНОЕ тестирование KV...');
      
      // Принудительная переинициализация с context
      const kvInitResult = initKV(context);
      
      const testResults = {
        initWithContext: kvInitResult,
        kvConnected: isKVConnected(),
        contextProvided: !!context,
        contextHasEnv: !!context?.env,
        contextHasKV: !!context?.env?.NOTION_QUEUE_KV,
        kvDiagnostics: getKVDiagnostics()
      };
      
      if (!isKVConnected()) {
        return NextResponse.json({
          success: false,
          message: "❌ KV недоступно для принудительного тестирования",
          testResults,
          recommendations: [
            "🔄 Переразверните приложение: npm run cf:deploy",
            "⏳ Подождите 2-3 минуты",
            "🔍 Проверьте настройки KV binding в Dashboard"
          ]
        }, { status: 503 });
      }
      
      // Интенсивное тестирование
      try {
        const testData = Array.from({ length: 3 }, (_, i) => ({
          key: `force_test_${Date.now()}_${i}`,
          value: JSON.stringify({ test: `force_value_${i}`, timestamp: Date.now() })
        }));
        
        // Запись
        for (const { key, value } of testData) {
          await context?.env?.NOTION_QUEUE_KV?.put(key, value, { expirationTtl: 60 }) ||
                NOTION_QUEUE_KV?.put(key, value, { expirationTtl: 60 });
        }
        testResults.bulkPut = true;
        
        // Чтение
        for (const { key, value } of testData) {
          const retrieved = await context?.env?.NOTION_QUEUE_KV?.get(key) ||
                           NOTION_QUEUE_KV?.get(key);
          if (retrieved !== value) {
            throw new Error(`Mismatch for key ${key}: expected ${value}, got ${retrieved}`);
          }
        }
        testResults.bulkGet = true;
        
        // Очистка
        for (const { key } of testData) {
          await context?.env?.NOTION_QUEUE_KV?.delete(key) ||
                NOTION_QUEUE_KV?.delete(key);
        }
        testResults.bulkDelete = true;
        
        testResults.overall = true;
        
      } catch (error) {
        testResults.overall = false;
        testResults.error = error.message;
        testResults.errorStack = error.stack;
      }
      
      return NextResponse.json({
        success: testResults.overall,
        message: testResults.overall ? 
          "✅ Принудительное тестирование KV прошло успешно! 🎉" : 
          "❌ Принудительное тестирование KV неудачно",
        testResults,
        timestamp: new Date().toISOString()
      });
    }
    
    return NextResponse.json(
      { error: "❌ Неизвестное действие" },
      { status: 400 }
    );
    
  } catch (error) {
    return NextResponse.json(
      { 
        error: "❌ Ошибка обработки POST запроса",
        details: error.message 
      },
      { status: 500 }
    );
  }
}