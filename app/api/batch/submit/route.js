// app/api/batch/submit/route.js - ФИНАЛЬНАЯ версия с надежной KV инициализацией
export const runtime = "edge";

import { NextResponse } from "next/server";
import { verifyReviewToken } from "@/lib/token";
import { NotionBatchProcessor, addBatchToKVQueue, isKVConnected, initKV } from "@/lib/kv-queue";
import { notion } from "@/lib/notion";

// Обновленные лимиты безопасности
const LIMITS = {
  DIRECT_PROCESSING: {
    maxOperations: 10,
    maxOperationSize: 8000
  },
  KV_QUEUE: {
    maxOperations: 1000,
    maxOperationSize: 10000
  },
  GENERAL: {
    maxConcurrency: 3,
    minRateLimit: 2000,
    maxRetries: 3
  }
};

export async function POST(req, context) {
  console.log('[BATCH SUBMIT] ===== 🚀 Новый запрос на batch обработку =====');
  
  // КРИТИЧНО: Инициализация KV с context для Cloudflare Pages
  console.log('[BATCH SUBMIT] 🔧 Инициализация KV с полным context...');
  console.log('[BATCH SUBMIT] 🔍 Context анализ:', {
    hasContext: !!context,
    contextType: typeof context,
    hasEnv: !!context?.env,
    hasKVInEnv: !!context?.env?.NOTION_QUEUE_KV,
    envKeys: context?.env ? Object.keys(context.env) : []
  });
  
  try {
    const kvInitResult = initKV(context); // КРИТИЧНО: передаем весь context
    console.log(`[BATCH SUBMIT] KV инициализация: ${kvInitResult ? '✅ УСПЕШНО' : '❌ НЕУДАЧНО'}`);
    
    if (!kvInitResult) {
      console.warn('[BATCH SUBMIT] ⚠️ KV инициализация неудачна, детали:', {
        contextProvided: !!context,
        contextEnv: !!context?.env,
        contextKV: !!context?.env?.NOTION_QUEUE_KV,
        globalKV: typeof NOTION_QUEUE_KV !== 'undefined'
      });
    }
  } catch (initError) {
    console.error('[BATCH SUBMIT] ❌ Критическая ошибка инициализации KV:', initError.message);
  }
  
  try {
    // 1. Парсинг и валидация входных данных
    let body;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error('[BATCH SUBMIT] ❌ Ошибка парсинга JSON:', parseError.message);
      return NextResponse.json(
        { 
          error: "Некорректный JSON в теле запроса",
          details: "Проверьте формат отправляемых данных"
        },
        { status: 400 }
      );
    }

    console.log(`[BATCH SUBMIT] 📥 Получены данные: ${Object.keys(body).join(', ')}`);

    // 2. Проверка авторизации
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    
    if (!token) {
      return NextResponse.json(
        { error: "Отсутствует токен авторизации. Добавьте заголовок: Authorization: Bearer <token>" },
        { status: 401 }
      );
    }

    let payload;
    try {
      payload = await verifyReviewToken(token);
      console.log('[BATCH SUBMIT] ✅ Токен верифицирован для пользователя:', payload.reviewerUserId);
    } catch (tokenError) {
      console.error('[BATCH SUBMIT] ❌ Ошибка верификации токена:', tokenError.message);
      return NextResponse.json(
        { 
          error: "Недействительный или истёкший токен",
          suggestion: "Запросите новую ссылку у администратора"
        },
        { status: 401 }
      );
    }

    // 3. Валидация операций
    const { operations = [], options = {} } = body;

    if (!Array.isArray(operations) || operations.length === 0) {
      return NextResponse.json(
        { 
          error: "Не предоставлены операции для обработки",
          expected: "Массив операций с полями: pageId, properties"
        },
        { status: 400 }
      );
    }

    // Валидация каждой операции
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if (!op.pageId || typeof op.pageId !== 'string') {
        return NextResponse.json(
          { 
            error: `Операция ${i + 1}: некорректный pageId`,
            details: "pageId должен быть непустой строкой"
          },
          { status: 400 }
        );
      }
      
      if (!op.properties || typeof op.properties !== 'object') {
        return NextResponse.json(
          { 
            error: `Операция ${i + 1}: некорректные properties`,
            details: "properties должен быть объектом"
          },
          { status: 400 }
        );
      }
    }

    console.log(`[BATCH SUBMIT] ✅ Валидация пройдена: ${operations.length} операций`);

    // 4. КРИТИЧНО: Определение режима обработки с проверкой KV состояния
    const kvAvailable = isKVConnected();
    let processingMode = 'direct';
    let limits = LIMITS.DIRECT_PROCESSING;

    console.log(`[BATCH SUBMIT] 📊 Анализ режима обработки:`);
    console.log(`  - KV доступность: ${kvAvailable ? '✅ ДА' : '❌ НЕТ'}`);
    console.log(`  - Количество операций: ${operations.length}`);
    console.log(`  - Лимит прямой обработки: ${LIMITS.DIRECT_PROCESSING.maxOperations}`);

    // Принудительное использование KV, если запрошено
    const forceKV = options.forceKV === true || body.forceKV === true;

    if (forceKV) {
      if (!kvAvailable) {
        console.warn('[BATCH SUBMIT] ⚠️ KV принудительно запрошено, но недоступно');
        return NextResponse.json(
          {
            error: '❌ Cloudflare KV недоступно',
            suggestion: 'Проверьте настройки KV и переразверните приложение',
            kvStatus: 'unavailable',
            troubleshooting: {
              step1: '🔍 Проверьте диагностику: /api/kv/diagnostics',
              step2: '🔄 Переразверните: npm run cf:deploy',
              step3: '⏳ Подождите 2-3 минуты после развертывания',
              step4: '🔧 Проверьте настройки в Dashboard'
            }
          },
          { status: 503 }
        );
      }
      processingMode = 'kv_queue';
      limits = LIMITS.KV_QUEUE;
      console.log('[BATCH SUBMIT] 🎯 Принудительно выбран KV режим');
    } else if (operations.length > LIMITS.DIRECT_PROCESSING.maxOperations) {
      if (kvAvailable) {
        processingMode = 'kv_queue';
        limits = LIMITS.KV_QUEUE;
        console.log('[BATCH SUBMIT] 🔄 Автоматически выбран KV режим (большой объем)');
      } else {
        console.warn('[BATCH SUBMIT] ⚠️ Большой объем операций, но KV недоступно');
        return NextResponse.json(
          {
            error: `❌ Для обработки более ${LIMITS.DIRECT_PROCESSING.maxOperations} операций требуется Cloudflare KV`,
            details: "KV недоступно, переключение на прямую обработку невозможно",
            currentOperations: operations.length,
            maxDirectOperations: LIMITS.DIRECT_PROCESSING.maxOperations,
            kvStatus: 'unavailable',
            troubleshooting: {
              immediate: `⚡ Срочно: Оцените не более ${LIMITS.DIRECT_PROCESSING.maxOperations} навыков за раз`,
              setup: '🛠️ Настройка KV: /api/kv/diagnostics',
              help: '📞 Обратитесь к администратору если проблема не решается'
            }
          },
          { status: 503 }
        );
      }
    }

    console.log(`[BATCH SUBMIT] 🎯 ФИНАЛЬНЫЙ режим: ${processingMode}`);
    console.log(`[BATCH SUBMIT] 📊 KV статус: ${kvAvailable ? 'ДОСТУПЕН' : 'НЕДОСТУПЕН'}`);

    // Проверяем лимиты для выбранного режима
    if (operations.length > limits.maxOperations) {
      return NextResponse.json(
        {
          error: `❌ Слишком много операций для режима ${processingMode}`,
          details: {
            provided: operations.length,
            maxAllowed: limits.maxOperations,
            processingMode: processingMode,
            kvAvailable: kvAvailable,
            suggestion: `Разбейте операции на пакеты по ${limits.maxOperations} операций`
          }
        },
        { status: 400 }
      );
    }

    // 5. Настройка процессора
    const processorOptions = {
      batchSize: Math.min(options.batchSize || (operations.length <= 25 ? 25 : 50), 75),
      concurrency: Math.min(options.concurrency || 2, LIMITS.GENERAL.maxConcurrency),
      rateLimitDelay: Math.max(options.rateLimitDelay || 2500, LIMITS.GENERAL.minRateLimit),
      maxRetries: Math.min(options.maxRetries || 3, LIMITS.GENERAL.maxRetries),
      useKV: processingMode === 'kv_queue',
      reviewerUserId: payload.reviewerUserId,
      teamName: payload.teamName || 'unknown'
    };

    console.log('[BATCH SUBMIT] ⚙️ Настройки процессора:', processorOptions);

    // 6. КРИТИЧНО: Выполнение обработки
    if (processingMode === 'kv_queue') {
      console.log('[KV QUEUE] 🔄 Начинаем обработку через Cloudflare KV');
      try {
        // Создаем batch в KV
        const { batchId, jobIds } = await addBatchToKVQueue(operations, processorOptions);
        console.log(`[KV QUEUE] ✅ УСПЕХ! Создано задач: ${jobIds.length}, Batch ID: ${batchId}`);
        
        return NextResponse.json({
          success: true,
          mode: 'kv_queue',
          batchId: batchId,
          jobIds: jobIds,
          totalOperations: operations.length,
          totalJobs: jobIds.length,
          estimatedDuration: Math.ceil(operations.length * 3),
          message: `🎉 УСПЕШНО! Добавлено ${operations.length} операций в очередь KV. Создано ${jobIds.length} задач.`,
          statusEndpoint: `/api/batch/status?jobIds=${jobIds.join(',')}`,
          resultsEndpoint: `/api/batch/results?jobIds=${jobIds.join(',')}`,
          processorOptions: {
            batchSize: processorOptions.batchSize,
            concurrency: processorOptions.concurrency,
            rateLimitDelay: processorOptions.rateLimitDelay,
            useKV: true
          },
          instructions: {
            checkStatus: "Используйте statusEndpoint для проверки прогресса",
            getResults: "После завершения используйте resultsEndpoint для получения результатов",
            polling: "Проверяйте статус каждые 15-20 секунд"
          },
          kvDiagnostics: "Если возникнут проблемы, проверьте /api/kv/diagnostics"
        });
        
      } catch (kvError) {
        console.error('[KV QUEUE] ❌ КРИТИЧЕСКАЯ ошибка KV:', kvError.message);
        console.error('[KV QUEUE] Stack trace:', kvError.stack);
        
        // При ошибке KV переходим на прямую обработку если возможно
        if (operations.length <= LIMITS.DIRECT_PROCESSING.maxOperations) {
          console.log('[KV QUEUE] 🔄 ЭКСТРЕННОЕ переключение на прямую обработку');
          const directOptions = { ...processorOptions, useKV: false };
          return await handleDirectProcessing(operations, directOptions, 'kv_fallback');
        } else {
          return NextResponse.json(
            { 
              error: "❌ Cloudflare KV критически недоступно",
              details: kvError.message,
              suggestion: "Уменьшите количество операций для прямой обработки",
              fallbackMode: "direct_processing", 
              maxDirectOperations: LIMITS.DIRECT_PROCESSING.maxOperations,
              currentOperations: operations.length,
              diagnostics: "/api/kv/diagnostics"
            },
            { status: 503 }
          );
        }
      }
    } else {
      // Прямая обработка
      console.log('[DIRECT PROCESSING] 🔄 Используем прямую обработку');
      return await handleDirectProcessing(operations, processorOptions, 'direct');
    }

  } catch (error) {
    console.error('[BATCH SUBMIT] ❌ КРИТИЧЕСКАЯ ошибка:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    // Специальная обработка для известных типов ошибок
    if (error.message?.includes('KV')) {
      return NextResponse.json(
        { 
          error: "❌ Критическая ошибка Cloudflare KV",
          details: error.message,
          suggestion: "Проверьте диагностику KV",
          diagnostics: "/api/kv/diagnostics",
          fallbackMode: "direct_processing"
        },
        { status: 503 }
      );
    }

    if (error.status === 429) {
      return NextResponse.json(
        { 
          error: "⏱️ Превышен лимит запросов к Notion API",
          retryAfter: error.headers?.['retry-after'] || 60,
          suggestion: "Подождите указанное время перед повторной попыткой"
        },
        { status: 429 }
      );
    }

    if (error.status === 401 || error.status === 403) {
      return NextResponse.json(
        { 
          error: "🔐 Ошибка авторизации при работе с Notion API",
          suggestion: "Проверьте настройки токена Notion и права доступа"
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        error: process.env.NODE_ENV === 'development' 
          ? `❌ Внутренняя ошибка: ${error.message}`
          : "❌ Внутренняя ошибка сервера. Попробуйте позже.",
        requestId: Date.now().toString(36),
        diagnostics: "/api/kv/diagnostics"
      },
      { status: 500 }
    );
  }
}

// УЛУЧШЕННАЯ функция для прямой обработки
async function handleDirectProcessing(operations, options, reason = 'direct') {
  console.log(`[DIRECT PROCESSING] 🚀 Причина: ${reason}, операций: ${operations.length}`);
  
  try {
    const processor = new NotionBatchProcessor(notion, options);
    const result = await processor.processBatchDirectly(operations);
    
    const successRate = result.stats.totalOperations > 0 ?
      (result.stats.successful / result.stats.totalOperations * 100).toFixed(1) : 0;

    const message = reason === 'kv_fallback' 
      ? `🔄 KV недоступно, выполнена прямая обработка. Успешно: ${result.stats.successful}/${result.stats.totalOperations} (${successRate}%). Время: ${(result.stats.duration / 1000).toFixed(1)}с.`
      : `✅ Прямая обработка завершена! Успешно: ${result.stats.successful}/${result.stats.totalOperations} (${successRate}%). Время: ${(result.stats.duration / 1000).toFixed(1)}с.`;

    return NextResponse.json({
      success: true,
      mode: reason === 'kv_fallback' ? 'direct_processing_fallback' : 'direct_processing',
      results: result.results,
      stats: result.stats,
      message: message,
      completed: true,
      timestamp: new Date().toISOString(),
      kvFallback: reason === 'kv_fallback'
    });
    
  } catch (directError) {
    console.error('[DIRECT PROCESSING] ❌ Ошибка прямой обработки:', directError.message);
    
    return NextResponse.json(
      {
        error: "❌ Ошибка при прямой обработке операций",
        details: directError.message,
        mode: 'direct_processing_failed',
        suggestion: "Попробуйте уменьшить количество операций или повторите позже"
      },
      { status: 500 }
    );
  }
}

// Расширенный диагностический endpoint
export async function GET(req, context) {
  console.log('[BATCH SUBMIT] 🔍 Диагностический запрос');
  
  // Инициализация KV для диагностики
  const kvInitResult = initKV(context);
  
  return NextResponse.json({
    service: "Notion Batch Processing API",
    status: "operational",
    runtime: "edge",
    timestamp: new Date().toISOString(),
    
    kv: {
      available: isKVConnected(),
      initialized: kvInitResult,
      diagnosticsUrl: "/api/kv/diagnostics"
    },
    
    context: {
      provided: !!context,
      hasEnv: !!context?.env,
      envKeys: context?.env ? Object.keys(context.env) : [],
      hasKVInEnv: !!context?.env?.NOTION_QUEUE_KV,
      hasBindings: !!context?.bindings,
      bindingsKeys: context?.bindings ? Object.keys(context.bindings) : []
    },
    
    limits: LIMITS,
    
    env: {
      hasNotionToken: !!process.env.NOTION_TOKEN,
      hasJWTSecret: !!process.env.JWT_SECRET,
      notionQueueKV: typeof NOTION_QUEUE_KV !== 'undefined' ? 'available' : 'not_bound'
    },
    
    endpoints: {
      submit: "/api/batch/submit",
      status: "/api/batch/status", 
      results: "/api/batch/results",
      diagnostics: "/api/kv/diagnostics"
    },
    
    troubleshooting: {
      kvUnavailable: "🔍 Проверьте /api/kv/diagnostics",
      rateLimits: "Уменьшите concurrency и увеличьте rateLimitDelay",
      largeOperations: "Настройте KV для операций > 10",
      deployment: "🔄 Переразверните: npm run cf:deploy"
    },
    
    quickChecks: {
      contextOk: !!context && !!context.env,
      kvInContext: !!context?.env?.NOTION_QUEUE_KV,
      kvConnected: isKVConnected(),
      readyForLargeOperations: isKVConnected()
    }
  });
}