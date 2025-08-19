// app/api/batch/results/route.js - API endpoint для получения результатов выполнения batch операций из Cloudflare KV
export const runtime = "edge";

import { NextResponse } from "next/server";
import { getKVBatchResults, getKVBatchStatus, isKVConnected } from "@/lib/kv-queue";

// Кэш для результатов (они меняются реже чем статус)
const resultsCache = new Map();
const CACHE_TTL = 10000; // Кэшируем результаты на 10 секунд

export async function GET(req) {
  console.log('[BATCH RESULTS] Получен запрос на результаты batch операций');
  
  try {
    const url = new URL(req.url);
    const jobIds = url.searchParams.get('jobIds');
    const format = url.searchParams.get('format') || 'detailed'; // detailed, summary, csv
    const onlySuccessful = url.searchParams.get('onlySuccessful') === 'true';
    const onlyErrors = url.searchParams.get('onlyErrors') === 'true';
    const clearCache = url.searchParams.get('clearCache') === 'true';
    
    // Очистка кэша если запрошена
    if (clearCache) {
      resultsCache.clear();
      console.log('[BATCH RESULTS] Кэш результатов очищен');
    }

    // Валидация параметров
    if (!jobIds) {
      return NextResponse.json(
        { 
          error: "Параметр 'jobIds' обязателен",
          usage: "Укажите ID задач через запятую: ?jobIds=job1,job2,job3",
          example: "/api/batch/results?jobIds=job_123,job_456&format=summary",
          supportedFormats: ["detailed", "summary", "csv"],
          filters: ["onlySuccessful", "onlyErrors"]
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

    if (jobIdArray.length > 50) {
      return NextResponse.json(
        { 
          error: "Слишком много ID задач для получения результатов",
          details: `Предоставлено: ${jobIdArray.length}, максимум: 50`,
          suggestion: "Разбейте запрос на несколько частей"
        },
        { status: 400 }
      );
    }

    console.log(`[BATCH RESULTS] Загружаем результаты для ${jobIdArray.length} задач`);

    // Проверяем доступность KV
    if (!isKVConnected()) {
      return NextResponse.json({
        error: "Cloudflare KV недоступно",
        message: "Сервис очередей временно недоступен. Результаты недоступны.",
        kvConnected: false,
        jobIds: jobIdArray
      }, { status: 503 });
    }

    // Проверяем кэш
    const cacheKey = `results_${jobIdArray.sort().join('_')}_${format}_${onlySuccessful}_${onlyErrors}`;
    const cached = resultsCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('[BATCH RESULTS] Возвращаем закэшированные результаты');
      return NextResponse.json({
        ...cached.data,
        cached: true,
        cacheAge: Date.now() - cached.timestamp
      });
    }

    // Сначала проверяем статусы задач
    let statuses;
    try {
      statuses = await getKVBatchStatus(jobIdArray);
    } catch (statusError) {
      console.error('[BATCH RESULTS] Ошибка получения статусов:', statusError.message);
      return NextResponse.json({
        error: "Ошибка проверки статуса задач",
        details: statusError.message,
        suggestion: "Проверьте корректность ID задач"
      }, { status: 500 });
    }

    if (!statuses) {
      return NextResponse.json({
        error: "Не удалось получить информацию о задачах",
        jobIds: jobIdArray
      }, { status: 404 });
    }

    // Фильтруем только завершенные задачи
    const completedJobs = statuses.filter(job => job.status === 'completed');
    const failedJobs = statuses.filter(job => job.status === 'failed');
    const pendingJobs = statuses.filter(job => 
      job.status === 'pending' || job.status === 'processing' || job.status === 'active'
    );

    if (completedJobs.length === 0 && failedJobs.length === 0) {
      return NextResponse.json({
        message: "Нет завершенных задач для получения результатов",
        status: {
          total: statuses.length,
          completed: completedJobs.length,
          failed: failedJobs.length,
          pending: pendingJobs.length
        },
        suggestion: pendingJobs.length > 0 
          ? "Дождитесь завершения задач и повторите запрос"
          : "Проверьте корректность ID задач",
        pendingJobs: pendingJobs.map(job => ({
          id: job.id,
          status: job.status,
          progress: job.progress || 0
        }))
      }, { status: 202 }); // 202 Accepted - данные еще обрабатываются
    }

    // Получаем результаты для завершенных задач
    console.log(`[BATCH RESULTS] Получаем результаты для ${completedJobs.length} завершенных задач`);
    
    let results;
    try {
      const completedJobIds = completedJobs.map(job => job.id);
      results = await getKVBatchResults(completedJobIds);
    } catch (resultsError) {
      console.error('[BATCH RESULTS] Ошибка получения результатов:', resultsError.message);
      return NextResponse.json({
        error: "Ошибка загрузки результатов из KV",
        details: resultsError.message,
        completedJobs: completedJobs.length
      }, { status: 500 });
    }

    if (!results) {
      return NextResponse.json({
        error: "Результаты не найдены",
        completedJobs: completedJobs.length,
        suggestion: "Возможно, результаты были удалены или истек срок их хранения"
      }, { status: 404 });
    }

    console.log(`[BATCH RESULTS] Найдено ${results.length} результатов операций`);

    // Применяем фильтры
    let filteredResults = results;
    
    if (onlySuccessful) {
      filteredResults = results.filter(r => r.status === 'success');
    } else if (onlyErrors) {
      filteredResults = results.filter(r => r.status === 'error');
    }

    // Анализируем результаты
    const analysis = analyzeResults(results);
    
    // Формируем ответ в зависимости от формата
    let response;
    
    switch (format) {
      case 'summary':
        response = formatSummaryResponse(filteredResults, analysis, statuses);
        break;
      case 'csv':
        response = formatCSVResponse(filteredResults, analysis);
        break;
      default: // detailed
        response = formatDetailedResponse(filteredResults, analysis, statuses);
        break;
    }

    // Добавляем общую информацию
    response.meta = {
      timestamp: new Date().toISOString(),
      kvConnected: isKVConnected(),
      totalJobsRequested: jobIdArray.length,
      totalResultsFound: results.length,
      filteredResults: filteredResults.length,
      filters: {
        onlySuccessful,
        onlyErrors,
        format
      }
    };

    // Кэшируем результат
    resultsCache.set(cacheKey, {
      data: response,
      timestamp: Date.now()
    });

    // Очищаем старые записи кэша
    cleanupResultsCache();

    console.log(`[BATCH RESULTS] Результаты подготовлены. Успешно: ${analysis.successful}, Ошибок: ${analysis.failed}`);
    
    return NextResponse.json(response);

  } catch (error) {
    console.error('[BATCH RESULTS] Критическая ошибка:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      error: process.env.NODE_ENV === 'development' 
        ? `Ошибка получения результатов: ${error.message}`
        : "Ошибка получения результатов batch операций",
      timestamp: new Date().toISOString(),
      kvConnected: isKVConnected()
    }, { status: 500 });
  }
}

export async function POST(req) {
  console.log('[BATCH RESULTS] POST запрос - массовое получение результатов');
  
  try {
    const { jobIds, options = {} } = await req.json();
    
    // Валидация входных данных
    if (!jobIds || !Array.isArray(jobIds)) {
      return NextResponse.json(
        { 
          error: "Поле 'jobIds' обязательно и должно быть массивом",
          example: { 
            jobIds: ["job_123", "job_456"], 
            options: { 
              format: "detailed", 
              includeMetrics: true,
              onlySuccessful: false 
            } 
          }
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

    if (jobIds.length > 100) {
      return NextResponse.json(
        { 
          error: "Слишком много ID задач для POST запроса",
          details: `Предоставлено: ${jobIds.length}, максимум: 100`
        },
        { status: 400 }
      );
    }

    console.log(`[BATCH RESULTS] POST обработка ${jobIds.length} задач`);

    // Проверяем доступность KV
    if (!isKVConnected()) {
      return NextResponse.json({
        error: "Cloudflare KV недоступно",
        message: "Сервис очередей временно недоступен",
        kvConnected: false,
        requestedJobs: jobIds.length
      }, { status: 503 });
    }

    // Получаем статусы и результаты
    const [statuses, results] = await Promise.all([
      getKVBatchStatus(jobIds),
      getKVBatchResults(jobIds)
    ]);

    if (!statuses) {
      return NextResponse.json({
        error: "Не удалось получить статусы задач",
        requestedJobs: jobIds.length
      }, { status: 500 });
    }

    // Анализируем данные
    const statusAnalysis = analyzeJobStatuses(statuses);
    const resultsAnalysis = results ? analyzeResults(results) : null;
    
    // Объединяем информацию о задачах с их результатами
    const enrichedJobs = statuses.map(job => {
      const jobResults = results ? results.filter(r => 
        r.operation && r.operation.jobId === job.id
      ) : [];
      
      return {
        ...job,
        results: jobResults,
        resultsCount: jobResults.length,
        successfulResults: jobResults.filter(r => r.status === 'success').length,
        failedResults: jobResults.filter(r => r.status === 'error').length
      };
    });

    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      kvConnected: isKVConnected(),
      totalJobs: statuses.length,
      requestedJobs: jobIds.length,
      statusAnalysis,
      resultsAnalysis,
      jobs: enrichedJobs
    };

    // Добавляем дополнительные метрики если запрошены
    if (options.includeMetrics) {
      response.detailedMetrics = generateDetailedMetrics(statuses, results);
    }

    // Добавляем сводную информацию
    response.summary = generateSummary(statusAnalysis, resultsAnalysis);
    
    // Рекомендации для следующих действий
    response.recommendations = generateResultsRecommendations(statusAnalysis, resultsAnalysis);

    console.log(`[BATCH RESULTS] POST ответ подготовлен. Результатов: ${results ? results.length : 0}`);
    
    return NextResponse.json(response);

  } catch (error) {
    console.error('[BATCH RESULTS] Ошибка POST запроса:', error.message);
    
    return NextResponse.json({
      error: "Ошибка массового получения результатов",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

// Анализ результатов операций
function analyzeResults(results) {
  const analysis = {
    total: results.length,
    successful: 0,
    failed: 0,
    successRate: 0,
    errorCategories: {},
    operationTypes: {},
    averageProcessingTime: 0
  };

  let totalProcessingTime = 0;
  let processedWithTime = 0;

  for (const result of results) {
    if (result.status === 'success') {
      analysis.successful++;
    } else if (result.status === 'error') {
      analysis.failed++;
      
      // Категоризируем ошибки
      const category = categorizeError(result.error || 'Unknown error');
      analysis.errorCategories[category] = (analysis.errorCategories[category] || 0) + 1;
    }

    // Анализируем типы операций
    if (result.operation && result.operation.properties) {
      const operationType = Object.keys(result.operation.properties)[0] || 'unknown';
      analysis.operationTypes[operationType] = (analysis.operationTypes[operationType] || 0) + 1;
    }

    // Рассчитываем время обработки (если доступно)
    if (result.processingTime) {
      totalProcessingTime += result.processingTime;
      processedWithTime++;
    }
  }

  analysis.successRate = analysis.total > 0 ? (analysis.successful / analysis.total) * 100 : 0;
  analysis.averageProcessingTime = processedWithTime > 0 ? totalProcessingTime / processedWithTime : 0;

  return analysis;
}

// Анализ статусов задач (импорт из status API)
function analyzeJobStatuses(statuses) {
  const analysis = {
    completedJobs: 0,
    processingJobs: 0,
    pendingJobs: 0,
    failedJobs: 0,
    notFoundJobs: 0,
    overallProgress: 0
  };

  let totalProgress = 0;
  let totalOperations = 0;
  let processedOperations = 0;

  for (const job of statuses) {
    totalOperations += job.total || 0;
    processedOperations += job.processed || 0;
    totalProgress += job.progress || 0;

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
        break;
      case 'not_found':
        analysis.notFoundJobs++;
        break;
    }
  }

  analysis.overallProgress = totalOperations > 0 ? (processedOperations / totalOperations) * 100 : 
                            statuses.length > 0 ? totalProgress / statuses.length : 0;

  return analysis;
}

// Форматирование ответа в виде сводки
function formatSummaryResponse(results, analysis, statuses) {
  return {
    summary: {
      totalResults: results.length,
      successful: analysis.successful,
      failed: analysis.failed,
      successRate: `${analysis.successRate.toFixed(1)}%`,
      averageProcessingTime: analysis.averageProcessingTime ? 
        `${analysis.averageProcessingTime.toFixed(0)}ms` : 'N/A'
    },
    errorSummary: analysis.errorCategories,
    operationTypes: analysis.operationTypes,
    jobStatus: {
      completed: statuses.filter(s => s.status === 'completed').length,
      failed: statuses.filter(s => s.status === 'failed').length,
      pending: statuses.filter(s => s.status === 'pending' || s.status === 'processing').length
    },
    sampleResults: results.slice(0, 5).map(result => ({
      status: result.status,
      operationType: result.operation ? Object.keys(result.operation.properties || {})[0] : 'unknown',
      error: result.status === 'error' ? result.error?.substring(0, 100) : undefined
    }))
  };
}

// Форматирование ответа в виде CSV
function formatCSVResponse(results, analysis) {
  const csvHeaders = ['operation_id', 'status', 'operation_type', 'error_message', 'processing_time'];
  const csvRows = results.map(result => [
    result.operation?.pageId || 'unknown',
    result.status,
    result.operation ? Object.keys(result.operation.properties || {})[0] || 'unknown' : 'unknown',
    result.status === 'error' ? (result.error || '').replace(/,/g, ';') : '',
    result.processingTime || ''
  ]);

  const csvContent = [
    csvHeaders.join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');

  return {
    format: 'csv',
    content: csvContent,
    filename: `batch_results_${new Date().toISOString().split('T')[0]}.csv`,
    summary: {
      totalResults: results.length,
      successful: analysis.successful,
      failed: analysis.failed,
      successRate: `${analysis.successRate.toFixed(1)}%`
    }
  };
}

// Детальное форматирование ответа
function formatDetailedResponse(results, analysis, statuses) {
  return {
    analysis,
    results: results.map(result => ({
      ...result,
      operation: {
        pageId: result.operation?.pageId,
        operationType: result.operation ? Object.keys(result.operation.properties || {})[0] : 'unknown',
        properties: result.operation?.properties
      }
    })),
    jobStatusSummary: {
      total: statuses.length,
      completed: statuses.filter(s => s.status === 'completed').length,
      failed: statuses.filter(s => s.status === 'failed').length,
      pending: statuses.filter(s => ['pending', 'processing', 'active'].includes(s.status)).length
    },
    errorDetails: analysis.failed > 0 ? {
      categories: analysis.errorCategories,
      examples: results
        .filter(r => r.status === 'error')
        .slice(0, 5)
        .map(r => ({
          pageId: r.operation?.pageId,
          error: r.error,
          category: categorizeError(r.error || 'Unknown')
        }))
    } : null
  };
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

// Генерация детальных метрик
function generateDetailedMetrics(statuses, results) {
  const metrics = {
    processingEfficiency: {},
    timeDistribution: {},
    errorPatterns: {},
    throughputAnalysis: {}
  };

  // Анализ эффективности обработки
  const completedJobs = statuses.filter(s => s.status === 'completed');
  if (completedJobs.length > 0) {
    const totalOperations = completedJobs.reduce((sum, job) => sum + (job.total || 0), 0);
    const successfulOperations = results ? results.filter(r => r.status === 'success').length : 0;
    
    metrics.processingEfficiency = {
      totalOperations,
      successfulOperations,
      efficiency: totalOperations > 0 ? (successfulOperations / totalOperations) * 100 : 0,
      averageOperationsPerJob: completedJobs.length > 0 ? totalOperations / completedJobs.length : 0
    };
  }

  // Анализ временного распределения
  if (results) {
    const processingTimes = results
      .filter(r => r.processingTime)
      .map(r => r.processingTime)
      .sort((a, b) => a - b);
    
    if (processingTimes.length > 0) {
      metrics.timeDistribution = {
        min: processingTimes[0],
        max: processingTimes[processingTimes.length - 1],
        median: processingTimes[Math.floor(processingTimes.length / 2)],
        p95: processingTimes[Math.floor(processingTimes.length * 0.95)],
        average: processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length
      };
    }
  }

  return metrics;
}

// Генерация сводки
function generateSummary(statusAnalysis, resultsAnalysis) {
  const summary = {
    overall: 'unknown',
    message: '',
    recommendations: []
  };

  const totalJobs = statusAnalysis.completedJobs + statusAnalysis.failedJobs + statusAnalysis.processingJobs + statusAnalysis.pendingJobs;
  const completionRate = totalJobs > 0 ? (statusAnalysis.completedJobs / totalJobs) * 100 : 0;

  if (completionRate === 100 && resultsAnalysis) {
    if (resultsAnalysis.successRate >= 95) {
      summary.overall = 'excellent';
      summary.message = `Отличный результат! ${resultsAnalysis.successRate.toFixed(1)}% операций выполнены успешно`;
    } else if (resultsAnalysis.successRate >= 80) {
      summary.overall = 'good';
      summary.message = `Хороший результат. ${resultsAnalysis.successRate.toFixed(1)}% операций выполнены успешно`;
      summary.recommendations.push('Проанализируйте причины неудачных операций');
    } else {
      summary.overall = 'poor';
      summary.message = `Низкая эффективность. Только ${resultsAnalysis.successRate.toFixed(1)}% операций выполнены успешно`;
      summary.recommendations.push('Требуется анализ и исправление проблем');
    }
  } else if (statusAnalysis.processingJobs > 0 || statusAnalysis.pendingJobs > 0) {
    summary.overall = 'in_progress';
    summary.message = `Обработка продолжается. Завершено: ${statusAnalysis.completedJobs}/${totalJobs} задач`;
    summary.recommendations.push('Дождитесь завершения всех задач');
  } else {
    summary.overall = 'failed';
    summary.message = 'Большинство задач завершились с ошибками';
    summary.recommendations.push('Проверьте системные настройки и повторите операции');
  }

  return summary;
}

// Генерация рекомендаций для результатов
function generateResultsRecommendations(statusAnalysis, resultsAnalysis) {
  const recommendations = [];

  if (statusAnalysis.failedJobs > 0) {
    recommendations.push({
      type: 'error',
      title: 'Неудачные задачи',
      message: `${statusAnalysis.failedJobs} задач завершились с ошибками`,
      action: 'Проанализируйте ошибки и повторите неудачные операции'
    });
  }

  if (resultsAnalysis && resultsAnalysis.failed > 0) {
    recommendations.push({
      type: 'warning',
      title: 'Неудачные операции',
      message: `${resultsAnalysis.failed} операций из ${resultsAnalysis.total} не выполнены`,
      action: 'Проверьте права доступа и корректность данных'
    });
  }

  if (resultsAnalysis && resultsAnalysis.successRate < 90) {
    recommendations.push({
      type: 'optimization',
      title: 'Низкая эффективность',
      message: `Успешность: ${resultsAnalysis.successRate.toFixed(1)}%`,
      action: 'Рассмотрите увеличение задержек между запросами или уменьшение размера пакетов'
    });
  }

  if (statusAnalysis.completedJobs === 0) {
    recommendations.push({
      type: 'info',
      title: 'Нет завершенных задач',
      message: 'Все задачи еще выполняются или завершились с ошибками',
      action: 'Проверьте статус задач через /api/batch/status'
    });
  }

  return recommendations;
}

// Очистка кэша результатов
function cleanupResultsCache() {
  const now = Date.now();
  const maxCacheAge = 60000; // 1 минута
  
  for (const [key, value] of resultsCache.entries()) {
    if (now - value.timestamp > maxCacheAge) {
      resultsCache.delete(key);
    }
  }

  // Ограничиваем размер кэша
  if (resultsCache.size > 30) {
    const entries = Array.from(resultsCache.entries());
    entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
    
    resultsCache.clear();
    entries.slice(0, 15).forEach(([key, value]) => {
      resultsCache.set(key, value);
    });
  }
}