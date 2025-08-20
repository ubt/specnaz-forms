// app/api/kv/diagnostics/route.js - Диагностический endpoint для Cloudflare KV
export const runtime = "edge";

import { NextResponse } from "next/server";
import { initKV, isKVConnected } from "@/lib/kv-queue";

export async function GET(req, context) {
  console.log('[KV DIAGNOSTICS] 🔍 Начинаем диагностику Cloudflare KV для Pages');
  
  const diagnostics = {
    timestamp: new Date().toISOString(),
    runtime: "edge",
    platform: "Cloudflare Pages"
  };

  // 1. Проверка context и bindings
  diagnostics.context = {
    provided: !!context,
    hasEnv: !!context?.env,
    envKeys: context?.env ? Object.keys(context.env) : [],
    hasBindings: !!context?.bindings,
    bindingsKeys: context?.bindings ? Object.keys(context.bindings) : [],
    contextKeys: context ? Object.keys(context) : [],
    
    // Проверка доступа к KV через context
    contextEnvKV: !!context?.env?.NOTION_QUEUE_KV,
    contextBindingsKV: !!context?.bindings?.NOTION_QUEUE_KV,
    contextDirectKV: !!context?.NOTION_QUEUE_KV
  };

  // 2. Проверка глобальных переменных
  diagnostics.globalVariables = {
    NOTION_QUEUE_KV_exists: typeof NOTION_QUEUE_KV !== 'undefined',
    NOTION_QUEUE_KV_truthy: typeof NOTION_QUEUE_KV !== 'undefined' && !!NOTION_QUEUE_KV,
    globalThis_exists: typeof globalThis !== 'undefined',
    globalThis_NOTION_QUEUE_KV: typeof globalThis !== 'undefined' && !!globalThis.NOTION_QUEUE_KV
  };

  // 3. Проверка переменных окружения
  diagnostics.environment = {
    NODE_ENV: process.env.NODE_ENV || 'unknown',
    hasNotionToken: !!process.env.NOTION_TOKEN,
    hasJWTSecret: !!process.env.JWT_SECRET,
    hasMatrixDbId: !!process.env.MATRIX_DB_ID
  };

  // 4. Попытка инициализации KV с context
  try {
    console.log('[KV DIAGNOSTICS] 🔧 Инициализация KV с переданным context...');
    const kvInitResult = initKV(context); // Передаем context!
    diagnostics.kvInitialization = {
      success: kvInitResult,
      connected: isKVConnected(),
      error: null,
      withContext: true
    };
  } catch (initError) {
    diagnostics.kvInitialization = {
      success: false,
      connected: false,
      error: initError.message,
      withContext: true
    };
  }

  // 4. Тестирование KV операций (если доступно)
  if (isKVConnected() && typeof NOTION_QUEUE_KV !== 'undefined') {
    try {
      const testKey = `diagnostic_test_${Date.now()}`;
      const testValue = 'diagnostic_test_value';
      
      // Тест записи
      await NOTION_QUEUE_KV.put(testKey, testValue, { expirationTtl: 60 });
      
      // Тест чтения
      const retrievedValue = await NOTION_QUEUE_KV.get(testKey);
      
      // Тест удаления
      await NOTION_QUEUE_KV.delete(testKey);
      
      diagnostics.kvOperations = {
        put: true,
        get: retrievedValue === testValue,
        delete: true,
        overall: retrievedValue === testValue
      };
      
    } catch (kvError) {
      diagnostics.kvOperations = {
        put: false,
        get: false,
        delete: false,
        overall: false,
        error: kvError.message
      };
    }
  } else {
    diagnostics.kvOperations = {
      put: false,
      get: false,
      delete: false,
      overall: false,
      reason: 'KV не подключен или недоступен'
    };
  }

  // 5. Анализ проблем и рекомендации для Cloudflare Pages
  const issues = [];
  const recommendations = [];

  // Проверка для Pages-специфичных проблем
  if (!diagnostics.context.provided) {
    issues.push('Context не предоставлен в API route');
    recommendations.push('Убедитесь что context передается в API endpoint');
  }

  if (!diagnostics.context.contextEnvKV && !diagnostics.context.contextBindingsKV && !diagnostics.globalVariables.NOTION_QUEUE_KV_exists) {
    issues.push('NOTION_QUEUE_KV не найден ни в context, ни в глобальных переменных');
    recommendations.push('🔧 Настройте KV binding в Cloudflare Pages Dashboard:');
    recommendations.push('   1. Pages → Settings → Functions → KV namespace bindings');
    recommendations.push('   2. Variable name: NOTION_QUEUE_KV');
    recommendations.push('   3. Выберите ваш KV namespace');
    recommendations.push('   4. Сохраните настройки');
  }

  if (diagnostics.context.provided && !diagnostics.context.hasEnv) {
    issues.push('Context предоставлен, но не содержит env объект');
    recommendations.push('Проверьте передачу context в API route');
  }

  if (!diagnostics.kvInitialization.success) {
    issues.push('Инициализация KV неудачна');
    recommendations.push('🔄 Переразверните приложение: npm run cf:deploy');
    recommendations.push('🔍 Проверьте диагностику после развертывания');
  }

  if (!diagnostics.kvOperations.overall) {
    issues.push('KV операции не работают');
    recommendations.push('📊 Проверьте права доступа и статус KV namespace в Cloudflare Dashboard');
    recommendations.push('🔧 Убедитесь что KV namespace не был удален');
  }

  if (issues.length === 0) {
    issues.push('✅ Проблем не найдено');
    recommendations.push('🎉 Cloudflare KV настроен и работает корректно для Pages');
  }

  diagnostics.analysis = {
    issues,
    recommendations,
    status: issues.length === 1 && issues[0] === '✅ Проблем не найдено' ? 'healthy' : 'issues_found'
  };

  // 6. Пошаговое руководство по устранению неполадок для Pages
  diagnostics.troubleshooting = {
    step1: {
      title: "🔧 Настройте KV binding в Pages Dashboard",
      description: "Основной способ привязки KV для Cloudflare Pages",
      instructions: [
        "Откройте Cloudflare Dashboard",
        "Перейдите в Workers & Pages → Overview",
        "Найдите ваш проект 'specnaz-forms'",
        "Settings → Functions → KV namespace bindings",
        "Add binding: Variable name = NOTION_QUEUE_KV",
        "Выберите ваш KV namespace",
        "Save"
      ],
      check: diagnostics.context.contextEnvKV || diagnostics.context.contextBindingsKV
    },
    step2: {
      title: "📦 Создайте KV namespace (если не создан)",
      description: "Убедитесь что KV namespace существует",
      commands: [
        "wrangler kv:namespace create notion-queue-kv",
        "Скопируйте ID из вывода команды",
        "Используйте этот ID в Dashboard"
      ],
      check: diagnostics.globalVariables.NOTION_QUEUE_KV_truthy || diagnostics.context.contextEnvKV
    },
    step3: {
      title: "🚀 Переразверните приложение",
      description: "После изменений в Dashboard обязательно переразверните",
      commands: [
        "npm run cf:deploy"
      ],
      check: diagnostics.kvInitialization.success
    },
    step4: {
      title: "✅ Проверьте KV операции",
      description: "Убедитесь что KV работает корректно",
      check: diagnostics.kvOperations.overall
    },
    pages_specific: {
      title: "📋 Специфика Cloudflare Pages",
      notes: [
        "В Pages KV bindings настраиваются через Dashboard, а не wrangler.toml",
        "wrangler.toml используется только для локальной разработки",
        "KV доступен через context.env в Pages Functions",
        "После изменений в Dashboard нужно переразвернуть приложение"
      ]
    }
  };

  // 7. Статус ответа на основе диагностики
  const statusCode = diagnostics.analysis.status === 'healthy' ? 200 : 503;

  return NextResponse.json(diagnostics, { status: statusCode });
}

// POST endpoint для принудительного тестирования
export async function POST(req, context) {
  try {
    const body = await req.json();
    
    if (body.action === 'force_test') {
      console.log('[KV DIAGNOSTICS] 🧪 Принудительное тестирование KV для Pages');
      
      // Принудительная переинициализация с context
      const kvInitResult = initKV(context);
      
      if (!isKVConnected()) {
        return NextResponse.json({
          success: false,
          message: "❌ KV недоступно для тестирования",
          kvConnected: false,
          context: {
            provided: !!context,
            hasEnv: !!context?.env,
            envKeys: context?.env ? Object.keys(context.env) : [],
            hasKVInEnv: !!context?.env?.NOTION_QUEUE_KV,
            hasBindings: !!context?.bindings,
            hasKVInBindings: !!context?.bindings?.NOTION_QUEUE_KV
          }
        }, { status: 503 });
      }
      
      // Расширенное тестирование для Pages
      const testResults = {
        initWithContext: kvInitResult,
        kvConnected: isKVConnected()
      };
      
      try {
        // Тест множественных операций
        const testData = Array.from({ length: 5 }, (_, i) => ({
          key: `pages_bulk_test_${Date.now()}_${i}`,
          value: `test_value_${i}`
        }));
        
        // Запись
        for (const { key, value } of testData) {
          await KV_NAMESPACE.put(key, value, { expirationTtl: 60 });
        }
        testResults.bulkPut = true;
        
        // Чтение
        for (const { key, value } of testData) {
          const retrieved = await KV_NAMESPACE.get(key);
          if (retrieved !== value) {
            throw new Error(`Mismatch for key ${key}`);
          }
        }
        testResults.bulkGet = true;
        
        // Очистка
        for (const { key } of testData) {
          await KV_NAMESPACE.delete(key);
        }
        testResults.bulkDelete = true;
        
        testResults.overall = true;
         
      } catch (error) {
        testResults.overall = false;
        testResults.error = error.message;
      }
      
      return NextResponse.json({
        success: testResults.overall,
        message: testResults.overall ? 
          "✅ Расширенное тестирование KV для Pages прошло успешно" : 
          "❌ Расширенное тестирование KV для Pages неудачно",
        testResults,
        timestamp: new Date().toISOString(),
        platform: "Cloudflare Pages"
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