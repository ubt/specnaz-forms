export const runtime = "edge";

import { NextResponse } from "next/server";

// Быстрый импорт с минимальной обработкой ошибок
async function quickImport(moduleName) {
  try {
    return await import(moduleName);
  } catch (error) {
    console.error(`[IMPORT ERROR] ${moduleName}:`, error.message);
    throw new Error(`Модуль ${moduleName} недоступен`);
  }
}

// GET - оптимизированная загрузка навыков для оценки
export async function GET(req, { params }) {
  const startTime = Date.now();
  console.log('[FORM API] 🚀 Начало быстрой загрузки');
  
  try {
    const { token } = params;
    if (!token) {
      return NextResponse.json({ error: "Токен не предоставлен" }, { status: 400 });
    }

    // Параллельный импорт модулей
    const [tokenModule, notionModule] = await Promise.all([
      quickImport("@/lib/token"),
      quickImport("@/lib/notion")
    ]);

    const { verifyReviewToken } = tokenModule;
    const { 
      listEvaluateesForReviewerUser, 
      fetchOptimizedSkillsForReviewer,
      getReviewerInfo
    } = notionModule;
 
    // Быстрая проверка токена
    console.log('[FORM API] ⏱️ Проверка токена...');
    const payload = await verifyReviewToken(token);
    const { reviewerUserId, role } = payload;

    console.log(`[FORM API] ✅ Токен валиден. Ревьюер: ${reviewerUserId}, роль: ${role}`);

    // Параллельная загрузка информации о ревьюере и списка сотрудников
    console.log('[FORM API] ⏱️ Параллельная загрузка данных...');
    const [reviewerInfo, employees] = await Promise.all([
      getReviewerInfo(reviewerUserId).catch(err => {
        console.warn('[FORM API] Не удалось загрузить информацию о ревьюере:', err.message);
        return { name: `Пользователь ${reviewerUserId.substring(0, 8)}`, userId: reviewerUserId };
      }),
      listEvaluateesForReviewerUser(reviewerUserId)
    ]);

    console.log(`[FORM API] ✅ Найдено ${employees.length} сотрудников для оценки`);
    console.log(`[FORM API] ✅ Ревьюер: ${reviewerInfo.name}`);

    if (!employees.length) {
      return NextResponse.json({
        error: "Нет сотрудников для оценки",
        reviewerInfo,
        suggestion: "Возможно, вам не назначены задачи по оценке в матрице компетенций"
      }, { status: 404 });
    }

    // Быстрая загрузка навыков с оптимизацией
    console.log('[FORM API] ⏱️ Быстрая загрузка навыков...');
    const skillRows = await fetchOptimizedSkillsForReviewer(employees, reviewerUserId, role);
    
    const loadTime = Date.now() - startTime;
    console.log(`[FORM API] 🎉 Загрузка завершена за ${loadTime}ms`);

    const response = {
      success: true,
      data: {
        rows: skillRows,
        reviewerInfo: {
          name: reviewerInfo.name,
          userId: reviewerInfo.userId,
          role: role || 'peer'
        },
        stats: {
          totalEmployees: employees.length,
          totalSkills: skillRows.length,
          loadTimeMs: loadTime,
          employees: employees.map(e => ({ 
            name: e.employeeName, 
            role: e.role 
          }))
        }
      }
    };

    if (skillRows.length === 0) {
      response.warning = "Навыки не найдены. Проверьте настройки матрицы компетенций.";
    }

    return NextResponse.json(response);

  } catch (error) {
    const loadTime = Date.now() - startTime;
    console.error('[FORM API] ❌ Ошибка:', error.message, `(${loadTime}ms)`);
    
    let errorMessage = "Внутренняя ошибка сервера";
    let statusCode = 500;
    
    if (error.message?.includes('JWT') || error.message?.includes('токен')) {
      errorMessage = "Недействительный или истёкший токен";
      statusCode = 401;
    } else if (error.message?.includes('модуль')) {
      errorMessage = "Ошибка конфигурации сервера";
    } else if (error.message?.includes('429')) {
      errorMessage = "Слишком много запросов. Попробуйте через минуту.";
      statusCode = 429;
    }

    return NextResponse.json({
      error: errorMessage,
      loadTimeMs: loadTime,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    }, { status: statusCode });
  }
}

// POST - оптимизированное сохранение оценок
export async function POST(req, { params }) {
  try {
    const { token } = params;
    
    // Быстрый импорт
    const [tokenModule, notionModule] = await Promise.all([
      quickImport("@/lib/token"),
      quickImport("@/lib/notion")
    ]);

    const { verifyReviewToken } = tokenModule;
    const { batchUpdateScores, ROLE_TO_FIELD } = notionModule;

    // Проверка токена
    const payload = await verifyReviewToken(token);
    const { reviewerUserId, role } = payload;

    // Парсинг данных
    const body = await req.json();
    
    if (!body.items || !Array.isArray(body.items)) {
      return NextResponse.json(
        { error: "Необходимо предоставить массив элементов" }, 
        { status: 400 }
      );
    }

    // Валидация элементов
    for (const [index, item] of body.items.entries()) {
      if (!item.pageId || typeof item.value !== 'number' || item.value < 0 || item.value > 5) {
        return NextResponse.json(
          { error: `Некорректный элемент ${index + 1}` }, 
          { status: 400 }
        );
      }
    }

    const scoreField = ROLE_TO_FIELD[role] || ROLE_TO_FIELD.peer;
    
    console.log(`[FORM POST] Пакетное обновление ${body.items.length} оценок (поле: ${scoreField})`);
    
    // Пакетное обновление
    const result = await batchUpdateScores(body.items, scoreField);
    
    return NextResponse.json({
      success: true,
      updated: result.successful,
      failed: result.failed,
      totalItems: body.items.length,
      mode: body.mode || "final"
    });

  } catch (error) {
    console.error('[FORM POST] Ошибка:', error.message);
    
    if (error.message?.includes('JWT')) {
      return NextResponse.json({ error: "Недействительный токен" }, { status: 401 });
    }
    
    return NextResponse.json(
      { error: "Ошибка сохранения данных" }, 
      { status: 500 }
    );
  }
}