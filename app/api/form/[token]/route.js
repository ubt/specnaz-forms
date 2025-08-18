export const runtime = "edge";

import { NextResponse } from "next/server";

// Безопасный импорт с обработкой ошибок
async function safeImport(moduleName) {
  try {
    console.log(`[SAFE IMPORT] Попытка импорта ${moduleName}`);
    const module = await import(moduleName);
    console.log(`[SAFE IMPORT] Успешно импортирован ${moduleName}`);
    return module;
  } catch (error) {
    console.error(`[SAFE IMPORT] Ошибка импорта ${moduleName}:`, {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    throw new Error(`Ошибка импорта модуля: ${moduleName} - ${error.message}`);
  }
}

// Проверка окружения
function validateRuntimeEnvironment() {
  const checks = {
    hasTextEncoder: typeof TextEncoder !== 'undefined',
    hasGlobalThis: typeof globalThis !== 'undefined',
    hasProcess: typeof process !== 'undefined',
    hasEnvVars: !!(process?.env?.NOTION_TOKEN && process?.env?.JWT_SECRET && process?.env?.MATRIX_DB_ID),
    runtime: 'edge'
  };
  
  console.log('[ENV CHECK] Проверка среды выполнения:', checks);
  
  if (!checks.hasEnvVars) {
    console.error('[ENV CHECK] Отсутствуют переменные окружения:', {
      NOTION_TOKEN: !!process?.env?.NOTION_TOKEN,
      JWT_SECRET: !!process?.env?.JWT_SECRET,
      MATRIX_DB_ID: !!process?.env?.MATRIX_DB_ID,
      EMPLOYEES_DB_ID: !!process?.env?.EMPLOYEES_DB_ID
    });
    throw new Error('Отсутствуют обязательные переменные окружения');
  }
  
  return checks;
}

// GET - ИСПРАВЛЕННАЯ загрузка списка навыков для оценки
export async function GET(req, { params }) {
  try {
    console.log('[FORM GET] ===== Начало обработки запроса =====');
    
    // Проверка среды выполнения
    const envCheck = validateRuntimeEnvironment();
    console.log('[FORM GET] Проверка окружения пройдена');
    
    // Проверяем параметры
    const { token } = params;
    if (!token) {
      console.error('[FORM GET] Токен не предоставлен');
      return NextResponse.json(
        { success: false, error: "Токен не предоставлен" }, 
        { status: 400 }
      );
    }
    
    console.log(`[FORM GET] Обработка токена: ${token.substring(0, 10)}...`);
    
    // Безопасный импорт модулей с детальным логированием
    let tokenModule, notionModule;
    
    try {
      console.log('[FORM GET] Начинаем импорт модулей...');
      
      // Импорт token модуля
      console.log('[FORM GET] Импорт token модуля...');
      tokenModule = await safeImport("@/lib/token");
      console.log('[FORM GET] Token модуль импортирован успешно, экспорты:', Object.keys(tokenModule));
      
      // Импорт notion модуля
      console.log('[FORM GET] Импорт notion модуля...');
      notionModule = await safeImport("@/lib/notion");
      console.log('[FORM GET] Notion модуль импортирован успешно, экспорты:', Object.keys(notionModule));
      
      console.log('[FORM GET] Все модули импортированы успешно');
    } catch (importError) {
      console.error('[FORM GET] Ошибка импорта модулей:', {
        message: importError.message,
        stack: importError.stack,
        envCheck
      });
      return NextResponse.json(
        { 
          success: false,
          error: "Ошибка загрузки модулей сервера",
          details: process.env.NODE_ENV === 'development' ? {
            importError: importError.message,
            envCheck,
            moduleName: importError.message.includes('token') ? '@/lib/token' : '@/lib/notion'
          } : "Проверьте логи сервера"
        }, 
        { status: 500 }
      );
    }
    
    // Проверяем что все нужные экспорты доступны
    const { verifyReviewToken } = tokenModule;
    const { 
      listEvaluateesForReviewerUser, 
      fetchEmployeeSkillRowsForReviewerUser,
      getEmployeeNamesByUserIds,
      PerformanceTracker 
    } = notionModule;
    
    if (!verifyReviewToken) {
      console.error('[FORM GET] verifyReviewToken не найден в token модуле');
      return NextResponse.json({ 
        success: false, 
        error: "Ошибка конфигурации: verifyReviewToken не найден" 
      }, { status: 500 });
    }
    
    if (!listEvaluateesForReviewerUser || !fetchEmployeeSkillRowsForReviewerUser) {
      console.error('[FORM GET] Обязательные функции не найдены в notion модуле');
      return NextResponse.json({ 
        success: false, 
        error: "Ошибка конфигурации: функции Notion не найдены" 
      }, { status: 500 });
    }
    
    // Проверка токена
    let payload;
    try {
      console.log('[FORM GET] Верификация токена...');
      payload = await verifyReviewToken(token);
      console.log('[FORM GET] Токен верифицирован успешно:', { 
        reviewerUserId: payload.reviewerUserId,
        role: payload.role,
        exp: payload.exp 
      });
    } catch (tokenError) {
      console.error('[FORM GET] Ошибка верификации токена:', {
        message: tokenError.message,
        stack: tokenError.stack
      });
      
      return NextResponse.json(
        { 
          success: false,
          error: "Недействительный или истёкший токен",
          details: process.env.NODE_ENV === 'development' ? tokenError.message : "Запросите новую ссылку у администратора"
        }, 
        { status: 401 }
      );
    }
    
    const { reviewerUserId, role } = payload;
    
    if (!reviewerUserId) {
      console.error('[FORM GET] Отсутствует reviewerUserId в токене:', payload);
      return NextResponse.json(
        { success: false, error: "Некорректный токен: отсутствует ID ревьюера" }, 
        { status: 400 }
      );
    }

    // ПОЛУЧЕНИЕ ИНФОРМАЦИИ О РЕВЬЮЕРЕ (упрощенная версия)
    let reviewerInfo = { name: `Ревьюер ${reviewerUserId.substring(0, 8)}`, userId: reviewerUserId };
    
    try {
      console.log(`[FORM GET] Загрузка информации о ревьюере: ${reviewerUserId}`);
      
      // Попытка получить имя из базы сотрудников
      if (getEmployeeNamesByUserIds) {
        const nameMap = await getEmployeeNamesByUserIds([reviewerUserId]);
        if (nameMap && nameMap.has(reviewerUserId)) {
          reviewerInfo.name = nameMap.get(reviewerUserId);
          console.log(`[FORM GET] Найдено имя в базе сотрудников: ${reviewerInfo.name}`);
        } else {
          console.log(`[FORM GET] Имя не найдено в базе сотрудников, используем fallback`);
        }
      }
    } catch (reviewerError) {
      console.warn('[FORM GET] Ошибка загрузки информации о ревьюере, используем fallback:', reviewerError.message);
    }
    
    // Загрузка сотрудников для оценки
    console.log(`[FORM GET] Загрузка сотрудников для ревьюера: ${reviewerUserId}`);
    PerformanceTracker?.start('load-evaluatees');
    
    let employees;
    try {
      employees = await listEvaluateesForReviewerUser(reviewerUserId);
      const duration = PerformanceTracker?.end('load-evaluatees') || 0;
      console.log(`[FORM GET] Найдено ${employees?.length || 0} сотрудников для оценки (${duration}ms)`);
    } catch (error) {
      PerformanceTracker?.end('load-evaluatees');
      console.error('[FORM GET] Ошибка загрузки сотрудников:', {
        message: error.message,
        stack: error.stack,
        reviewerUserId
      });
      
      return NextResponse.json(
        { 
          success: false,
          error: "Ошибка загрузки списка сотрудников для оценки",
          details: process.env.NODE_ENV === 'development' ? {
            originalError: error.message,
            reviewerUserId,
            suggestion: "Проверьте настройки матрицы компетенций в Notion"
          } : "Проверьте настройки матрицы компетенций"
        }, 
        { status: 500 }
      );
    }
    
    if (!employees?.length) {
      console.warn(`[FORM GET] Не найдены сотрудники для ревьюера: ${reviewerUserId}`);
      return NextResponse.json(
        { 
          success: false,
          error: "Нет сотрудников для оценки",
          reviewerInfo,
          suggestion: "Возможно, вам не назначены задачи по оценке или данные ещё не настроены в системе",
          details: {
            reviewerUserId,
            searchedFor: 'employees to evaluate',
            hint: "Проверьте поля P1_peer, P2_peer, Manager_scorer, Self_scorer в матрице компетенций"
          }
        }, 
        { status: 404 }
      );
    }
    
    // Загрузка навыков
    console.log('[FORM GET] Загрузка данных навыков...');
    PerformanceTracker?.start('load-skills');
    
    let skillGroups;
    try {
      skillGroups = await fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId);
      const duration = PerformanceTracker?.end('load-skills') || 0;
      console.log(`[FORM GET] Загружены навыки для ${skillGroups?.length || 0} сотрудников (${duration}ms)`);
    } catch (error) {
      PerformanceTracker?.end('load-skills');
      console.error('[FORM GET] Ошибка загрузки навыков:', {
        message: error.message,
        stack: error.stack,
        employeeCount: employees.length,
        reviewerUserId
      });
      
      return NextResponse.json(
        { 
          success: false,
          error: "Ошибка загрузки навыков",
          details: process.env.NODE_ENV === 'development' ? {
            originalError: error.message,
            employeeCount: employees.length,
            reviewerUserId,
            employees: employees.map(e => ({ id: e.employeeId, name: e.employeeName, role: e.role })),
            suggestion: "Проверьте поле 'Навык' в матрице компетенций и связи с базой навыков"
          } : "Проверьте настройки навыков в матрице компетенций"
        }, 
        { status: 500 }
      );
    }
    
    // Преобразование в плоский список для UI
    const rows = [];
    let totalSkills = 0;
    
    try {
      console.log('[FORM GET] Обработка групп навыков...');
      
      for (const group of skillGroups || []) {
        if (!group || !group.items) {
          console.warn(`[FORM GET] Неверная структура группы:`, group);
          continue;
        }
        
        for (const item of group.items || []) {
          if (!item || !item.pageId) {
            console.warn(`[FORM GET] Неверная структура элемента:`, item);
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
      
      console.log(`[FORM GET] Успешно подготовлено ${totalSkills} навыков для ${employees.length} сотрудников`);
    } catch (error) {
      console.error('[FORM GET] Ошибка обработки данных навыков:', {
        message: error.message,
        stack: error.stack,
        skillGroupsCount: skillGroups?.length || 0
      });
      
      return NextResponse.json(
        { 
          success: false,
          error: "Ошибка обработки данных навыков",
          details: process.env.NODE_ENV === 'development' ? {
            originalError: error.message,
            skillGroupsCount: skillGroups?.length || 0
          } : undefined
        }, 
        { status: 500 }
      );
    }
    
    // ИСПРАВЛЕННАЯ структура ответа с обязательным полем success
    const response = {
      success: true,
      data: {
        rows,
        reviewerInfo: {
          name: reviewerInfo.name,
          userId: reviewerInfo.userId,
          role: role || 'peer'
        },
        stats: {
          totalEmployees: employees.length,
          totalSkills,
          reviewerRole: role || 'peer',
          employees: employees.map(e => ({ 
            name: e.employeeName, 
            role: e.role 
          }))
        }
      }
    };
    
    // Добавляем предупреждения и диагностическую информацию
    if (totalSkills === 0) {
      response.warning = "Не найдено навыков для оценки. Проверьте настройки матрицы компетенций.";
      console.warn('[FORM GET] Не найдены навыки для оценки');
      
      // Диагностическая информация для отладки
      response.debug = {
        employees: employees.map(e => ({ 
          id: e.employeeId, 
          name: e.employeeName, 
          role: e.role 
        })),
        skillGroups: skillGroups ? skillGroups.map(g => ({ 
          employeeId: g.employeeId, 
          employeeName: g.employeeName, 
          role: g.role,
          itemsCount: g.items?.length || 0,
          items: g.items?.slice(0, 3).map(i => ({ name: i.name, pageId: i.pageId })) || []
        })) : [],
        suggestions: [
          "Проверьте что в матрице компетенций заполнены поля P1_peer, P2_peer, Manager_scorer для ваших сотрудников",
          "Убедитесь что поле 'Навык' в матрице правильно связано с базой навыков",
          "Проверьте что поле 'Описание навыка' заполнено в записях матрицы"
        ]
      };
    } else if (totalSkills < 5) {
      response.warning = `Найдено только ${totalSkills} навыков. Возможно, не все данные загружены.`;
      console.warn(`[FORM GET] Низкое количество навыков: ${totalSkills}`);
    }
    
    console.log('[FORM GET] ===== Запрос завершён успешно =====');
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('[FORM GET КРИТИЧЕСКАЯ ОШИБКА]', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      token: params?.token?.substring(0, 10) + '...',
      userAgent: req.headers.get('user-agent')
    });
    
    // Специальная обработка известных ошибок
    let errorMessage = "Внутренняя ошибка сервера";
    let statusCode = 500;
    let details = undefined;
    
    if (error.message?.includes('Отсутствуют обязательные переменные окружения')) {
      errorMessage = "Конфигурация сервера неполная";
      details = "Проверьте переменные окружения в Cloudflare Pages";
    } else if (error.message?.includes('Ошибка импорта модуля')) {
      errorMessage = "Ошибка загрузки модулей";
      details = process.env.NODE_ENV === 'development' ? error.message : "Проверьте структуру проекта";
    } else if (error.message?.includes('TextEncoder')) {
      errorMessage = "Ошибка совместимости среды выполнения";
      details = "Проблема с Edge Runtime";
    } else if (error.status === 429) {
      errorMessage = "Слишком много запросов. Попробуйте через минуту.";
      statusCode = 429;
    } else if (error instanceof ReferenceError || error instanceof TypeError) {
      console.error('[FORM GET] Обнаружена ошибка JavaScript:', error.message);
      errorMessage = process.env.NODE_ENV === 'development' 
        ? `Ошибка кода: ${error.message}` 
        : "Внутренняя ошибка сервера";
      details = process.env.NODE_ENV === 'development' ? {
        type: error.constructor.name,
        originalError: error.message
      } : undefined;
    }
    
    return NextResponse.json(
      { 
        success: false,
        error: errorMessage,
        details,
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV === 'development' && { 
          debug: {
            originalError: error.message,
            stack: error.stack.split('\n').slice(0, 5).join('\n'),
            type: error.constructor.name
          }
        })
      }, 
      { status: statusCode }
    );
  }
}

// POST - сохранение оценок (БЕЗ ИЗМЕНЕНИЙ)
export async function POST(req, { params }) {
  try {
    console.log('[FORM POST] Начало обработки запроса');
    
    const { token } = params;
    
    // Безопасный импорт модулей
    let tokenModule, notionModule;
    
    try {
      tokenModule = await safeImport("@/lib/token");
      notionModule = await safeImport("@/lib/notion");
    } catch (importError) {
      console.error('[FORM POST] Ошибка импорта модулей:', importError.message);
      return NextResponse.json(
        { 
          success: false,
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
        { success: false, error: "Недействительный или истёкший токен" }, 
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
        { success: false, error: "Некорректный JSON" }, 
        { status: 400 }
      );
    }
    
    console.log(`[FORM POST] Обработка отправки от ревьюера: ${reviewerUserId}, элементов: ${body.items?.length || 0}`);
    
    // Простая валидация
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json(
        { success: false, error: "Необходимо предоставить массив элементов для обновления" }, 
        { status: 400 }
      );
    }
    
    // Валидируем каждый элемент
    for (const [index, item] of body.items.entries()) {
      if (!item.pageId || typeof item.value !== 'number' || item.value < 0 || item.value > 5) {
        return NextResponse.json(
          { 
            success: false,
            error: `Некорректный элемент ${index + 1}: требуется pageId и value от 0 до 5`
          }, 
          { status: 400 }
        );
      }
    }
    
    const { items, mode } = { items: body.items, mode: body.mode || "final" };
    
    // Определение поля для обновления
    const scoreField = ROLE_TO_FIELD[role] || ROLE_TO_FIELD.peer;
    console.log(`[FORM POST] Использование поля оценки: ${scoreField}`);
    
    // Batch обновление
    PerformanceTracker?.start('batch-update');
    const results = [];
    const errors = [];
    
    for (const [index, item] of items.entries()) {
      try {
        console.log(`[FORM POST] Обновление элемента ${index + 1}/${items.length}: ${item.pageId}`);
        
        await updateScore(
          item.pageId, 
          scoreField, 
          item.value, 
          "", // Убираем комментарии
          null // Не обновляем поле комментариев
        );
        
        results.push({ pageId: item.pageId, success: true });
        
      } catch (error) {
        console.error(`[FORM POST] Ошибка обновления ${item.pageId}:`, error.message);
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
    
    PerformanceTracker?.end('batch-update');
    
    console.log(`[FORM POST] Batch обновление завершено: ${results.length} успешно, ${errors.length} ошибок`);
    
    const response = {
      success: true,
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
    console.error('[FORM POST ОШИБКА]', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    if (error.status === 401 || error.status === 403) {
      return NextResponse.json(
        { success: false, error: "Нет прав для обновления записей" }, 
        { status: 403 }
      );
    }
    
    if (error.status === 429) {
      return NextResponse.json(
        { success: false, error: "Слишком много запросов. Попробуйте через несколько секунд." }, 
        { status: 429 }
      );
    }
    
    return NextResponse.json(
      { 
        success: false,
        error: process.env.NODE_ENV === 'development' 
          ? `Ошибка обновления: ${error.message}` 
          : "Ошибка сохранения данных"
      }, 
      { status: 500 }
    );
  }
}