export const runtime = "edge";

import { NextResponse } from "next/server";

// Безопасный импорт с обработкой ошибок
async function safeImport(moduleName) {
  try {
    console.log(`[SAFE IMPORT] Attempting to import ${moduleName}`);
    const module = await import(moduleName);
    console.log(`[SAFE IMPORT] Successfully imported ${moduleName}`);
    return module;
  } catch (error) {
    console.error(`[SAFE IMPORT] Failed to import ${moduleName}:`, {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    throw new Error(`Module import failed: ${moduleName} - ${error.message}`);
  }
}

// Проверка окружения
function validateRuntimeEnvironment() {
  const checks = {
    hasTextEncoder: typeof TextEncoder !== 'undefined',
    hasGlobalThis: typeof globalThis !== 'undefined',
    hasProcess: typeof process !== 'undefined',
    hasEnvVars: !!(process?.env?.NOTION_TOKEN && process?.env?.JWT_SECRET),
    runtime: 'edge'
  };
  
  console.log('[ENV CHECK] Runtime environment:', checks);
  
  if (!checks.hasEnvVars) {
    throw new Error('Missing required environment variables');
  }
  
  return checks;
}

// GET - загрузка списка навыков для оценки
export async function GET(req, { params }) {
  try {
    console.log('[FORM GET] ===== Starting request processing =====');
    
    // Проверка среды выполнения
    const envCheck = validateRuntimeEnvironment();
    console.log('[FORM GET] Environment validation passed');
    
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
      console.log('[FORM GET] Starting module imports...');
      
      tokenModule = await safeImport("@/lib/token");
      console.log('[FORM GET] Token module imported, exports:', Object.keys(tokenModule));
      
      notionModule = await safeImport("@/lib/notion");
      console.log('[FORM GET] Notion module imported, exports:', Object.keys(notionModule));
      
      console.log('[FORM GET] All modules imported successfully');
    } catch (importError) {
      console.error('[FORM GET] Module import failed:', {
        message: importError.message,
        stack: importError.stack,
        envCheck
      });
      return NextResponse.json(
        { 
          error: "Ошибка загрузки модулей сервера",
          details: process.env.NODE_ENV === 'development' ? {
            importError: importError.message,
            envCheck
          } : undefined
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
      console.log('[FORM GET] Verifying token...');
      payload = await verifyReviewToken(token);
      console.log('[FORM GET] Token verified successfully:', { 
        reviewerUserId: payload.reviewerUserId,
        role: payload.role,
        exp: payload.exp 
      });
    } catch (tokenError) {
      console.error('[FORM GET] Token verification failed:', {
        message: tokenError.message,
        stack: tokenError.stack
      });
      
      return NextResponse.json(
        { 
          error: "Недействительный или истёкший токен",
          details: process.env.NODE_ENV === 'development' ? tokenError.message : undefined
        }, 
        { status: 401 }
      );
    }
    
    const { reviewerUserId, role } = payload;
    
    if (!reviewerUserId) {
      console.error('[FORM GET] No reviewerUserId in token payload:', payload);
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
      const duration = PerformanceTracker.end('load-evaluatees');
      console.log(`[FORM GET] Found ${employees?.length || 0} employees for evaluation (${duration}ms)`);
    } catch (error) {
      PerformanceTracker.end('load-evaluatees');
      console.error('[FORM GET] Failed to load evaluatees:', {
        message: error.message,
        stack: error.stack,
        reviewerUserId
      });
      
      return NextResponse.json(
        { 
          error: "Ошибка загрузки списка сотрудников для оценки",
          details: process.env.NODE_ENV === 'development' ? {
            originalError: error.message,
            reviewerUserId
          } : "Проверьте настройки матрицы компетенций"
        }, 
        { status: 500 }
      );
    }
    
    if (!employees?.length) {
      console.warn(`[FORM GET] No employees found for reviewer: ${reviewerUserId}`);
      return NextResponse.json(
        { 
          error: "Нет сотрудников для оценки",
          suggestion: "Возможно, вам не назначены задачи по оценке или данные ещё не настроены в системе",
          details: {
            reviewerUserId,
            searchedFor: 'employees to evaluate'
          }
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
      const duration = PerformanceTracker.end('load-skills');
      console.log(`[FORM GET] Loaded skills for ${skillGroups?.length || 0} employees (${duration}ms)`);
    } catch (error) {
      PerformanceTracker.end('load-skills');
      console.error('[FORM GET] Failed to load skills:', {
        message: error.message,
        stack: error.stack,
        employeeCount: employees.length,
        reviewerUserId
      });
      
      return NextResponse.json(
        { 
          error: "Ошибка загрузки навыков",
          details: process.env.NODE_ENV === 'development' ? {
            originalError: error.message,
            employeeCount: employees.length,
            reviewerUserId
          } : "Проверьте настройки матрицы компетенций"
        }, 
        { status: 500 }
      );
    }
    
    // Преобразование в плоский список для UI
    const rows = [];
    let totalSkills = 0;
    
    try {
      console.log('[FORM GET] Processing skill groups...');
      
      for (const group of skillGroups || []) {
        if (!group || !group.items) {
          console.warn(`[FORM GET] Invalid group structure:`, group);
          continue;
        }
        
        for (const item of group.items || []) {
          if (!item || !item.pageId) {
            console.warn(`[FORM GET] Invalid item structure:`, item);
            continue;
          }
          
          rows.push({
            pageId: item.pageId,
            name: item.name || "Неизвестный навык",
            description: item.description || "",
            current: item.current,
            comment: item.comment || "",
            employeeId: group.employeeId,
            employeeName: group.employeeName || "Неизвестный сотрудник",
            role: group.role || "peer"
          });
          totalSkills++;
        }
      }
      
      console.log(`[FORM GET] Successfully prepared ${totalSkills} skills for ${employees.length} employees`);
    } catch (error) {
      console.error('[FORM GET] Failed to process skills data:', {
        message: error.message,
        stack: error.stack,
        skillGroupsCount: skillGroups?.length || 0
      });
      
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
    
    // Добавляем предупреждения если мало данных
    if (totalSkills === 0) {
      response.warning = "Не найдено навыков для оценки. Проверьте настройки матрицы компетенций.";
      console.warn('[FORM GET] No skills found for evaluation');
    } else if (totalSkills < 5) {
      response.warning = `Найдено только ${totalSkills} навыков. Возможно, не все данные загружены.`;
      console.warn(`[FORM GET] Low skill count: ${totalSkills}`);
    }
    
    console.log('[FORM GET] ===== Request completed successfully =====');
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('[FORM GET CRITICAL ERROR]', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      token: params?.token?.substring(0, 10) + '...',
      userAgent: req.headers.get('user-agent')
    });
    
    // Специальная обработка известных ошибок
    let errorMessage = "Внутренняя ошибка сервера";
    let statusCode = 500;
    
    if (error.message?.includes('Missing environment variables')) {
      errorMessage = "Ошибка конфигурации сервера";
    } else if (error.message?.includes('Module import failed')) {
      errorMessage = "Ошибка загрузки модулей";
    } else if (error.message?.includes('TextEncoder')) {
      errorMessage = "Ошибка совместимости среды выполнения";
    } else if (error.status === 429) {
      errorMessage = "Слишком много запросов. Попробуйте через минуту.";
      statusCode = 429;
    } else if (error instanceof ReferenceError || error instanceof TypeError) {
      console.error('[FORM GET] JavaScript error detected:', error.message);
      errorMessage = process.env.NODE_ENV === 'development' 
        ? `Ошибка кода: ${error.message}` 
        : "Внутренняя ошибка сервера";
    }
    
    return NextResponse.json(
      { 
        error: errorMessage,
        ...(process.env.NODE_ENV === 'development' && { 
          details: {
            originalError: error.message,
            stack: error.stack.split('\n').slice(0, 5).join('\n'), // Ограничиваем stack trace
            type: error.constructor.name
          }
        })
      }, 
      { status: statusCode }
    );
  }
}

// POST - сохранение оценок (без изменений, так как проблема в GET)
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
    
    // Простая валидация
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