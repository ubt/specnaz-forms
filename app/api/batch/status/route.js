// app/api/batch/status/route.js - Исправленный API endpoint для проверки статуса batch операций
export const runtime = "edge";

import { NextResponse } from "next/server";
import { getKVBatchStatus, isKVConnected, initKV } from "@/lib/kv-queue";

// Кэш для статусов (уменьшенный TTL для лучшей отзывчивости)
const statusCache = new Map();
const CACHE_TTL = 2000; // 2 секунды для быстрого обновления

export async function GET(req, context) {
  // ИСПРАВЛЕНИЕ: Правильная инициализация KV
  const kvInitResult = initKV(context?.env || {});
  console.log(`[BATCH STATUS] KV инициализация: ${kvInitResult ? 'успешно' : 'неудачно'}`);
  
  console.log('[BATCH STATUS] Получен GET запрос на проверку статуса');
  
  try {
    const url = new URL(req.url);
    const jobIds = url.searchParams.get('jobIds');
    const detailed = url.searchParams.get('detailed') === 'true';
    const clearCache = url.searchParams.get('clearCache') === 'true';
    const includeResults = url.searchParams.get('includeResults') === 'true';
    
    // Очистка кэша если запрошена
    if (clearCache) {
      statusCache.clear();
      console.log('[BATCH STATUS] Кэш очищен по запросу');
    }

    // Валидация параметров
    if (!jobIds) {
      return NextResponse.json(
        { 
          error: "Параметр 'jobIds' обязателен",
          usage: "Укажите ID задач через запятую: ?jobIds=job1,job2,job3",
          example: "/api/batch/status?jobIds=job_123,job_456&detailed=true",
          kvStatus: isKVConnected() ? 'available' : 'unavailable'
        },
        { status: 400 }
      );
    }

    const jobIdArray = jobIds.split(',').map(id => id.trim()).filter(Boolean);
    
    if (jobIdArray.length === 0) {
      return NextResponse.json(
        { error: "Не указаны корректные ID задач" },
        { status: 400 }
      );
    }

    if (jobIdArray.length > 50) { // Уменьшен лимит для стабильности
      return NextResponse.json(
        { 
          error: "Слишком много ID задач",
          details: `Предоставлено: ${jobIdArray.length}, максимум: 50`,
          suggestion: "Разбейте запрос на несколько частей"
        },
        { status: 400 }
      );
    }

    console.log(`[BATCH STATUS] Проверяем статус ${jobIdArray.length} задач`);

    // ИСПРАВЛЕНИЕ: Более надежная проверка доступности KV
    if (!isKVConnected()) {
      return NextResponse.json({
        error: "Cloudflare KV недоступно",
        message: "Сервис очередей временно недоступен. Статус задач невозможно получить.",
        kvConnected: false,
        jobIds: jobIdArray,
        possibleCauses: [
          "KV namespace не привязан к Functions",
          "Неправильная конфигурация wrangler.toml",
          "KV namespace не создан в Cloudflare Dashboard"
        ],
        fallbackSuggestion: "Используйте прямую обработку для новых операций",
        troubleshooting: {
          checkBinding: "Проверьте NOTION_QUEUE_KV в wrangler.toml",
          checkNamespace: "Убедитесь что KV namespace создан",
          checkDeployment: "Переразверните приложение после изменений"
        }
      }, { status: 503 });
    }

    // Проверяем кэш
    const cacheKey = `status_${jobIdArray.sort().join('_')}_${detailed}_${includeResults}`;
    const cached = statusCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('[BATCH STATUS] Возвращаем закэшированный результат');
      return NextResponse.json({
        ...cached.data,
        cached: true,
        cacheAge: Date.now() - cached.timestamp
      });
    }

    // ИСПРАВЛЕНИЕ: Получаем статусы задач из KV с обработкой ошибок
    let statuses;
    try {
      console.log(`[BATCH STATUS] Запрашиваем статусы для ${jobIdArray.length} задач из KV`);
      statuses = await getKVBatchStatus(jobIdArray);
      
      if (!statuses) {
        console.warn('[BATCH STATUS] getKVBatchStatus вернул null');
        throw new Error('Не удалось получить статусы из KV');
      }
      
      console.log(`[BATCH STATUS] Получено ${statuses.length} статусов из KV`);
    } catch (kvError) {
      console.error('[BATCH STATUS] Ошибка KV:', kvError.message);
      
      return NextResponse.json({
        error: "Ошибка получения статуса из Cloudflare KV",
        details: kvError.message,
        jobIds: jobIdArray,
        kvConnected: isKVConnected(),
        timestamp: new Date().toISOString(),
        possibleCauses: [
          "Задачи не существуют в KV",
          "Данные устарели и были удалены", 
          "Временная проблема с KV доступом",
          "Неправильные Job IDs"
        ],
        suggestions: [
          "Проверьте корректность Job IDs",
          "Попробуйте позже (данные могут еще загружаться)",
          "Создайте новые batch операции"
        ]
      }, { status: 503 });
    }

    if (statuses.length === 0) {
      return NextResponse.json({
        error: "Не найдено задач с указанными ID",
        jobIds: jobIdArray,
        kvConnected: isKVConnected(),
        possibleCauses: [
          "Задачи не существуют",
          "Данные устарели и были удалены",
          "Неправильные Job IDs"
        ]
      }, { status: 404 });
    }

    // Анализируем статусы
    const analysis = analyzeJobStatuses(statuses);
    
    // Подготавливаем основной ответ
    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      kvConnected: isKVConnected(),
      totalJobs: statuses.length,
      requestedJobs: jobIdArray.length,
      foundJobs: statuses.filter(s => s.status !== 'not_found').length,
      ...analysis
    };

    // Добавляем список задач (detailed или краткий)
    if (detailed) {
      response.jobs = statuses;
      response.detailedAnalysis = await getDetailedAnalysis(statuses);
    } else {
      response.jobs = statuses.map(job => ({
        id: job.id,
        status: job.status,
        progress: job.progress || 0,
        processed: job.processed || 0,
        total: job.total || 0,
        error: job.error ? job.error.substring(0, 100) : undefined
      }));
    }

    // ИСПРАВЛЕНИЕ: Добавляем результаты если запрошены и есть завершенные задачи
    if (includeResults && analysis.completedJobs > 0) {
      try {
        const { getKVBatchResults } = await import("@/lib/kv-queue");
        const completedJobIds = statuses
          .filter(job => job.status === 'completed')
          .map(job => job.id);
        
        if (completedJobIds.length > 0) {
          console.log(`[BATCH STATUS] Загружаем результаты для ${completedJobIds.length} завершенных задач`);
          const results = await getKVBatchResults(completedJobIds);
          response.results = results;
          response.resultsCount = results ? results.length : 0;
          
          if (results) {
            response.resultsSummary = {
              total: results.length,
              successful: results.filter(r => r.status === 'success').length,
              failed: results.filter(r => r.status === 'error').length
            };
          }
        }
      } catch (resultsError) {
        console.error('[BATCH STATUS] Ошибка получения результатов:', resultsError.message);
        response.resultsError = "Не удалось загрузить результаты";
        response.resultsErrorDetails = resultsError.message;
      }
    }

    // Добавляем рекомендации и следующие шаги
    response.recommendations = generateRecommendations(analysis, statuses);
    response.nextSteps = generateNextSteps(analysis);

    // Кэшируем результат
    statusCache.set(cacheKey, {
      data: response,
      timestamp: Date.now()
    });

    // Очищаем старые записи кэша
    cleanupStatusCache();

    console.log(`[BATCH STATUS] Статус получен. Завершено: ${analysis.completedJobs}/${statuses.length}, Общий прогресс: ${analysis.overallProgress.toFixed(1)}%`);
    
    return NextResponse.json(response);

  } catch (error) {
    console.error('[BATCH STATUS] Критическая ошибка:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      error: process.env.NODE_ENV === 'development' 
        ? `Ошибка получения статуса: ${error.message}`
        : "Ошибка получения статуса задач",
      timestamp: new Date().toISOString(),
      kvConnected: isKVConnected(),
      suggestion: "Попробуйте повторить запрос через несколько секунд",
      debug: process.env.NODE_ENV === 'development' ? {
        stack: error.stack?.split('\n').slice(0, 5).join('\n')
      } : undefined
    }, { status: 500 });
  }
}

export async function POST(req, context) {
  // Инициализируем KV
  initKV(context?.env || {});
  console.log('[BATCH STATUS] POST запрос - массовая проверка статуса');
  
  try {
    const { jobIds, options = {} } = await req.json();
    
    // Валидация входных данных
    if (!jobIds || !Array.isArray(jobIds)) {
      return NextResponse.json(
        { 
          error: "Поле 'jobIds' обязательно и должно быть массивом",
          example: { jobIds: ["job_123", "job_456"], options: { detailed: true } }
        },
        { status: 400 }
      );
    }

    if (jobIds.length === 0) {
      return NextResponse.json(
        { error: "Массив jobIds не может быть пустым" },
        { status: 400 }
      );
    }

    if (jobIds.length > 100) { // Уменьшен лимит
      return NextResponse.json(
        { 
          error: "Слишком много ID задач для POST запроса",
          details: `Предоставлено: ${jobIds.length}, максимум: 100`,
          suggestion: "Используйте GET запросы для больших списков или разбейте на части"
        },
        { status: 400 }
      );
    }

    console.log(`[BATCH STATUS] POST проверка ${jobIds.length} задач`);

    // Проверяем доступность KV
    if (!isKVConnected()) {
      return NextResponse.json({
        error: "Cloudflare KV недоступно",
        message: "Сервис очередей временно недоступен",
        kvConnected: false,
        requestedJobs: jobIds.length
      }, { status: 503 });
    }

    // Получаем статусы
    const statuses = await getKVBatchStatus(jobIds);
    
    if (!statuses) {
      return NextResponse.json({
        error: "Не удалось получить статусы задач",
        requestedJobs: jobIds.length,
        kvConnected: isKVConnected()
      }, { status: 500 });
    }

    // Проводим полный анализ
    const analysis = analyzeJobStatuses(statuses);
    const groupedStatuses = groupStatusesByState(statuses);
    const timeAnalysis = analyzeTimings(statuses);
    
    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      kvConnected: isKVConnected(),
      totalJobs: statuses.length,
      requestedJobs: jobIds.length,
      ...analysis,
      statusGroups: groupedStatuses,
      timeAnalysis: timeAnalysis,
      includeDetails: options.includeDetails || false
    };

    // Добавляем детали если запрошены
    if (options.includeDetails) {
      response.jobs = statuses;
      response.detailedAnalysis = await getDetailedAnalysis(statuses);
      
      // Включаем результаты для завершенных задач
      if (analysis.completedJobs > 0) {
        try {
          const { getKVBatchResults } = await import("@/lib/kv-queue");
          const completedJobIds = statuses
            .filter(job => job.status === 'completed')
            .map(job => job.id);
          
          const results = await getKVBatchResults(completedJobIds);
          response.results = results;
        } catch (resultsError) {
          response.resultsError = "Не удалось загрузить результаты";
        }
      }
    } else {
      response.jobSummary = statuses.map(job => ({
        id: job.id,
        status: job.status,
        progress: job.progress || 0,
        processed: job.processed || 0,
        total: job.total || 0
      }));
    }

    // Добавляем рекомендации
    response.recommendations = generateRecommendations(analysis, statuses);
    response.nextSteps = generateNextSteps(analysis);

    console.log(`[BATCH STATUS] POST ответ подготовлен. Общий прогресс: ${analysis.overallProgress.toFixed(1)}%`);
    
    return NextResponse.json(response);

  } catch (error) {
    console.error('[BATCH STATUS] Ошибка POST запроса:', error.message);
    
    return NextResponse.json({
      error: "Ошибка массовой проверки статуса",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

// Анализ статусов задач
function analyzeJobStatuses(statuses) {
  const analysis = {
    completedJobs: 0,
    processingJobs: 0,
    pendingJobs: 0,
    failedJobs: 0,
    notFoundJobs: 0,
    totalProgress: 0,
    overallProgress: 0,
    hasErrors: false,
    isCompleted: false,
    estimatedTimeRemaining: null,
    averageProgress: 0
  };

  let totalOperations = 0;
  let processedOperations = 0;
  let progressSum = 0;

  for (const job of statuses) {
    const jobTotal = job.total || 0;
    const jobProcessed = job.processed || 0;
    const jobProgress = job.progress || 0;

    totalOperations += jobTotal;
    processedOperations += jobProcessed;
    progressSum += jobProgress;

    switch (job.status) {
      case 'completed':
        analysis.completedJobs++;
        break;
      case 'processing':
      case 'active':
        analysis.processingJobs++;
        break;
      case 'pending':
      case 'waiting':
        analysis.pendingJobs++;
        break;
      case 'failed':
        analysis.failedJobs++;
        analysis.hasErrors = true;
        break;
      case 'not_found':
        analysis.notFoundJobs++;
        break;
    }
  }

  // Рассчитываем общие метрики
  analysis.totalProgress = progressSum;
  analysis.averageProgress = statuses.length > 0 ? progressSum / statuses.length : 0;
  analysis.overallProgress = totalOperations > 0 ? (processedOperations / totalOperations) * 100 : analysis.averageProgress;
  analysis.isCompleted = analysis.completedJobs === statuses.length && statuses.length > 0;

  // Простая оценка времени до завершения
  if (analysis.processingJobs > 0 && analysis.overallProgress > 0 && analysis.overallProgress < 100) {
    const remainingProgress = 100 - analysis.overallProgress;
    const estimatedSeconds = (remainingProgress / analysis.overallProgress) * 90; // Примерно 1.5 минуты на 1%
    analysis.estimatedTimeRemaining = Math.ceil(estimatedSeconds);
  }

  return analysis;
}

// Группировка статусов по состоянию
function groupStatusesByState(statuses) {
  const groups = {
    completed: [],
    processing: [],
    pending: [],
    failed: [],
    not_found: []
  };

  for (const job of statuses) {
    const groupKey = job.status === 'active' ? 'processing' : 
                    job.status === 'waiting' ? 'pending' : 
                    job.status;
    
    if (groups[groupKey]) {
      groups[groupKey].push({
        id: job.id,
        progress: job.progress || 0,
        processed: job.processed || 0,
        total: job.total || 0,
        error: job.error
      });
    }
  }

  return groups;
}

// Анализ временных характеристик
function analyzeTimings(statuses) {
  const timings = {
    oldestJob: null,
    newestJob: null,
    longestRunning: null,
    averageProcessingTime: null,
    totalWaitTime: 0
  };

  let oldestTime = Date.now();
  let newestTime = 0;
  let longestRunning = 0;
  let processingTimes = [];
  let totalWait = 0;

  for (const job of statuses) {
    // Анализ времени создания
    if (job.createdAt) {
      const createdTime = new Date(job.createdAt).getTime();
      
      if (createdTime < oldestTime) {
        oldestTime = createdTime;
        timings.oldestJob = {
          id: job.id,
          createdAt: job.createdAt,
          age: Math.ceil((Date.now() - createdTime) / 1000)
        };
      }
      
      if (createdTime > newestTime) {
        newestTime = createdTime;
        timings.newestJob = {
          id: job.id,
          createdAt: job.createdAt,
          age: Math.ceil((Date.now() - createdTime) / 1000)
        };
      }
    }

    // Анализ времени выполнения
    if (job.startedAt && job.status === 'processing') {
      const runningTime = Date.now() - new Date(job.startedAt).getTime();
      if (runningTime > longestRunning) {
        longestRunning = runningTime;
        timings.longestRunning = {
          id: job.id,
          runningTime: Math.ceil(runningTime / 1000),
          startedAt: job.startedAt
        };
      }
    }

    // Анализ завершенных задач
    if (job.startedAt && job.finishedAt) {
      const processingTime = new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime();
      processingTimes.push(processingTime);
    }

    // Общее время ожидания
    if (job.createdAt && job.status === 'pending') {
      totalWait += Date.now() - new Date(job.createdAt).getTime();
    }
  }

  // Среднее время обработки
  if (processingTimes.length > 0) {
    const avgProcessingTime = processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length;
    timings.averageProcessingTime = Math.ceil(avgProcessingTime / 1000);
  }

  timings.totalWaitTime = Math.ceil(totalWait / 1000);

  return timings;
}

// Детальный анализ (для detailed=true)
async function getDetailedAnalysis(statuses) {
  const analysis = {
    errorCategories: {},
    progressDistribution: {
      "0-25%": 0,
      "25-50%": 0,
      "50-75%": 0,
      "75-100%": 0,
      "100%": 0
    },
    performanceMetrics: {
      fastestJob: null,
      slowestJob: null,
      averageOperationsPerSecond: 0
    }
  };

  let totalOperationsProcessed = 0;
  let totalProcessingTime = 0;

  for (const job of statuses) {
    // Категоризация ошибок
    if (job.status === 'failed' && job.error) {
      const errorCategory = categorizeError(job.error);
      analysis.errorCategories[errorCategory] = (analysis.errorCategories[errorCategory] || 0) + 1;
    }

    // Распределение прогресса
    const progress = job.progress || 0;
    if (progress === 100) analysis.progressDistribution["100%"]++;
    else if (progress >= 75) analysis.progressDistribution["75-100%"]++;
    else if (progress >= 50) analysis.progressDistribution["50-75%"]++;
    else if (progress >= 25) analysis.progressDistribution["25-50%"]++;
    else analysis.progressDistribution["0-25%"]++;

    // Метрики производительности
    if (job.startedAt && job.finishedAt && job.processed) {
      const processingTime = new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime();
      const operationsPerSecond = (job.processed / processingTime) * 1000;

      if (!analysis.performanceMetrics.fastestJob || operationsPerSecond > analysis.performanceMetrics.fastestJob.rate) {
        analysis.performanceMetrics.fastestJob = {
          id: job.id,
          rate: operationsPerSecond,
          processed: job.processed,
          timeMs: processingTime
        };
      }

      if (!analysis.performanceMetrics.slowestJob || operationsPerSecond < analysis.performanceMetrics.slowestJob.rate) {
        analysis.performanceMetrics.slowestJob = {
          id: job.id,
          rate: operationsPerSecond,
          processed: job.processed,
          timeMs: processingTime
        };
      }

      totalOperationsProcessed += job.processed;
      totalProcessingTime += processingTime;
    }
  }

  // Средняя производительность
  if (totalProcessingTime > 0) {
    analysis.performanceMetrics.averageOperationsPerSecond = 
      (totalOperationsProcessed / totalProcessingTime) * 1000;
  }

  return analysis;
}

// Категоризация ошибок
function categorizeError(errorMessage) {
  const error = errorMessage.toLowerCase();
  
  if (error.includes('rate limit') || error.includes('429')) return 'Rate Limiting';
  if (error.includes('timeout') || error.includes('etimedout')) return 'Timeout';
  if (error.includes('network') || error.includes('econnreset')) return 'Network';
  if (error.includes('authorization') || error.includes('401')) return 'Authorization';
  if (error.includes('not found') || error.includes('404')) return 'Not Found';
  if (error.includes('validation') || error.includes('400')) return 'Validation';
  if (error.includes('server') || error.includes('500')) return 'Server Error';
  
  return 'Unknown';
}

// Генерация рекомендаций
function generateRecommendations(analysis, statuses) {
  const recommendations = [];

  if (analysis.hasErrors) {
    recommendations.push({
      type: 'error',
      message: `Обнаружены ошибки в ${analysis.failedJobs} задачах`,
      action: 'Проверьте детали ошибок и рассмотрите повторную отправку'
    });
  }

  if (analysis.processingJobs > 0) {
    recommendations.push({
      type: 'info',
      message: `${analysis.processingJobs} задач выполняются`,
      action: 'Продолжайте мониторинг или дождитесь завершения'
    });
  }

  if (analysis.pendingJobs > 0) {
    recommendations.push({
      type: 'warning',
      message: `${analysis.pendingJobs} задач ожидают обработки`,
      action: 'Задачи будут обработаны автоматически'
    });
  }

  if (analysis.isCompleted) {
    recommendations.push({
      type: 'success',
      message: 'Все задачи завершены',
      action: 'Используйте endpoint /api/batch/results для получения результатов'
    });
  }

  if (analysis.estimatedTimeRemaining) {
    recommendations.push({
      type: 'info',
      message: `Приблизительное время до завершения: ${Math.ceil(analysis.estimatedTimeRemaining / 60)} минут`,
      action: 'Проверьте статус через рекомендуемое время'
    });
  }

  if (analysis.notFoundJobs > 0) {
    recommendations.push({
      type: 'warning',
      message: `${analysis.notFoundJobs} задач не найдено`,
      action: 'Проверьте корректность Job IDs или создайте новые задачи'
    });
  }

  return recommendations;
}

// Генерация следующих шагов
function generateNextSteps(analysis) {
  const steps = [];

  if (analysis.processingJobs > 0 || analysis.pendingJobs > 0) {
    steps.push({
      step: 1,
      action: 'Продолжить мониторинг',
      description: 'Проверяйте статус каждые 15-20 секунд',
      endpoint: 'GET /api/batch/status'
    });
  }

  if (analysis.completedJobs > 0) {
    steps.push({
      step: steps.length + 1,
      action: 'Получить результаты',
      description: 'Загрузите результаты завершенных задач',
      endpoint: 'GET /api/batch/results'
    });
  }

  if (analysis.hasErrors) {
    steps.push({
      step: steps.length + 1,
      action: 'Обработать ошибки',
      description: 'Проанализируйте неудачные операции и повторите при необходимости',
      suggestion: 'Используйте detailed=true для получения подробностей об ошибках'
    });
  }

  if (analysis.notFoundJobs > 0) {
    steps.push({
      step: steps.length + 1,
      action: 'Проверить Job IDs',
      description: 'Убедитесь в корректности переданных идентификаторов задач',
      suggestion: 'Возможно, задачи были удалены или неправильно переданы'
    });
  }

  return steps;
}

// Очистка кэша статусов
function cleanupStatusCache() {
  const now = Date.now();
  const maxCacheAge = 30000; // 30 секунд
  
  for (const [key, value] of statusCache.entries()) {
    if (now - value.timestamp > maxCacheAge) {
      statusCache.delete(key);
    }
  }

  // Ограничиваем размер кэша
  if (statusCache.size > 20) { // Уменьшен размер кэша
    const entries = Array.from(statusCache.entries());
    entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
    
    statusCache.clear();
    entries.slice(0, 10).forEach(([key, value]) => {
      statusCache.set(key, value);
    });
  }
}