// app/api/kv/diagnostics/route.js - ИСПРАВЛЕННАЯ диагностика KV для Next.js на Pages
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

// Расширенное тестирование KV операций
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

    // Тест 2: TTL поддержка
    console.log('[KV TEST] Тестируем TTL...');
    const ttlKey = `ttl_test_${Date.now()}`;
    await kv.put(ttlKey, 'ttl_test', { expirationTtl: 1 });
    
    // Проверяем что значение сразу доступно
    const ttlValue = await kv.get(ttlKey);
    testResults.ttlSupport = ttlValue === 'ttl_test';
    console.log(`[KV TEST] TTL поддержка: ${testResults.ttlSupport ? '✅' : '❌'}`);

    // Тест 3: Параллельные операции
    console.log('[KV TEST] Тестируем параллельные операции...');
    const concurrentPromises = Array.from({ length: 3 }, (_, i) => 
      kv.put(`concurrent_${Date.now()}_${i}`, `value_${i}`)
    );
    
    await Promise.all(concurrentPromises);
    testResults.concurrentOperations = true;
    console.log(`[KV TEST] Параллельные операции: ✅`);

    // Тест 4: Большие значения
    console.log('[KV TEST] Тестируем большие значения...');
    const largeKey = `large_test_${Date.now()}`;
    const largeValue = JSON.stringify({
      data: Array.from({ length: 100 }, (_, i) => `item_${i}_${'x'.repeat(50)}`)
    });
    
    await kv.put(largeKey, largeValue);
    const largeRetrieved = await kv.get(largeKey);
    testResults.largeValueHandling = largeRetrieved === largeValue;
    await kv.delete(largeKey);
    console.log(`[KV TEST] Большие значения: ${testResults.largeValueHandling ? '✅' : '❌'}`);

    // Тест 5: List операции
    console.log('[KV TEST] Тестируем list операции...');
    try {
      const listResult = await kv.list({ prefix: 'diagnostic_', limit: 1 });
      testResults.listOperations = listResult && Array.isArray(listResult.keys);
      console.log(`[KV TEST] List операции: ${testResults.listOperations ? '✅' : '❌'}`);
    } catch (listError) {
      testResults.listOperations = false;
      testResults.errors.push(`List error: ${listError.message}`);
      console.warn(`[KV TEST] List операции: ❌ - ${listError.message}`);
    }

    // Очистка тестовых данных
    try {
      await Promise.all([
        kv.delete(ttlKey),
        ...Array.from({ length: 3 }, (_, i) => kv.delete(`concurrent_${Date.now()}_${i}`))
      ]);
    } catch (cleanupError) {
      console.warn('[KV TEST] Предупреждение при очистке:', cleanupError.message);
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
      recommendations.push('📋 TTL может не работать в preview режиме');
    }
    
    if (!tests.concurrentOperations) {
      issues.push('⚠️ Проблемы с параллельными операциями');
      recommendations.push('🔄 Используйте sequential обработку как fallback');
    }
  }

  // Общие рекомендации
  if (issues.length === 0) {
    recommendations.push('🎉 KV настроен и работает корректно!');
    recommendations.push('🚀 Готово для обработки больших batch операций');
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
        const testKeys = await kv.list({ prefix: 'diagnostic_' });
        const concurrentKeys = await kv.list({ prefix: 'concurrent_' });
        const ttlKeys = await kv.list({ prefix: 'ttl_test_' });
        
        const allTestKeys = [
          ...testKeys.keys,
          ...concurrentKeys.keys,
          ...ttlKeys.keys
        ];
        
        // Удаляем все тестовые ключи
        const deletePromises = allTestKeys.map(key => kv.delete(key.name));
        await Promise.all(deletePromises);
        
        return NextResponse.json({
          success: true,
          message: `🧹 Очищено ${allTestKeys.length} тестовых записей`,
          cleaned: allTestKeys.length
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