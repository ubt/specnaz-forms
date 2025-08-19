// app/api/batch/submit/route.js - API endpoint для отправки больших batch операций через Cloudflare KV
export const runtime = "edge";

import { NextResponse } from "next/server";
import { verifyReviewToken } from "@/lib/token";
import { NotionBatchProcessor, addBatchToKVQueue, isKVConnected } from "@/lib/kv-queue";
import { notion } from "@/lib/notion";

// Лимиты безопасности для разных режимов обработки
const LIMITS = {
  DIRECT_PROCESSING: {
    maxOperations: 5,      // Максимум операций для прямой обработки
    maxOperationSize: 8000   // Максимальный размер одной операции (символы)
  },
  KV_QUEUE: {
    maxOperations: 2000,     // Максимум операций через KV очереди
    maxOperationSize: 10000  // Максимальный размер одной операции (символы)
  },
  GENERAL: {
    maxConcurrency: 5,       // Максимальная одновременность
    minRateLimit: 1000,      // Минимальная задержка между запросами (мс)
    maxRetries: 5            // Максимальное количество попыток
  }
};

export async function POST(req) {
  console.log('[BATCH SUBMIT] ===== Новый запрос на batch обработку =====');
  
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
    const { operations, options = {} } = body;
    
    if (!operations || !Array.isArray(operations)) {
      return NextResponse.json(
        { 
          error: "Поле 'operations' обязательно и должно быть массивом",
          example: { operations: [{ pageId: "page_id", properties: { "Field": { number: 5 } } }] }
        },
        { status: 400 }
      );
    }

    if (operations.length === 0) {
      return NextResponse.json(
        { error: "Массив операций не может быть пустым" },
        { status: 400 }
      );
    }

    console.log(`[BATCH SUBMIT] Количество операций: ${operations.length}`);

    // 4. Определение режима обработки и проверка лимитов
    const kvAvailable = isKVConnected();
    let processingMode = 'direct';
    let limits = LIMITS.DIRECT_PROCESSING;

    // Принудительное использование KV, если запрошено
    const forceKV = options.forceKV === true || body.forceKV === true;

    // Выбираем режим обработки на основе размера и доступности KV
    if (kvAvailable && (operations.length > LIMITS.DIRECT_PROCESSING.maxOperations || forceKV)) {
      processingMode = 'kv_queue';
      limits = LIMITS.KV_QUEUE;
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

    // 5. Детальная валидация операций
    const validationErrors = [];
    const sampleSize = Math.min(operations.length, 50); // Проверяем максимум 50 операций для производительности
    
    for (let i = 0; i < sampleSize; i++) {
      const operation = operations[i];
      const operationNum = i + 1;
      
      // Проверка pageId
      if (!operation.pageId || typeof operation.pageId !== 'string') {
        validationErrors.push(`Операция ${operationNum}: отсутствует или некорректен pageId`);
        continue;
      }
      
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(operation.pageId)) {
        validationErrors.push(`Операция ${operationNum}: pageId должен быть в формате UUID`);
      }
      
      // Проверка properties
      if (!operation.properties || typeof operation.properties !== 'object') {
        validationErrors.push(`Операция ${operationNum}: отсутствует или некорректен объект properties`);
        continue;
      }
      
      if (Object.keys(operation.properties).length === 0) {
        validationErrors.push(`Операция ${operationNum}: объект properties не может быть пустым`);
      }
      
      // Проверка размера операции
      const operationSize = JSON.stringify(operation).length;
      if (operationSize > limits.maxOperationSize) {
        validationErrors.push(`Операция ${operationNum}: слишком большой размер (${operationSize} символов, максимум: ${limits.maxOperationSize})`);
      }
      
      // Останавливаемся если слишком много ошибок
      if (validationErrors.length >= 15) {
        validationErrors.push(`... и еще ${Math.max(0, operations.length - sampleSize)} операций не проверены`);
        break;
      }
    }

    if (validationErrors.length > 0) {
      return NextResponse.json(
        { 
          error: "Ошибки валидации операций",
          validationErrors: validationErrors,
          checkedOperations: sampleSize,
          totalOperations: operations.length
        },
        { status: 400 }
      );
    }

    console.log('[BATCH SUBMIT] Валидация операций пройдена успешно');

    // 6. Подготовка настроек процессора
    const processorOptions = {
      batchSize: Math.min(options.batchSize || 50, 100),
      concurrency: Math.min(options.concurrency || 3, LIMITS.GENERAL.maxConcurrency),
      rateLimitDelay: Math.max(options.rateLimitDelay || 2000, LIMITS.GENERAL.minRateLimit),
      maxRetries: Math.min(options.maxRetries || 3, LIMITS.GENERAL.maxRetries),
      useKV: processingMode === 'kv_queue',
      reviewerUserId: payload.reviewerUserId,
      teamName: payload.teamName || 'unknown'
    };

    console.log('[BATCH SUBMIT] Настройки процессора:', processorOptions);

    // 7. Выполнение обработки в зависимости от режима
    if (processingMode === 'kv_queue') {
      return await handleKVQueueProcessing(operations, processorOptions);
    } else {
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
          suggestion: "Попробуйте уменьшить количество операций для прямой обработки (до 100 операций)",
          fallbackMode: "direct_processing"
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
        timestamp: new Date().toISOString(),
        requestInfo: {
          operationCount: body?.operations?.length || 0,
          kvAvailable: isKVConnected(),
          mode: processingMode
        }
      },
      { status: 500 }
    );
  }
}

// Обработка через Cloudflare KV очереди
async function handleKVQueueProcessing(operations, options) {
  console.log('[KV QUEUE] Начинаем обработку через Cloudflare KV очереди');
  
  try {
    // Добавляем операции в KV очередь
    const { batchId, jobIds } = await addBatchToKVQueue(operations, options);
    
    console.log(`[KV QUEUE] Создано ${jobIds.length} задач в очереди KV. Batch ID: ${batchId}`);

    // Запускаем фоновую обработку
    const processor = new NotionBatchProcessor(notion, options);
    
    // Не ждем завершения - обработка идет в фоне
    processor.processKVJobs(jobIds, null).catch(error => {
      console.error('[KV QUEUE] Ошибка фоновой обработки:', error.message);
    });

    return NextResponse.json({
      success: true,
      mode: 'kv_queue',
      batchId: batchId,
      jobIds: jobIds,
      totalOperations: operations.length,
      totalJobs: jobIds.length,
      estimatedDuration: Math.ceil(operations.length * 2.5), // ~2.5 секунды на операцию
      message: `Добавлено ${operations.length} операций в очередь KV. Создано ${jobIds.length} задач.`,
      statusEndpoint: `/api/batch/status?jobIds=${jobIds.join(',')}`,
      resultsEndpoint: `/api/batch/results?jobIds=${jobIds.join(',')}`,
      processorOptions: {
        batchSize: options.batchSize,
        concurrency: options.concurrency,
        rateLimitDelay: options.rateLimitDelay,
        useKV: true
      },
      instructions: {
        checkStatus: "Используйте statusEndpoint для проверки прогресса",
        getResults: "После завершения используйте resultsEndpoint для получения результатов",
        polling: "Рекомендуется проверять статус каждые 10-15 секунд"
      }
    });

  } catch (kvError) {
    console.error('[KV QUEUE] Ошибка KV, переходим к прямой обработке:', kvError.message);
    
    // Fallback к прямой обработке
    return await handleDirectProcessing(operations, {
      ...options,
      useKV: false
    });
  }
}

// Прямая обработка без очередей
async function handleDirectProcessing(operations, options) {
  console.log('[DIRECT] Начинаем прямую обработку');
  
  const processor = new NotionBatchProcessor(notion, options);
  const startTime = Date.now();
  
  try {
    const results = await processor.processBatch(operations, (progress) => {
      console.log(`[DIRECT] Прогресс: ${progress.processed}/${progress.total} (${progress.progress.toFixed(1)}%)`);
    });

    const duration = Date.now() - startTime;
    const successCount = results.results?.filter(r => r.status === 'success').length || 0;
    const errorCount = results.results?.filter(r => r.status === 'error').length || 0;

    console.log(`[DIRECT] Завершено за ${duration}ms. Успешно: ${successCount}, Ошибок: ${errorCount}`);

    return NextResponse.json({
      success: true,
      mode: 'direct_processing',
      results: results.results || [],
      stats: {
        totalOperations: operations.length,
        successful: successCount,
        failed: errorCount,
        duration: duration,
        averageTimePerOperation: duration / operations.length,
        processingRate: (operations.length / duration * 1000).toFixed(2) // операций в секунду
      },
      message: `Прямая обработка завершена. Успешно: ${successCount}, Ошибок: ${errorCount}`,
      processorOptions: {
        batchSize: options.batchSize,
        concurrency: options.concurrency,
        rateLimitDelay: options.rateLimitDelay,
        useKV: false
      },
      performance: {
        totalDuration: `${(duration / 1000).toFixed(1)} секунд`,
        averagePerOperation: `${(duration / operations.length).toFixed(0)} мс/операция`,
        throughput: `${(operations.length / duration * 1000).toFixed(1)} операций/сек`
      }
    });

  } catch (processingError) {
    console.error('[DIRECT] Ошибка прямой обработки:', processingError.message);
    
    return NextResponse.json(
      {
        error: "Ошибка при прямой обработке операций",
        details: processingError.message,
        partialResults: processingError.partialResults || [],
        processingMode: "direct",
        suggestions: [
          "Попробуйте уменьшить размер пакета (batchSize)",
          "Уменьшите одновременность (concurrency)",
          "Увеличьте задержку между запросами (rateLimitDelay)"
        ]
      },
      { status: 500 }
    );
  }
}

// GET endpoint для получения информации о возможностях системы
export async function GET() {
  return NextResponse.json({
    service: "Notion Batch Operations API",
    version: "2.0.0",
    capabilities: {
      kvQueues: isKVConnected(),
      directProcessing: true,
      maxOperationsKV: LIMITS.KV_QUEUE.maxOperations,
      maxOperationsDirect: LIMITS.DIRECT_PROCESSING.maxOperations,
      supportedMethods: ["POST"]
    },
    limits: LIMITS,
    endpoints: {
      submit: "/api/batch/submit",
      status: "/api/batch/status",
      results: "/api/batch/results"
    },
    documentation: {
      requestFormat: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer <review_token>"
        },
        body: {
          operations: [
            {
              pageId: "page-uuid",
              properties: {
                "Field_Name": { "number": 5 }
              }
            }
          ],
          options: {
            batchSize: 50,
            concurrency: 3,
            rateLimitDelay: 2000,
            maxRetries: 3
          }
        }
      },
      statusCodes: {
        200: "Операции успешно обработаны или добавлены в очередь",
        400: "Ошибка валидации входных данных",
        401: "Ошибка авторизации",
        429: "Превышен лимит запросов",
        500: "Внутренняя ошибка сервера",
        503: "Сервис очередей недоступен"
      }
    },
    timestamp: new Date().toISOString()
  });
}