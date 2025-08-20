// app/api/kv/diagnostics/route.js - Диагностический endpoint для Cloudflare KV
export const runtime = "edge";

import { NextResponse } from "next/server";
import { initKV, isKVConnected } from "@/lib/kv-queue";

export async function GET(req, context) {
  console.log('[KV DIAGNOSTICS] Начинаем диагностику Cloudflare KV');
  
  const diagnostics = {
    timestamp: new Date().toISOString(),
    runtime: "edge",
    diagnostics: {}
  };

  // 1. Проверка глобальных переменных
  diagnostics.globalVariables = {
    NOTION_QUEUE_KV_exists: typeof NOTION_QUEUE_KV !== 'undefined',
    NOTION_QUEUE_KV_truthy: typeof NOTION_QUEUE_KV !== 'undefined' && !!NOTION_QUEUE_KV,
    globalThis_exists: typeof globalThis !== 'undefined',
    globalThis_NOTION_QUEUE_KV: typeof globalThis !== 'undefined' && !!globalThis.NOTION_QUEUE_KV
  };

  // 2. Проверка переменных окружения
  diagnostics.environment = {
    NODE_ENV: process.env.NODE_ENV || 'unknown',
    hasNotionToken: !!process.env.NOTION_TOKEN,
    hasJWTSecret: !!process.env.JWT_SECRET,
    hasMatrixDbId: !!process.env.MATRIX_DB_ID
  };

  // 3. Попытка инициализации KV
  try {
    const kvInitResult = initKV();
    diagnostics.kvInitialization = {
      success: kvInitResult,
      connected: isKVConnected(),
      error: null
    };
  } catch (initError) {
    diagnostics.kvInitialization = {
      success: false,
      connected: false,
      error: initError.message
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

  // 5. Анализ проблем и рекомендации
  const issues = [];
  const recommendations = [];

  if (!diagnostics.globalVariables.NOTION_QUEUE_KV_exists) {
    issues.push('NOTION_QUEUE_KV глобальная переменная не существует');
    recommendations.push('Проверьте binding в wrangler.toml: [[kv_namespaces]] binding = "NOTION_QUEUE_KV"');
  }

  if (!diagnostics.globalVariables.NOTION_QUEUE_KV_truthy) {
    issues.push('NOTION_QUEUE_KV существует, но имеет falsy значение');
    recommendations.push('Убедитесь что KV namespace создан и правильно привязан');
  }

  if (!diagnostics.kvInitialization.success) {
    issues.push('Инициализация KV неудачна');
    recommendations.push('Переразверните приложение: npm run cf:deploy');
  }

  if (!diagnostics.kvOperations.overall) {
    issues.push('KV операции не работают');
    recommendations.push('Проверьте права доступа и статус KV namespace в Cloudflare Dashboard');
  }

  if (issues.length === 0) {
    issues.push('Проблем не найдено');
    recommendations.push('Cloudflare KV настроен и работает корректно');
  }

  diagnostics.analysis = {
    issues,
    recommendations,
    status: issues.length === 1 && issues[0] === 'Проблем не найдено' ? 'healthy' : 'issues_found'
  };

  // 6. Пошаговое руководство по устранению неполадок
  diagnostics.troubleshooting = {
    step1: {
      title: "Проверьте wrangler.toml",
      description: "Убедитесь что KV namespace правильно привязан",
      example: `[[kv_namespaces]]
binding = "NOTION_QUEUE_KV"
id = "your-kv-namespace-id"`,
      check: diagnostics.globalVariables.NOTION_QUEUE_KV_exists
    },
    step2: {
      title: "Создайте KV namespace (если не создан)",
      description: "Используйте Cloudflare Dashboard или CLI",
      commands: [
        "wrangler kv:namespace create notion-queue-kv",
        "Скопируйте ID в wrangler.toml"
      ],
      check: diagnostics.globalVariables.NOTION_QUEUE_KV_truthy
    },
    step3: {
      title: "Переразверните приложение",
      description: "После изменений в wrangler.toml нужно переразвернуть",
      commands: [
        "npm run cf:deploy"
      ],
      check: diagnostics.kvInitialization.success
    },
    step4: {
      title: "Проверьте права доступа",
      description: "Убедитесь что у приложения есть права на KV",
      check: diagnostics.kvOperations.overall
    }
  };

  // 7. Статус ответа на основе диагностики
  const statusCode = diagnostics.analysis.status === 'healthy' ? 200 : 503;

  return NextResponse.json(diagnostics, { status: statusCode });
}

// POST endpoint для принудительного тестирования
export async function POST(req) {
  try {
    const body = await req.json();
    
    if (body.action === 'force_test') {
      console.log('[KV DIAGNOSTICS] Принудительное тестирование KV');
      
      // Принудительная переинициализация
      const kvInitResult = initKV();
      
      if (!isKVConnected()) {
        return NextResponse.json({
          success: false,
          message: "KV недоступно для тестирования",
          kvConnected: false
        }, { status: 503 });
      }
      
      // Расширенное тестирование
      const testResults = {};
      
      try {
        // Тест множественных операций
        const testData = Array.from({ length: 5 }, (_, i) => ({
          key: `bulk_test_${Date.now()}_${i}`,
          value: `test_value_${i}`
        }));
        
        // Запись
        for (const { key, value } of testData) {
          await NOTION_QUEUE_KV.put(key, value, { expirationTtl: 60 });
        }
        testResults.bulkPut = true;
        
        // Чтение
        for (const { key, value } of testData) {
          const retrieved = await NOTION_QUEUE_KV.get(key);
          if (retrieved !== value) {
            throw new Error(`Mismatch for key ${key}`);
          }
        }
        testResults.bulkGet = true;
        
        // Очистка
        for (const { key } of testData) {
          await NOTION_QUEUE_KV.delete(key);
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
          "Расширенное тестирование KV прошло успешно" : 
          "Расширенное тестирование KV неудачно",
        testResults,
        timestamp: new Date().toISOString()
      });
    }
    
    return NextResponse.json(
      { error: "Неизвестное действие" },
      { status: 400 }
    );
    
  } catch (error) {
    return NextResponse.json(
      { 
        error: "Ошибка обработки POST запроса",
        details: error.message 
      },
      { status: 500 }
    );
  }
}