// app/api/batch/status/route.js - ИСПРАВЛЕННЫЙ API endpoint для проверки статуса batch операций
export const runtime = "edge";

import { NextResponse } from "next/server";
import { getKVBatchStatus, isKVConnected, initKV } from "@/lib/kv-queue";

// Кэш для статусов (уменьшенный TTL для лучшей отзывчивости)
const statusCache = new Map();
const CACHE_TTL = 2000; // 2 секунды для быстрого обновления

export async function GET(req, context) {
  // ИСПРАВЛЕНИЕ: Правильная инициализация KV без context.env
  try {
    initKV(); // Убираем context?.env
  } catch (initError) {
    // KV initialization error
  }
  
  try {
    const url = new URL(req.url);
    const jobIds = url.searchParams.get('jobIds');
    const detailed = url.searchParams.get('detailed') === 'true';
    const clearCache = url.searchParams.get('clearCache') === 'true';
    const includeResults = url.searchParams.get('includeResults') === 'true';
    
    // Очистка кэша если запрошена
    if (clearCache) {
      statusCache.clear();
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
          "KV namespace не создан в Cloudflare Dashboard",
          "Приложение не переразвернуто после изменений"
        ],
        fallbackSuggestion: "Используйте прямую обработку для новых операций",
        troubleshooting: {
          checkBinding: "Проверьте NOTION_QUEUE_KV в wrangler.toml",
          checkNamespace: "Убедитесь что KV namespace создан",
          checkDeployment: "Переразверните приложение: npm run cf:deploy",
          checkGlobal: "NOTION_QUEUE_KV должен быть доступен глобально"
        }
      }, { status: 503 });
    }

    // Проверяем кэш
    const cacheKey = `status_${jobIdArray.sort().join('_')}_${detailed}_${includeResults}`;
    const cached = statusCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({
        ...cached.data,
        cached: true,
        cacheAge: Date.now() - cached.timestamp
      });
    }

    // ИСПРАВЛЕНИЕ: Получаем статусы задач из KV с обработкой ошибок
    let statuses;
    try {
      statuses = await getKVBatchStatus(jobIdArray);

      if (!statuses) {
        throw new Error('Не удалось получить статусы из KV');
      }
    } catch (kvError) {
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
        error: "Не найдены задачи с указанными ID",
        jobIds: jobIdArray,
        kvConnected: isKVConnected(),
        possibleReasons: [
          "Задачи еще не созданы",
          "Неверные Job IDs",
          "Задачи были удалены (срок хранения истек)"
        ]
      }, { status: 404 });
    }

    // Анализ статусов
    const summary = {
      totalJobs: statuses.length,
      pending: statuses.filter(s => s.status === 'pending').length,
      processing: statuses.filter(s => s.status === 'processing').length,
      completed: statuses.filter(s => s.status === 'completed').length,
      failed: statuses.filter(s => s.status === 'failed' || s.status === 'error').length,
      notFound: statuses.filter(s => s.status === 'not_found').length
    };

    // Вычисление общего прогресса
    let totalOperations = 0;
    let completedOperations = 0;
    
    statuses.forEach(status => {
      totalOperations += status.operations || 0;
      if (status.status === 'completed') {
        completedOperations += status.operations || 0;
      } else if (status.results && Array.isArray(status.results)) {
        completedOperations += status.results.filter(r => r.status === 'success').length;
      }
    });

    const overallProgress = totalOperations > 0 ? 
      Math.round((completedOperations / totalOperations) * 100) : 0;

    const isCompleted = summary.pending === 0 && summary.processing === 0;
    const hasErrors = summary.failed > 0;

    // Подготовка ответа
    const response = {
      jobIds: jobIdArray,
      statuses: detailed ? statuses : statuses.map(s => ({
        jobId: s.jobId,
        status: s.status,
        progress: s.progress || 0
      })),
      summary,
      overallProgress,
      totalOperations,
      completedOperations,
      isCompleted,
      hasErrors,
      kvConnected: isKVConnected(),
      timestamp: new Date().toISOString()
    };

    // Добавляем результаты если запрошены и доступны
    if (includeResults && isCompleted) {
      const allResults = [];
      statuses.forEach(status => {
        if (status.results && Array.isArray(status.results)) {
          allResults.push(...status.results);
        }
      });
      response.results = allResults;
      response.resultsSummary = {
        total: allResults.length,
        successful: allResults.filter(r => r.status === 'success').length,
        failed: allResults.filter(r => r.status === 'error').length
      };
    }

    // Кэшируем результат только если он не содержит ошибок
    if (!hasErrors) {
      statusCache.set(cacheKey, {
        data: response,
        timestamp: Date.now()
      });
    }

    // Очищаем старые записи из кэша
    if (statusCache.size > 100) {
      const oldestEntries = Array.from(statusCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 50);
      oldestEntries.forEach(([key]) => statusCache.delete(key));
    }

    return NextResponse.json(response);

  } catch (error) {
    return NextResponse.json(
      {
        error: "Внутренняя ошибка при получении статуса",
        details: process.env.NODE_ENV === 'development' ? error.message : 'Попробуйте позже',
        kvConnected: isKVConnected(),
        timestamp: new Date().toISOString(),
        requestId: Date.now().toString(36)
      },
      { status: 500 }
    );
  }
}

// Очистка кэша через POST запрос
export async function POST(req) {
  try {
    const body = await req.json();
    
    if (body.action === 'clearCache') {
      statusCache.clear();

      return NextResponse.json({
        success: true,
        message: "Кэш статусов очищен",
        timestamp: new Date().toISOString()
      });
    }
    
    return NextResponse.json(
      { error: "Неизвестное действие" },
      { status: 400 }
    );
    
  } catch (error) {
    return NextResponse.json(
      { error: "Ошибка обработки POST запроса" },
      { status: 500 }
    );
  }
}