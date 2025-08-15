export const runtime = "edge";

import { NextResponse } from "next/server";

// Безопасный импорт с обработкой ошибок
async function safeImport(moduleName) {
  try {
    return await import(moduleName);
  } catch (error) {
    console.error(`[SAFE IMPORT] Failed to import ${moduleName}:`, error.message);
    throw new Error(`Module import failed: ${moduleName} - ${error.message}`);
  }
}

// GET - загрузка списка навыков для оценки
export async function GET(req, { params }) {
  try {
    console.log('[FORM GET] Starting request processing');
    
    // Проверяем параметры
    const { token } = params;
    if (!token) {
      console.error('[FORM GET] No token provided');
      return NextResponse.json(
        { error: "Токен не предоставлен" }, 
        { status: 400 }
      );
    }
    
    console.log(`[FORM GET] Processing token: ${token.substring(0, 10)}...`);
    
    // Безопасный импорт модулей
    let tokenModule, notionModule;
    
    try {
      console.log('[FORM GET] Importing token module');
      tokenModule = await safeImport("@/lib/token");
      
      console.log('[FORM GET] Importing notion module');
      notionModule = await safeImport("@/lib/notion");
      
      console.log('[FORM GET] All modules imported successfully');
    } catch (importError) {
      console.error('[FORM GET] Module import failed:', importError.message);
      return NextResponse.json(
        { 
          error: "Ошибка загрузки модулей сервера",
          details: process.env.NODE_ENV === 'development' ? importError.message : undefined
        }, 
        { status: 500 }
      );
    }
    
    // Деструктуризация импортов
    const { verifyReviewToken } = tokenModule;
    const { 
      listEvaluateesForReviewerUser, 
      fetchEmployeeSkillRowsForReviewerUser,
      PerformanceTracker 
    } = notionModule;
    
    // Проверка токена
    let payload;
    try {
      console.log('[FORM GET] Verifying token');
      payload = await verifyReviewToken(token);
      console.log('[FORM GET] Token verified:', { 
        reviewerUserId: payload.reviewerUserId,
        role: payload.role,
        exp: payload.exp 
      });
    } catch (error) {
      console.error('[FORM GET] Token verification failed:', error.message);
      return NextResponse.json(
        { error: "Недействительный или истёкший токен" }, 
        { status: 401 }
      );
    }
    
    const { reviewerUserId, role } = payload;
    
    if (!reviewerUserId) {
      console.error('[FORM GET] No reviewerUserId in token');
      return NextResponse.json(
        { error: "Некорректный токен: отсутствует ID ревьюера" }, 
        { status: 400 }
      );
    }
    
    // Загрузка сотрудников для оценки
    console.log(`[FORM GET] Loading evaluatees for reviewer: ${reviewerUserId}`);
    PerformanceTracker.start('load-evaluatees');
    
    let employees;
    try {
      employees = await listEvaluateesForReviewerUser(reviewerUserId);
      PerformanceTracker.end('load-evaluatees');
      console.log(`[FORM GET] Found ${employees?.length || 0} employees for evaluation`);
    } catch (error) {
      PerformanceTracker.end('load-evaluatees');
      console.error('[FORM GET] Failed to load evaluatees:', error.message);
      return NextResponse.json(
        { 
          error: "Ошибка загрузки списка сотрудников для оценки",
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }, 
        { status: 500 }
      );
    }
    
    if (!employees?.length) {
      console.warn(`[FORM GET] No employees found for reviewer: ${reviewerUserId}`);
      return NextResponse.json(
        { 
          error: "Нет сотрудников для оценки",
          suggestion: "Возможно, вам не назначены задачи по оценке или данные ещё не настроены в системе"
        }, 
        { status: 404 }
      );
    }
    
    // Загрузка навыков
    console.log('[FORM GET] Loading skills data...');
    PerformanceTracker.start('load-skills');
    
    let skillGroups;
    try {
      skillGroups = await fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId);
      PerformanceTracker.end('load-skills');
      console.log(`[FORM GET] Loaded skills for ${skillGroups?.length || 0} employees`);
    } catch (error) {
      PerformanceTracker.end('load-skills');
      console.error('[FORM GET] Failed to load skills:', error.message);
      return NextResponse.json(
        { 
          error: "Ошибка загрузки навыков",
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }, 
        { status: 500 }
      );
    }
    
    // Преобразование в плоский список для UI
    const rows = [];
    let totalSkills = 0;
    
    try {
      for (const group of skillGroups || []) {
        for (const item of group.items || []) {
          rows.push({
            pageId: item.pageId,
            name: item.name,
            description: item.description || "",
            current: item.current,
            comment: item.comment || "",
            employeeId: group.employeeId,
            employeeName: group.employeeName,
            role: group.role
          });
          totalSkills++;
        }
      }
      
      console.log(`[FORM GET] Successfully prepared ${totalSkills} skills for ${employees.length} employees`);
    } catch (error) {
      console.error('[FORM GET] Failed to process skills data:', error.message);
      return NextResponse.json(
        { 
          error: "Ошибка обработки данных навыков",
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }, 
        { status: 500 }
      );
    }
    
    const response = {
      rows,
      stats: {
        totalEmployees: employees.length,
        totalSkills,
        reviewerRole: role || 'peer'
      }
    };
    
    // Добавляем предупреждение если мало данных
    if (totalSkills === 0) {
      response.warning = "Не найдено навыков для оценки. Проверьте настройки матрицы компетенций.";
    } else if (totalSkills < 5) {
      response.warning = `Найдено только ${totalSkills} навыков. Возможно, не все данные загружены.`;
    }
    
    console.log('[FORM GET] Request completed successfully');
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('[FORM GET ERROR]', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      token: params?.token?.substring(0, 10) + '...'
    });
    
    // Специальная обработка известных ошибок
    let errorMessage = "Внутренняя ошибка сервера";
    let statusCode = 500;
    
    if (error.message?.includes('NOTION_TOKEN')) {
      errorMessage = "Ошибка конфигурации Notion API";
    } else if (error.message?.includes('Missing environment variables')) {
      errorMessage = "Ошибка конфигурации сервера";
    } else if (error.message?.includes('Module import failed')) {
      errorMessage = "Ошибка загрузки модулей";
    } else if (error.status === 429) {
      errorMessage = "Слишком много запросов. Попробуйте через минуту.";
      statusCode = 429;
    } else if (error instanceof ReferenceError || error instanceof TypeError) {
      console.error('[FORM GET] Code error detected:', error.message);
      errorMessage = process.env.NODE_ENV === 'development' 
        ? `Ошибка кода: ${error.message}` 
        : "Внутренняя ошибка сервера";
    }
    
    return NextResponse.json(
      { 
        error: errorMessage,
        ...(process.env.NODE_ENV === 'development' && { 
          details: error.message,
          stack: error.stack 
        })
      }, 
      { status: statusCode }
    );
  }
}

// POST - сохранение оценок
export async function POST(req, { params }) {
  try {
    console.log('[FORM POST] Starting request processing');
    
    const { token } = params;
    
    // Безопасный импорт модулей
    let tokenModule, notionModule;
    
    try {
      tokenModule = await safeImport("@/lib/token");
      notionModule = await safeImport("@/lib/notion");
    } catch (importError) {
      console.error('[FORM POST] Module import failed:', importError.message);
      return NextResponse.json(
        { 
          error: "Ошибка загрузки модулей сервера",
          details: process.env.NODE_ENV === 'development' ? importError.message : undefined
        }, 
        { status: 500 }
      );
    }
    
    const { verifyReviewToken } = tokenModule;
    const { updateScore, ROLE_TO_FIELD, PerformanceTracker } = notionModule;
    
    // Проверка токена
    let payload;
    try {
      payload = await verifyReviewToken(token);
    } catch (error) {
      return NextResponse.json(
        { error: "Недействительный или истёкший токен" }, 
        { status: 401 }
      );
    }
    
    const { reviewerUserId, role } = payload;
    
    // Парсинг тела запроса
    let body;
    try {
      body = await req.json();
    } catch (error) {
      return NextResponse.json(
        { error: "Некорректный JSON" }, 
        { status: 400 }
      );
    }
    
    console.log(`[FORM POST] Processing submission from reviewer: ${reviewerUserId}, items: ${body.items?.length || 0}`);
    
    // Простая валидация без комментариев
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json(
        { error: "Необходимо предоставить массив элементов для обновления" }, 
        { status: 400 }
      );
    }
    
    // Валидируем каждый элемент
    for (const [index, item] of body.items.entries()) {
      if (!item.pageId || typeof item.value !== 'number' || item.value < 0 || item.value > 5) {
        return NextResponse.json(
          { 
            error: `Некорректный элемент ${index + 1}: требуется pageId и value от 0 до 5`
          }, 
          { status: 400 }
        );
      }
    }
    
    const { items, mode } = { items: body.items, mode: body.mode || "final" };
    
    // Определение поля для обновления
    const scoreField = ROLE_TO_FIELD[role] || ROLE_TO_FIELD.peer;
    console.log(`[FORM POST] Using score field: ${scoreField}`);
    
    // Batch обновление
    PerformanceTracker.start('batch-update');
    const results = [];
    const errors = [];
    
    for (const [index, item] of items.entries()) {
      try {
        console.log(`[FORM POST] Updating item ${index + 1}/${items.length}: ${item.pageId}`);
        
        await updateScore(
          item.pageId, 
          scoreField, 
          item.value, 
          "", // Убираем комментарии
          null // Не обновляем поле комментариев
        );
        
        results.push({ pageId: item.pageId, success: true });
        
      } catch (error) {
        console.error(`[FORM POST] Failed to update ${item.pageId}:`, error.message);
        errors.push({ 
          pageId: item.pageId, 
          error: error.message 
        });
        
        // Для критических ошибок прерываем процесс
        if (error.status === 401 || error.status === 403) {
          throw error;
        }
      }
    }
    
    PerformanceTracker.end('batch-update');
    
    console.log(`[FORM POST] Batch update completed: ${results.length} success, ${errors.length} errors`);
    
    const response = {
      ok: true,
      updated: results.length,
      failed: errors.length,
      mode
    };
    
    // Добавляем детали ошибок если есть
    if (errors.length > 0) {
      response.errors = errors;
      response.message = `Обновлено ${results.length} из ${items.length} записей. ${errors.length} ошибок.`;
    }
    
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('[FORM POST ERROR]', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    if (error.status === 401 || error.status === 403) {
      return NextResponse.json(
        { error: "Нет прав для обновления записей" }, 
        { status: 403 }
      );
    }
    
    if (error.status === 429) {
      return NextResponse.json(
        { error: "Слишком много запросов. Попробуйте через несколько секунд." }, 
        { status: 429 }
      );
    }
    
    return NextResponse.json(
      { 
        error: process.env.NODE_ENV === 'development' 
          ? `Ошибка обновления: ${error.message}` 
          : "Ошибка сохранения данных"
      }, 
      { status: 500 }
    );
  }
}