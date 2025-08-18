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

// GET - загрузка списка навыков для оценки
export async function GET(req, { params }) {
  const operation = 'form-get-skills';
  
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
        { error: "Токен не предоставлен" }, 
        { status: 400 }
      );
    }
    
    console.log(`[FORM GET] Обработка токена: ${token.substring(0, 10)}...`);
    
    // Безопасный импорт модулей
    let tokenModule, notionModule;
    
    try {
      console.log('[FORM GET] Начинаем импорт модулей...');
      
      tokenModule = await safeImport("@/lib/token");
      console.log('[FORM GET] Token модуль импортирован успешно');
      
      notionModule = await safeImport("@/lib/notion");
      console.log('[FORM GET] Notion модуль импортирован успешно');
      
    } catch (importError) {
      console.error('[FORM GET] Ошибка импорта модулей:', importError.message);
      return NextResponse.json(
        { 
          error: "Ошибка загрузки модулей сервера",
          details: process.env.NODE_ENV === 'development' ? importError.message : "Проверьте логи сервера"
        }, 
        { status: 500 }
      );
    }
    
    // Проверяем что все нужные экспорты доступны
    const { verifyReviewToken } = tokenModule;
    const { 
      listEvaluateesForReviewerUser, 
      fetchEmployeeSkillRowsForReviewerUser,
      PerformanceTracker 
    } = notionModule;
    
    if (!verifyReviewToken) {
      console.error('[FORM GET] verifyReviewToken не найден в token модуле');
      return NextResponse.json({ error: "Ошибка конфигурации: функция верификации токена не найдена" }, { status: 500 });
    }
    
    if (!listEvaluateesForReviewerUser || !fetchEmployeeSkillRowsForReviewerUser) {
      console.error('[FORM GET] Обязательные функции не найдены в notion модуле');
      return NextResponse.json({ error: "Ошибка конфигурации: функции Notion не найдены" }, { status: 500 });
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
      console.error('[FORM GET] Ошибка верификации токена:', tokenError.message);
      
      return NextResponse.json(
        { 
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
        { error: "Некорректный токен: отсутствует ID ревьюера" }, 
        { status: 400 }
      );
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
        reviewerUserId,
        stack: error.stack?.split('\n').slice(0, 3).join('\n')
      });
      
      return NextResponse.json(
        { 
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
          error: "Нет сотрудников для оценки",
          suggestion: "Возможно, вам не назначены задачи по оценке или данные ещё не настроены в системе",
          details: {
            reviewerUserId,
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
        employeeCount: employees.length,
        reviewerUserId,
        stack: error.stack?.split('\n').slice(0, 3).join('\n')
      });
      
      return NextResponse.json(
        { 
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
        stack: error.stack?.split('\n').slice(0, 3).join('\n'),
        skillGroupsCount: skillGroups?.length || 0
      });
      
      return NextResponse.json(
        { 
          error: "Ошибка обработки данных навыков",
          details: process.env.NODE_ENV === 'development' ? {
            originalError: error.message,
            skillGroupsCount: skillGroups?.length || 0
          } : undefined
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
    
    // Добавляем предупреждения и диагностическую информацию
    if (totalSkills === 0) {
      console.warn('[FORM GET] Не найдены навыки для оценки');
      
      // Возвращаем детальную диагностику для отладки
      return NextResponse.json({
        error: "Не найдено навыков для оценки",
        debug: {
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
            sampleItems: g.items?.slice(0, 2).map(i => ({ 
              name: i.name, 
              pageId: i.pageId?.substring(0, 8) + '...',
              hasDescription: !!i.description 
            })) || []
          })) : [],
          suggestions: [
            "Проверьте что в матрице компетенций заполнены поля P1_peer, P2_peer, Manager_scorer для ваших сотрудников",
            "Убедитесь что поле 'Навык' в матрице правильно связано с базой навыков",
            "Проверьте что поле 'Описание навыка' заполнено в записях матрицы"
          ]
        }
      }, { status: 404 });
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
        error: errorMessage,
        details,
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV === 'development' && { 
          debug: {
            originalError: error.message,
            stack: error.stack?.split('\n').slice(0, 5).join('\n'),
            type: error.constructor.name
          }
        })
      }, 
      { status: statusCode }
    );
  }
}

// POST - сохранение оценок
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
          error: "Ошибка загрузки модулей сервера",
          details: process.env.NODE_ENV === 'development' ? importError.message : undefined
        }, 
        { status: 500 }
      );
    }
    
    const { verifyReviewToken } = tokenModule;
    const { updateScore, ROLE_TO_FIELD, PerformanceTracker, detectCommentProp } = notionModule;
    
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
    
    console.log(`[FORM POST] Обработка отправки от ревьюера: ${reviewerUserId}, элементов: ${body.items?.length || 0}`);
    
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
    console.log(`[FORM POST] Использование поля оценки: ${scoreField} для роли: ${role}`);
    
    // Определяем поле комментария (опционально)
    let commentField = null;
    try {
      commentField = await detectCommentProp();
      console.log(`[FORM POST] Поле комментария: ${commentField || 'не найдено'}`);
    } catch (error) {
      console.warn(`[FORM POST] Не удалось определить поле комментария: ${error.message}`);
    }
    
    // Batch обновление
    PerformanceTracker?.start('batch-update');
    const results = [];
    const errors = [];
    
    console.log(`[FORM POST] Начинаем обновление ${items.length} элементов...`);
    
    for (const [index, item] of items.entries()) {
      try {
        console.log(`[FORM POST] Обновление элемента ${index + 1}/${items.length}: ${item.pageId} = ${item.value}`);
        
        await updateScore(
          item.pageId, 
          scoreField, 
          item.value, 
          item.comment || "", // Комментарий из формы
          commentField // Поле комментария в БД
        );
        
        results.push({ pageId: item.pageId, success: true });
        console.log(`[FORM POST] ✅ Успешно обновлено: ${item.pageId}`);
        
      } catch (error) {
        console.error(`[FORM POST] ❌ Ошибка обновления ${item.pageId}:`, error.message);
        errors.push({ 
          pageId: item.pageId, 
          error: error.message 
        });
        
        // Для критических ошибок прерываем процесс
        if (error.status === 401 || error.status === 403) {
          console.error(`[FORM POST] Критическая ошибка доступа, прерываем обновление`);
          throw error;
        }
      }
    }
    
    const duration = PerformanceTracker?.end('batch-update') || 0;
    
    console.log(`[FORM POST] Batch обновление завершено за ${duration}ms: ${results.length} успешно, ${errors.length} ошибок`);
    
    const response = {
      ok: true,
      updated: results.length,
      failed: errors.length,
      mode,
      duration
    };
    
    // Добавляем детали ошибок если есть
    if (errors.length > 0) {
      response.errors = errors;
      response.message = `Обновлено ${results.length} из ${items.length} записей. ${errors.length} ошибок.`;
      
      // Логируем первые несколько ошибок для анализа
      console.warn(`[FORM POST] Ошибки обновления:`, errors.slice(0, 5));
    } else {
      response.message = `Успешно обновлено ${results.length} записей`;
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
          : "Ошибка сохранения данных",
        details: process.env.NODE_ENV === 'development' ? {
          originalError: error.message,
          stack: error.stack?.split('\n').slice(0, 3).join('\n')
        } : undefined
      }, 
      { status: 500 }
    );
  }
}