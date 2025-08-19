export const runtime = "edge";

import { NextResponse } from "next/server";

// Явные импорты модулей, чтобы сборщик включил их в бандл
async function importTokenModule() {
  try {
    console.log('[IMPORT] Импорт token модуля...');
    const module = await import("@/lib/token");
    console.log('[IMPORT] Token модуль импортирован');
    return module;
  } catch (error) {
    console.error('[IMPORT] Ошибка импорта token модуля:', error);
    throw new Error(`Ошибка импорта модуля: '@/lib/token' - ${error.message}`);
  }
}

async function importNotionModule() {
  try {
    console.log('[IMPORT] Импорт notion модуля...');
    const module = await import("@/lib/notion");
    console.log('[IMPORT] Notion модуль импортирован');
    return module;
  } catch (error) {
    console.error('[IMPORT] Ошибка импорта notion модуля:', error);
    throw new Error(`Ошибка импорта модуля: '@/lib/notion' - ${error.message}`);
  }
}

// Импорт модуля работы с очередями Cloudflare KV
async function importKVModule() {
  try {
    console.log('[IMPORT] Импорт модуля KV очередей...');
    const module = await import("@/lib/kv-queue");
    console.log('[IMPORT] KV модуль импортирован');
    return module;
  } catch (error) {
    console.error('[IMPORT] Ошибка импорта KV модуля:', error);
    throw new Error(`Ошибка импорта модуля: '@/lib/kv-queue' - ${error.message}`);
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
    
    // Импорт модулей с обработкой ошибок
    let tokenModule, notionModule;

    try {
      console.log('[FORM GET] Начинаем импорт модулей...');

      tokenModule = await importTokenModule();
      console.log('[FORM GET] Token модуль импортирован успешно, экспорты:', Object.keys(tokenModule));

      notionModule = await importNotionModule();
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
      return NextResponse.json({ error: "Ошибка конфигурации: verifyReviewToken не найден" }, { status: 500 });
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
      console.error('[FORM GET] Ошибка верификации токена:', {
        message: tokenError.message,
        stack: tokenError.stack
      });
      
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

    let reviewerName = reviewerUserId;
    try {
      const nameMap = await getEmployeeNamesByUserIds([reviewerUserId]);
      reviewerName = nameMap.get(reviewerUserId) || reviewerUserId;
    } catch (e) {
      console.warn('[FORM GET] Не удалось получить имя ревьюера:', e.message);
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
    
    // ИСПРАВЛЕНО: Преобразование в плоский список для UI с правильной структурой
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
        reviewerRole: role || 'peer',
        reviewerName,
        employeeBreakdown: employees.map(e => ({
          employeeId: e.employeeId,
          employeeName: e.employeeName,
          role: e.role
        }))
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

// POST - сохранение оценок (ИСПРАВЛЕНО)
export async function POST(req, { params }) {
  try {
    console.log('[FORM POST] Начало обработки запроса сохранения оценок');
    
    const { token } = params;
    
    // Импорт модулей
    let tokenModule, notionModule;

    try {
      tokenModule = await importTokenModule();
      notionModule = await importNotionModule();
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
    const { updateScore, ROLE_TO_FIELD, PerformanceTracker } = notionModule;
    
    // Проверка токена
    let payload;
    try {
      payload = await verifyReviewToken(token);
      console.log('[FORM POST] Токен верифицирован:', { 
        reviewerUserId: payload.reviewerUserId, 
        role: payload.role 
      });
    } catch (error) {
      console.error('[FORM POST] Ошибка верификации токена:', error.message);
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
      console.log('[FORM POST] Получены данные:', {
        itemsCount: body.items?.length || 0
      });
    } catch (error) {
      console.error('[FORM POST] Ошибка парсинга JSON:', error.message);
      return NextResponse.json(
        { error: "Некорректный JSON" }, 
        { status: 400 }
      );
    }
    
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
            error: `Некорректный элемент ${index + 1}: требуется pageId и value от 0 до 5`,
            receivedItem: item
          },
          { status: 400 }
        );
      }
      if (item.role && !ROLE_TO_FIELD[item.role]) {
        return NextResponse.json(
          {
            error: `Некорректная роль в элементе ${index + 1}`,
            receivedItem: item
          },
          { status: 400 }
        );
      }
    }
    
    const items = body.items;

    console.log(`[FORM POST] Роль из токена: ${role}`);
    
    // Подготовка операций в формате batch API Notion
    const operations = items.map(item => {
      const itemRole = item.role && ROLE_TO_FIELD[item.role] ? item.role : role;
      const field = ROLE_TO_FIELD[itemRole] || ROLE_TO_FIELD.peer;

      return {
        pageId: item.pageId,
        properties: {
          [field]: { number: item.value }
        }
      };
    });

    // Импортируем модуль очередей KV
    let kvModule;
    try {
      kvModule = await importKVModule();
    } catch (kvError) {
      console.warn('[FORM POST] KV модуль недоступен:', kvError.message);
    }

    const { NotionBatchProcessor, isKVConnected } = kvModule || {};

    // Запускаем обработку через процессор batch операций
    PerformanceTracker?.start('batch-update');

    let result;
    if (NotionBatchProcessor) {
      const processor = new NotionBatchProcessor(notionModule.notion, {
        reviewerUserId,
        useKV: isKVConnected?.() && operations.length > 20
      });
      result = await processor.processBatch(operations);
    } else {
      // Fallback на прямое обновление, если процессор недоступен
      result = {
        mode: 'direct',
        results: await Promise.all(operations.map(op =>
          updateScore(op.pageId, Object.keys(op.properties)[0], op.properties[Object.keys(op.properties)[0]].number).then(() => ({
            operation: op,
            status: 'success'
          }))
        )),
        stats: { total: operations.length, successful: operations.length, failed: 0 }
      };
    }

    const duration = PerformanceTracker?.end('batch-update') || 0;

    console.log(`[FORM POST] Режим обработки: ${result.mode}, элементов: ${operations.length}, время: ${duration}ms`);

    return NextResponse.json({
      ok: true,
      reviewerRole: role,
      duration,
      mode: result.mode,
      ...(result.mode === 'kv_queue'
        ? {
            queued: operations.length,
            jobIds: result.jobIds,
            message: `Операции добавлены в очередь KV. Создано ${result.totalJobs} задач`
          }
        : {
            updated: result.stats.successful,
            message: `Обновлено ${result.stats.successful} из ${result.stats.total} оценок`
          })
    });
    
  } catch (error) {
    console.error('[FORM POST КРИТИЧЕСКАЯ ОШИБКА]', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      token: params?.token?.substring(0, 10) + '...'
    });
    
    if (error.status === 401 || error.status === 403) {
      return NextResponse.json(
        { 
          error: "Нет прав для обновления записей",
          details: "Проверьте права доступа к базе данных Notion"
        }, 
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
          stack: error.stack.split('\n').slice(0, 3).join('\n')
        } : undefined
      }, 
      { status: 500 }
    );
  }
}  