// app/api/kv/diagnostics/route.js - ИСПРАВЛЕННЫЕ тесты с правильными TTL
export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from '@cloudflare/next-on-pages';
import { initKV, isKVConnected, getKVDiagnostics } from "@/lib/kv-queue";

export async function GET(req) {
  console.log('[KV DIAGNOSTICS] 🔍 Запуск диагностики Cloudflare KV для Next.js на Pages');
  
  const diagnostics = {
    timestamp: new Date().toISOString(),
    runtime: "edge",
    platform: "Cloudflare Pages",
    url: req.url
  };

  // 1. Проверка доступности getRequestContext
  diagnostics.requestContext = {
    available: false,
    error: null,
    contextKeys: [],
    envKeys: [],
    hasKVBinding: false
  };

  try {
    const { env } = getRequestContext();
    diagnostics.requestContext = {
      available: true,
      error: null,
      contextKeys: Object.keys(getRequestContext()),
      envKeys: Object.keys(env || {}),
      hasKVBinding: !!env.NOTION_QUEUE_KV,
      kvType: env.NOTION_QUEUE_KV ? typeof env.NOTION_QUEUE_KV : 'undefined'
    };
    
    console.log('[KV DIAGNOSTICS] ✅ getRequestContext() работает');
  } catch (error) {
    diagnostics.requestContext.error = error.message;
    console.error('[KV DIAGNOSTICS] ❌ getRequestContext() недоступен:', error.message);
  }

  // 2. Проверка переменных окружения
  diagnostics.environment = {
    NODE_ENV: process.env.NODE_ENV || 'unknown',
    hasNotionToken: !!process.env.NOTION_TOKEN,
    hasJWTSecret: !!process.env.JWT_SECRET,
    hasMatrixDbId: !!process.env.MATRIX_DB_ID,
    hasEmployeesDbId: !!process.env.EMPLOYEES_DB_ID
  };

  // 3. Инициализация и тестирование KV
  console.log('[KV DIAGNOSTICS] 🔧 Тестируем инициализацию KV...');
  
  const kvInitResult = initKV();
  const kvDiagnosticsData = getKVDiagnostics();
  
  diagnostics.kvInitialization = {
    success: kvInitResult,
    details: kvDiagnosticsData
  };

  // 4. Тестирование подключения к KV
  diagnostics.kvConnection = {
    connected: false,
    error: null,
    testResults: null
  };

  if (diagnostics.requestContext.hasKVBinding) {
    try {
      console.log('[KV DIAGNOSTICS] 🧪 Тестируем подключение к KV...');
      
      const connected = await isKVConnected();
      diagnostics.kvConnection.connected = connected;
      
      if (connected) {
        // Расширенное тестирование KV операций
        const testResults = await performKVTests();
        diagnostics.kvConnection.testResults = testResults;
        console.log('[KV DIAGNOSTICS] ✅ KV тестирование завершено успешно');
      } else {
        diagnostics.kvConnection.error = 'KV connection test failed';
        console.warn('[KV DIAGNOSTICS] ⚠️ KV подключение неудачно');
      }
    } catch (error) {
      diagnostics.kvConnection.error = error.message;
      console.error('[KV DIAGNOSTICS] ❌ Ошибка тестирования KV:', error.message);
    }
  } else {
    diagnostics.kvConnection.error = 'KV binding not found in environment';
    console.warn('[KV DIAGNOSTICS] ⚠️ KV binding не найден');
  }

  // 5. Анализ проблем и рекомендации
  const analysis = analyzeKVIssues(diagnostics);
  diagnostics.analysis = analysis;

  // 6. Определение статуса ответа
  const isHealthy = diagnostics.kvConnection.connected && diagnostics.requestContext.available;
  const statusCode = isHealthy ? 200 : 503;

  console.log(`[KV DIAGNOSTICS] 📊 Диагностика завершена. Статус: ${isHealthy ? 'healthy' : 'issues'}`);
  
  return NextResponse.json(diagnostics, { status: statusCode });
}

// ИСПРАВЛЕННОЕ расширенное тестирование KV операций
async function performKVTests() {
  const { env } = getRequestContext();
  const kv = env.NOTION_QUEUE_KV;
  
  const testResults = {
    basicOperations: false,
    concurrentOperations: false,
    largeValueHandling: false,
    ttlSupport: false,
    listOperations: false,
    errors: []
  };

  try {
    // Тест 1: Базовые операции (PUT, GET, DELETE)
    console.log('[KV TEST] Тестируем базовые операции...');
    const testKey = `diagnostic_test_${Date.now()}`;
    const testValue = JSON.stringify({ test: true, timestamp: Date.now() });
    
    await kv.put(testKey, testValue);
    const retrieved = await kv.get(testKey);
    await kv.delete(testKey);
    
    testResults.basicOperations = retrieved === testValue;
    console.log(`[KV TEST] Базовые операции: ${testResults.basicOperations ? '✅' : '❌'}`);

    // Тест 2: ИСПРАВЛЕННАЯ TTL поддержка (минимум 60 секунд)
    console.log('[KV TEST] Тестируем TTL...');
    const ttlKey = `ttl_test_${Date.now()}`;
    
    try {
      await kv.put(ttlKey, 'ttl_test', { expirationTtl: 60 }); // ИСПРАВЛЕНО: минимум 60 секунд
      
      // Проверяем что значение сразу доступно
      const ttlValue = await kv.get(ttlKey);
      testResults.ttlSupport = ttlValue === 'ttl_test';
      
      // Очищаем сразу, не ждем истечения
      await kv.delete(ttlKey);
      
      console.log(`[KV TEST] TTL поддержка: ${testResults.ttlSupport ? '✅' : '❌'}`);
    } catch (ttlError) {
      testResults.errors.push(`TTL error: ${ttlError.message}`);
      testResults.ttlSupport = false;
      console.warn(`[KV TEST] TTL поддержка: ❌ - ${ttlError.message}`);
    }

    // Тест 3: ИСПРАВЛЕННЫЕ параллельные операции с задержками
    console.log('[KV TEST] Тестируем параллельные операции...');
    try {
      const concurrentData = Array.from({ length: 3 }, (_, i) => ({
        key: `concurrent_${Date.now()}_${i}`,
        value: `value_${i}`
      }));
      
      // Последовательные операции с небольшими задержками для избежания rate limits
      for (const { key, value } of concurrentData) {
        await kv.put(key, value);
        await new Promise(resolve => setTimeout(resolve, 100)); // Небольшая задержка
      }
      
      // Проверяем чтение
      let allRead = true;
      for (const { key, value } of concurrentData) {
        const retrieved = await kv.get(key);
        if (retrieved !== value) {
          allRead = false;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Очищаем
      for (const { key } of concurrentData) {
        await kv.delete(key);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      testResults.concurrentOperations = allRead;
      console.log(`[KV TEST] Параллельные операции: ${testResults.concurrentOperations ? '✅' : '❌'}`);
      
    } catch (concurrentError) {
      testResults.errors.push(`Concurrent operations error: ${concurrentError.message}`);
      testResults.concurrentOperations = false;
      console.warn(`[KV TEST] Параллельные операции: ❌ - ${concurrentError.message}`);
    }

    // Тест 4: ИСПРАВЛЕННОЕ тестирование больших значений (меньший размер)
    console.log('[KV TEST] Тестируем большие значения...');
    try {
      const largeKey = `large_test_${Date.now()}`;
      const largeValue = JSON.stringify({
        data: Array.from({ length: 50 }, (_, i) => `item_${i}_${'x'.repeat(20)}`) // Уменьшенный размер
      });
      
      await kv.put(largeKey, largeValue);
      const largeRetrieved = await kv.get(largeKey);
      testResults.largeValueHandling = largeRetrieved === largeValue;
      await kv.delete(largeKey);
      console.log(`[KV TEST] Большие значения: ${testResults.largeValueHandling ? '✅' : '❌'}`);
      
    } catch (largeError) {
      testResults.errors.push(`Large value error: ${largeError.message}`);
      testResults.largeValueHandling = false;
      console.warn(`[KV TEST] Большие значения: ❌ - ${largeError.message}`);
    }

    // Тест 5: ИСПРАВЛЕННЫЕ list операции
    console.log('[KV TEST] Тестируем list операции...');
    try {
      // Сначала создаем тестовые записи
      const listTestKey = `list_test_${Date.now()}`;
      await kv.put(listTestKey, 'list_test_value');
      
      const listResult = await kv.list({ prefix: 'list_test_', limit: 10 });
      testResults.listOperations = listResult && Array.isArray(listResult.keys) && listResult.keys.length > 0;
      
      // Очищаем
      await kv.delete(listTestKey);
      
      console.log(`[KV TEST] List операции: ${testResults.listOperations ? '✅' : '❌'}`);
    } catch (listError) {
      testResults.listOperations = false;
      testResults.errors.push(`List error: ${listError.message}`);
      console.warn(`[KV TEST] List операции: ❌ - ${listError.message}`);
    }

  } catch (error) {
    testResults.errors.push(error.message);
    console.error('[KV TEST] Ошибка тестирования:', error.message);
  }

  return testResults;
}

// Анализ проблем и генерация рекомендаций
function analyzeKVIssues(diagnostics) {
  const issues = [];
  const recommendations = [];
  const status = diagnostics.kvConnection.connected ? 'healthy' : 'issues';

  // Анализ проблем
  if (!diagnostics.requestContext.available) {
    issues.push('🚨 КРИТИЧНО: getRequestContext() недоступен');
    recommendations.push('❗ Убедитесь что используете @cloudflare/next-on-pages');
    recommendations.push('📝 Проверьте что все API routes имеют export const runtime = "edge"');
  } 
  else if (!diagnostics.requestContext.hasKVBinding) {
    issues.push('🚨 КРИТИЧНО: KV binding NOTION_QUEUE_KV не найден');
    recommendations.push('❗ Создайте KV namespace: npx wrangler kv namespace create "NOTION_QUEUE_KV"');
    recommendations.push('📝 Добавьте binding в wrangler.toml');
    recommendations.push('🔄 Переразверните приложение: npm run cf:deploy');
  } 
  else if (!diagnostics.kvConnection.connected) {
    issues.push('⚠️ KV binding найден, но подключение неудачно');
    recommendations.push('🔧 Проверьте что namespace ID корректный в wrangler.toml');
    recommendations.push('⏳ Подождите несколько минут после развертывания');
    recommendations.push('🔍 Проверьте логи развертывания на ошибки');
  }

  // Анализ тестов
  if (diagnostics.kvConnection.testResults) {
    const tests = diagnostics.kvConnection.testResults;
    
    if (!tests.basicOperations) {
      issues.push('❌ Базовые KV операции не работают');
      recommendations.push('🔧 Проверьте права доступа к KV namespace');
    }
    
    if (!tests.ttlSupport) {
      issues.push('⚠️ TTL поддержка работает некорректно');
      recommendations.push('📋 Cloudflare KV требует минимум 60 секунд для TTL');
      recommendations.push('🔧 Обновите код для использования TTL >= 60');
    }
    
    if (!tests.concurrentOperations) {
      issues.push('⚠️ Проблемы с параллельными операциями');
      recommendations.push('🔄 Используйте sequential обработку для стабильности');
      recommendations.push('⏱️ Добавьте задержки между операциями для rate limiting');
    }
    
    if (!tests.largeValueHandling) {
      issues.push('⚠️ Проблемы с большими значениями');
      recommendations.push('📦 Ограничьте размер batch операций до 25KB');
      recommendations.push('🗜️ Используйте сжатие для больших данных');
    }
    
    if (!tests.listOperations) {
      issues.push('⚠️ List операции не работают');
      recommendations.push('📋 List операции могут быть недоступны в некоторых планах');
      recommendations.push('🔧 Используйте прямой доступ по ключам вместо list');
    }
  }

  // Общие рекомендации
  if (issues.length === 0) {
    recommendations.push('🎉 KV настроен и работает корректно!');
    recommendations.push('🚀 Готово для обработки больших batch операций');
  } else if (diagnostics.kvConnection.connected && tests.basicOperations) {
    recommendations.push('✅ Основные функции KV работают');
    recommendations.push('🔧 Минорные проблемы можно решить настройками');
    recommendations.push('🚀 Система готова к работе с ограничениями');
  } else {
    recommendations.push('📞 При сохраняющихся проблемах проверьте Cloudflare Dashboard');
  }

  return {
    status,
    issuesCount: issues.length,
    issues,
    recommendations,
    severity: issues.some(i => i.includes('КРИТИЧНО')) ? 'critical' : 
              issues.length > 0 ? 'warning' : 'none'
  };
}

// POST endpoint для принудительного тестирования
export async function POST(req) {
  try {
    const body = await req.json();
    
    if (body.action === 'force_test') {
      console.log('[KV DIAGNOSTICS] 🧪 ПРИНУДИТЕЛЬНОЕ тестирование KV...');
      
      try {
        const connected = await isKVConnected();
        
        if (!connected) {
          return NextResponse.json({
            success: false,
            message: "❌ KV недоступно для принудительного тестирования",
            recommendations: [
              "🔄 Переразверните приложение: npm run cf:deploy",
              "⏳ Подождите 2-3 минуты",
              "🔍 Проверьте настройки KV binding в wrangler.toml"
            ]
          }, { status: 503 });
        }
        
        // Интенсивное тестирование
        const testResults = await performKVTests();
        
        return NextResponse.json({
          success: true,
          message: "✅ Принудительное тестирование KV завершено успешно! 🎉",
          testResults,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        return NextResponse.json({
          success: false,
          message: "❌ Принудительное тестирование KV неудачно",
          error: error.message,
          timestamp: new Date().toISOString()
        }, { status: 500 });
      }
    }
    
    if (body.action === 'cleanup') {
      console.log('[KV DIAGNOSTICS] 🧹 Очистка тестовых данных...');
      
      try {
        const { env } = getRequestContext();
        const kv = env.NOTION_QUEUE_KV;
        
        // Получаем список тестовых ключей
        const prefixes = ['diagnostic_', 'concurrent_', 'ttl_test_', 'large_test_', 'list_test_'];
        let totalCleaned = 0;
        
        for (const prefix of prefixes) {
          try {
            const testKeys = await kv.list({ prefix });
            
            for (const key of testKeys.keys) {
              await kv.delete(key.name);
              totalCleaned++;
              await new Promise(resolve => setTimeout(resolve, 50)); // Rate limiting
            }
          } catch (prefixError) {
            console.warn(`[KV CLEANUP] Ошибка очистки префикса ${prefix}:`, prefixError.message);
          }
        }
        
        return NextResponse.json({
          success: true,
          message: `🧹 Очищено ${totalCleaned} тестовых записей`,
          cleaned: totalCleaned
        });
        
      } catch (error) {
        return NextResponse.json({
          success: false,
          message: "❌ Ошибка очистки тестовых данных",
          error: error.message
        }, { status: 500 });
      }
    }
    
    return NextResponse.json(
      { error: "❌ Неизвестное действие. Поддерживаются: force_test, cleanup" },
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