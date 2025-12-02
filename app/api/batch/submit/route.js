// app/api/batch/submit/route.js - ИСПРАВЛЕННАЯ версия с правильным использованием KV
export const runtime = "edge";

import { NextResponse } from "next/server";
import { verifyReviewToken } from "@/lib/token";
import { BatchSubmitRequest } from "@/lib/schema";
import {
  NotionBatchProcessor,
  addBatchToKVQueue,
  isKVConnected,
  initKV
} from "@/lib/kv-queue";
import { notion } from "@/lib/notion";

// Обновленные лимиты безопасности
const LIMITS = {
  DIRECT_PROCESSING: {
    maxOperations: 15,  // Уменьшено для стабильности
    maxOperationSize: 8000
  },
  KV_QUEUE: {
    maxOperations: 500,  // Разумный лимит для KV
    maxOperationSize: 10000
  },
  GENERAL: {
    maxConcurrency: 2,   // Консервативно для Notion API
    minRateLimit: 2500,  // Увеличенная задержка
    maxRetries: 3
  }
};

export async function POST(req) {
  console.log('[BATCH SUBMIT] ===== 🚀 Новый запрос на batch обработку =====');
  
  // Инициализация KV (просто помечаем готовность)
  initKV();
  
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

    // 3. Валидация операций с использованием Zod
    const validationResult = BatchSubmitRequest.safeParse(body);

    if (!validationResult.success) {
      console.error('[BATCH SUBMIT] ❌ Ошибка валидации:', validationResult.error.issues);
      return NextResponse.json(
        {
          error: "Некорректные данные запроса",
          details: validationResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join("; ")
        },
        { status: 400 }
      );
    }

    const { operations, options = {} } = validationResult.data;
    console.log(`[BATCH SUBMIT] ✅ Валидация пройдена: ${operations.length} операций`);

    // 4. Определение режима обработки
    let kvAvailable = false;
    try {
      kvAvailable = await isKVConnected();
      console.log(`[BATCH SUBMIT] 📊 KV доступность: ${kvAvailable ? '✅ ДА' : '❌ НЕТ'}`);
    } catch (kvError) {
      console.warn(`[BATCH SUBMIT] ⚠️ Ошибка проверки KV: ${kvError.message}`);
      kvAvailable = false;
    }

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
              step1: '🔍 Проверьте наличие wrangler.toml в корне проекта',
              step2: '🔧 Создайте KV namespace: npx wrangler kv namespace create "NOTION_QUEUE_KV"',
              step3: '🔄 Переразверните: npm run cf:deploy',
              step4: '⏳ Подождите 2-3 минуты после развертывания'
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
            details: "KV недоступно, используйте прямую обработку с меньшим количеством операций",
            currentOperations: operations.length,
            maxDirectOperations: LIMITS.DIRECT_PROCESSING.maxOperations,
            kvStatus: 'unavailable',
            suggestions: [
              `⚡ Срочно: Оцените не более ${LIMITS.DIRECT_PROCESSING.maxOperations} навыков за раз`,
              '🛠️ Настройте KV для больших объемов: см. wrangler.toml',
              '📞 Обратитесь к администратору если проблема не решается'
            ]
          },
          { status: 503 }
        );
      }
    }

    console.log(`[BATCH SUBMIT] 🎯 ФИНАЛЬНЫЙ режим: ${processingMode}`);

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
      batchSize: Math.min(options.batchSize || 20, 25),  // Консервативный размер
      concurrency: Math.min(options.concurrency || 2, LIMITS.GENERAL.maxConcurrency),
      rateLimitDelay: Math.max(options.rateLimitDelay || 2500, LIMITS.GENERAL.minRateLimit),
      maxRetries: Math.min(options.maxRetries || 3, LIMITS.GENERAL.maxRetries),
      useKV: processingMode === 'kv_queue',
      reviewerUserId: payload.reviewerUserId,
      teamName: payload.teamName || 'unknown'
    };

    console.log('[BATCH SUBMIT] ⚙️ Настройки процессора:', processorOptions);

    // 6. Выполнение обработки
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
          estimatedDuration: Math.ceil(operations.length * 2.5), // Консервативная оценка
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
            polling: "Проверяйте статус каждые 10-15 секунд"
          }
        });
        
      } catch (kvError) {
        console.error('[KV QUEUE] ❌ КРИТИЧЕСКАЯ ошибка KV:', kvError.message);
        
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
              currentOperations: operations.length
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
          suggestion: "Проверьте конфигурацию wrangler.toml и переразверните приложение",
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
        requestId: Date.now().toString(36)
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

// Диагностический endpoint
export async function GET(req) {
  console.log('[BATCH SUBMIT] 🔍 Диагностический запрос');
  
  // Инициализация для диагностики
  initKV();
  
  let kvStatus = 'unknown';
  try {
    kvStatus = await isKVConnected() ? 'available' : 'unavailable';
  } catch (error) {
    kvStatus = `error: ${error.message}`;
  }
  
  return NextResponse.json({
    service: "Notion Batch Processing API",
    status: "operational",
    runtime: "edge",
    timestamp: new Date().toISOString(),
    
    kv: {
      status: kvStatus,
      available: kvStatus === 'available'
    },
    
    limits: LIMITS,
    
    environment: {
      hasNotionToken: !!process.env.NOTION_TOKEN,
      hasJWTSecret: !!process.env.JWT_SECRET,
      nodeEnv: process.env.NODE_ENV
    },
    
    endpoints: {
      submit: "/api/batch/submit",
      status: "/api/batch/status", 
      results: "/api/batch/results",
      diagnostics: "/api/kv/diagnostics"
    },
    
    quickChecks: {
      kvConnected: kvStatus === 'available',
      readyForLargeOperations: kvStatus === 'available'
    },
    
    recommendations: kvStatus !== 'available' ? [
      "1. Создайте KV namespace: npx wrangler kv namespace create 'NOTION_QUEUE_KV'",
      "2. Добавьте полученные ID в wrangler.toml",
      "3. Переразверните приложение: npm run cf:deploy", 
      "4. Подождите 2-3 минуты после развертывания"
    ] : [
      "✅ KV работает корректно",
      "🚀 Готово для обработки больших объемов данных"
    ]
  });
}