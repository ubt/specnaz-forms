// app/api/batch/submit/route.js - ИСПРАВЛЕННЫЙ API endpoint для batch операций
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
  console.log('[BATCH SUBMIT] ===== Новый запрос на batch обработку =====');
  
  // ИСПРАВЛЕНИЕ: Инициализация KV БЕЗ context.env - используем глобальные переменные
  try {
    // В Cloudflare Pages KV доступен как глобальная переменная NOTION_QUEUE_KV
    const kvInitResult = initKV();  // Убираем context.env
    console.log(`[BATCH SUBMIT] KV инициализация: ${kvInitResult ? 'успешно' : 'неудачно'}`);
  } catch (initError) {
    console.warn('[BATCH SUBMIT] Ошибка инициализации KV:', initError.message);
  }
  
  try {
    // 1. Парсинг и валидация входных данных
    let body;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error('[BATCH SUBMIT] Ошибка парсинга JSON:', parseError.message);
      return NextResponse.json(
        { 
          error: "Некорректный JSON в теле запроса",
          details: "Проверьте формат отправляемых данных"
        },
        { status: 400 }
      );
    }

    console.log(`[BATCH SUBMIT] Получены данные: ${Object.keys(body).join(', ')}`);

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
      console.log('[BATCH SUBMIT] Токен верифицирован для пользователя:', payload.reviewerUserId);
    } catch (tokenError) {
      console.error('[BATCH SUBMIT] Ошибка верификации токена:', tokenError.message);
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

    console.log(`[BATCH SUBMIT] Валидация пройдена: ${operations.length} операций`);

    // 4. ИСПРАВЛЕНИЕ: Определение режима обработки с правильной проверкой KV
    const kvAvailable = isKVConnected();
    let processingMode = 'direct';
    let limits = LIMITS.DIRECT_PROCESSING;

    console.log(`[BATCH SUBMIT] KV доступность: ${kvAvailable}`);
    console.log(`[BATCH SUBMIT] Количество операций: ${operations.length}`);

    // Принудительное использование KV, если запрошено
    const forceKV = options.forceKV === true || body.forceKV === true;

    if (forceKV) {
      if (!kvAvailable) {
        console.warn('[BATCH SUBMIT] KV принудительно запрошено, но недоступно');
        return NextResponse.json(
          {
            error: 'Cloudflare KV недоступно',
            suggestion: 'Убедитесь, что KV namespace привязан или уберите параметр forceKV',
            kvStatus: 'unavailable',
            troubleshooting: {
              step1: 'Проверьте wrangler.toml: binding = "NOTION_QUEUE_KV"',
              step2: 'Убедитесь что KV namespace создан в Cloudflare Dashboard',
              step3: 'Переразверните приложение: npm run cf:deploy'
            }
          },
          { status: 503 }
        );
      }
      processingMode = 'kv_queue';
      limits = LIMITS.KV_QUEUE;
    } else if (operations.length > LIMITS.DIRECT_PROCESSING.maxOperations) {
      if (kvAvailable) {
        processingMode = 'kv_queue';
        limits = LIMITS.KV_QUEUE;
        console.log('[BATCH SUBMIT] Автоматически выбран KV режим из-за большого объема');
      } else {
        console.warn('[BATCH SUBMIT] Большой объем, но KV недоступно');
        return NextResponse.json(
          {
            error: `Для обработки более ${LIMITS.DIRECT_PROCESSING.maxOperations} операций требуется Cloudflare KV (Система автоматически переключилась на прямую обработку)`,
            suggestion: 'Уменьшите количество операций или настройте Cloudflare KV',
            currentOperations: operations.length,
            maxDirectOperations: LIMITS.DIRECT_PROCESSING.maxOperations,
            kvStatus: 'unavailable',
            troubleshooting: {
              immediate: `Оцените не более ${LIMITS.DIRECT_PROCESSING.maxOperations} навыков за раз`,
              longTerm: 'Настройте Cloudflare KV для обработки больших объемов'
            }
          },
          { status: 503 }
        );
      }
    }

    console.log(`[BATCH SUBMIT] Режим обработки: ${processingMode}, KV доступен: ${kvAvailable}`);

    // Проверяем лимиты для выбранного режима
    if (operations.length > limits.maxOperations) {
      return NextResponse.json(
        {
          error: `Слишком много операций для режима ${processingMode}`,
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

    console.log('[BATCH SUBMIT] Настройки процессора:', processorOptions);

    // 6. ИСПРАВЛЕНИЕ: Выполнение обработки в зависимости от режима
    if (processingMode === 'kv_queue') {
      console.log('[KV QUEUE] Начинаем обработку через Cloudflare KV');
      try {
        // Создаем batch в KV
        const { batchId, jobIds } = await addBatchToKVQueue(operations, processorOptions);
        console.log(`[KV QUEUE] Создано задач: ${jobIds.length}, Batch ID: ${batchId}`);
        
        return NextResponse.json({
          success: true,
          mode: 'kv_queue',
          batchId: batchId,
          jobIds: jobIds,
          totalOperations: operations.length,
          totalJobs: jobIds.length,
          estimatedDuration: Math.ceil(operations.length * 3),
          message: `Добавлено ${operations.length} операций в очередь KV. Создано ${jobIds.length} задач.`,
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
          }
        });
        
      } catch (kvError) {
        console.error('[KV QUEUE] Ошибка KV, переключаемся на прямую обработку:', kvError.message);
        
        // При ошибке KV переходим на прямую обработку
        if (operations.length <= LIMITS.DIRECT_PROCESSING.maxOperations) {
          console.log('[KV QUEUE] Принудительно переключаемся на прямую обработку');
          const directOptions = { ...processorOptions, useKV: false };
          return await handleDirectProcessing(operations, directOptions);
        } else {
          return NextResponse.json(
            { 
              error: "Cloudflare KV временно недоступно",
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
      return await handleDirectProcessing(operations, processorOptions);
    }

  } catch (error) {
    console.error('[BATCH SUBMIT] Критическая ошибка:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    // Специальная обработка для известных типов ошибок
    if (error.message?.includes('KV')) {
      return NextResponse.json(
        { 
          error: "Сервис очередей Cloudflare KV временно недоступен",
          suggestion: "Попробуйте уменьшить количество операций для прямой обработки",
          fallbackMode: "direct_processing",
          maxDirectOperations: LIMITS.DIRECT_PROCESSING.maxOperations
        },
        { status: 503 }
      );
    }

    if (error.status === 429) {
      return NextResponse.json(
        { 
          error: "Превышен лимит запросов к Notion API",
          retryAfter: error.headers?.['retry-after'] || 60,
          suggestion: "Подождите указанное время перед повторной попыткой"
        },
        { status: 429 }
      );
    }

    if (error.status === 401 || error.status === 403) {
      return NextResponse.json(
        { 
          error: "Ошибка авторизации при работе с Notion API",
          suggestion: "Проверьте настройки токена Notion и права доступа"
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        error: process.env.NODE_ENV === 'development' 
          ? `Внутренняя ошибка: ${error.message}`
          : "Внутренняя ошибка сервера. Попробуйте позже.",
        requestId: Date.now().toString(36)
      },
      { status: 500 }
    );
  }
}

// ИСПРАВЛЕНИЕ: Вспомогательная функция для прямой обработки
async function handleDirectProcessing(operations, options) {
  console.log('[DIRECT PROCESSING] Начинаем прямую обработку');
  
  try {
    const processor = new NotionBatchProcessor(notion, options);
    const result = await processor.processBatchDirectly(operations);
    
    const successRate = result.stats.totalOperations > 0 ?
      (result.stats.successful / result.stats.totalOperations * 100).toFixed(1) : 0;

    return NextResponse.json({
      success: true,
      mode: 'direct_processing',
      results: result.results,
      stats: result.stats,
      message: `Прямая обработка завершена! Успешно: ${result.stats.successful}/${result.stats.totalOperations} (${successRate}%). Время: ${(result.stats.duration / 1000).toFixed(1)}с.`,
      completed: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (directError) {
    console.error('[DIRECT PROCESSING] Ошибка прямой обработки:', directError.message);
    
    return NextResponse.json(
      {
        error: "Ошибка при прямой обработке операций",
        details: directError.message,
        mode: 'direct_processing_failed',
        suggestion: "Попробуйте уменьшить количество операций или повторите позже"
      },
      { status: 500 }
    );
  }
}

// Диагностический endpoint
export async function GET(req, context) {
  // Инициализация KV для диагностики
  const kvInitResult = initKV();
  
  return NextResponse.json({
    service: "Notion Batch Processing API",
    status: "operational",
    runtime: "edge",
    kvAvailable: isKVConnected(),
    kvInitialized: kvInitResult,
    limits: LIMITS,
    env: {
      hasNotionToken: !!process.env.NOTION_TOKEN,
      hasJWTSecret: !!process.env.JWT_SECRET,
      notionQueueKV: typeof NOTION_QUEUE_KV !== 'undefined' ? 'available' : 'not_bound'
    },
    endpoints: {
      submit: "/api/batch/submit",
      status: "/api/batch/status",
      results: "/api/batch/results"
    },
    troubleshooting: {
      kvUnavailable: "Проверьте привязку KV namespace в wrangler.toml",
      rateLimits: "Уменьшите concurrency и увеличьте rateLimitDelay",
      largeOperations: "Используйте KV режим для операций > 10"
    },
    timestamp: new Date().toISOString()
  });
}