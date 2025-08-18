export const runtime = "edge";

import { NextResponse } from "next/server";

// GET - загрузка списка навыков для оценки
export async function GET(req, { params }) {
  try {
    console.log('[FORM GET] ===== Начало обработки запроса =====');
    
    const { token } = params;
    if (!token) {
      console.error('[FORM GET] Токен не предоставлен');
      return NextResponse.json(
        { success: false, error: "Токен не предоставлен" }, 
        { status: 400 }
      );
    }
    
    console.log(`[FORM GET] Обработка токена: ${token.substring(0, 10)}...`);
    
    // Импорт модулей
    let tokenModule, notionModule;
    
    try {
      console.log('[FORM GET] Импорт модулей...');
      tokenModule = await import("@/lib/token");
      notionModule = await import("@/lib/notion");
      console.log('[FORM GET] Модули импортированы успешно');
    } catch (importError) {
      console.error('[FORM GET] Ошибка импорта модулей:', importError.message);
      return NextResponse.json(
        { 
          success: false,
          error: "Ошибка загрузки модулей сервера",
          details: importError.message
        }, 
        { status: 500 }
      );
    }
    
    // Проверяем что все нужные функции доступны
    const { verifyReviewToken } = tokenModule;
    const { 
      listEvaluateesForReviewerUser, 
      fetchEmployeeSkillRowsForReviewerUser,
      getEmployeeNamesByUserIds
    } = notionModule;
    
    if (!verifyReviewToken) {
      console.error('[FORM GET] verifyReviewToken не найден в token модуле');
      return NextResponse.json({ 
        success: false, 
        error: "Ошибка конфигурации: verifyReviewToken не найден",
        available: Object.keys(tokenModule)
      }, { status: 500 });
    }
    
    if (!listEvaluateesForReviewerUser || !fetchEmployeeSkillRowsForReviewerUser) {
      console.error('[FORM GET] Обязательные функции не найдены в notion модуле');
      return NextResponse.json({ 
        success: false, 
        error: "Ошибка конфигурации: функции Notion не найдены",
        available: Object.keys(notionModule)
      }, { status: 500 });
    }
    
    // Проверка токена
    let payload;
    try {
      console.log('[FORM GET] Верификация токена...');
      payload = await verifyReviewToken(token);
      console.log('[FORM GET] Токен верифицирован успешно:', { 
        reviewerUserId: payload.reviewerUserId,
        role: payload.role 
      });
    } catch (tokenError) {
      console.error('[FORM GET] Ошибка верификации токена:', tokenError.message);
      return NextResponse.json(
        { 
          success: false,
          error: "Недействительный или истёкший токен"
        }, 
        { status: 401 }
      );
    }
    
    const { reviewerUserId, role } = payload;
    
    if (!reviewerUserId) {
      console.error('[FORM GET] Отсутствует reviewerUserId в токене');
      return NextResponse.json(
        { success: false, error: "Некорректный токен: отсутствует ID ревьюера" }, 
        { status: 400 }
      );
    }

    // Получение информации о ревьюере (упрощенная версия)
    let reviewerInfo = { 
      name: `Ревьюер ${reviewerUserId.substring(0, 8)}`, 
      userId: reviewerUserId,
      role: role || 'peer'
    };
    
    try {
      console.log(`[FORM GET] Попытка загрузить имя ревьюера: ${reviewerUserId}`);
      
      if (getEmployeeNamesByUserIds) {
        const nameMap = await getEmployeeNamesByUserIds([reviewerUserId]);
        if (nameMap && nameMap.has(reviewerUserId)) {
          reviewerInfo.name = nameMap.get(reviewerUserId);
          console.log(`[FORM GET] ✅ Найдено имя в базе сотрудников: ${reviewerInfo.name}`);
        } else {
          console.log(`[FORM GET] Имя не найдено в базе сотрудников, используем fallback`);
        }
      }
    } catch (reviewerError) {
      console.warn('[FORM GET] Ошибка загрузки информации о ревьюере:', reviewerError.message);
    }
    
    // Загрузка сотрудников для оценки
    console.log(`[FORM GET] Загрузка сотрудников для ревьюера: ${reviewerUserId}`);
    
    let employees;
    try {
      employees = await listEvaluateesForReviewerUser(reviewerUserId);
      console.log(`[FORM GET] ✅ Найдено ${employees?.length || 0} сотрудников для оценки`);
    } catch (error) {
      console.error('[FORM GET] Ошибка загрузки сотрудников:', error.message);
      return NextResponse.json(
        { 
          success: false,
          error: "Ошибка загрузки списка сотрудников для оценки",
          details: error.message
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
          suggestion: "Возможно, вам не назначены задачи по оценке или данные ещё не настроены в системе"
        }, 
        { status: 404 }
      );
    }
    
    // Загрузка навыков
    console.log('[FORM GET] Загрузка данных навыков...');
    
    let skillGroups;
    try {
      skillGroups = await fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId);
      console.log(`[FORM GET] ✅ Загружены навыки для ${skillGroups?.length || 0} сотрудников`);
    } catch (error) {
      console.error('[FORM GET] Ошибка загрузки навыков:', error.message);
      return NextResponse.json(
        { 
          success: false,
          error: "Ошибка загрузки навыков",
          details: error.message
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
      
      console.log(`[FORM GET] ✅ Успешно подготовлено ${totalSkills} навыков для ${employees.length} сотрудников`);
    } catch (error) {
      console.error('[FORM GET] Ошибка обработки данных навыков:', error.message);
      return NextResponse.json(
        { 
          success: false,
          error: "Ошибка обработки данных навыков",
          details: error.message
        }, 
        { status: 500 }
      );
    }
    
    // Формируем правильную структуру ответа
    const response = {
      success: true,
      data: {
        rows,
        reviewerInfo: {
          name: reviewerInfo.name,
          userId: reviewerInfo.userId,
          role: reviewerInfo.role
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
    
    // Добавляем предупреждения если необходимо
    if (totalSkills === 0) {
      response.warning = "Не найдено навыков для оценки. Проверьте настройки матрицы компетенций.";
      console.warn('[FORM GET] ⚠️ Не найдены навыки для оценки');
    } else if (totalSkills < 5) {
      response.warning = `Найдено только ${totalSkills} навыков. Возможно, не все данные загружены.`;
      console.warn(`[FORM GET] ⚠️ Низкое количество навыков: ${totalSkills}`);
    }
    
    console.log('[FORM GET] ===== Запрос завершён успешно =====');
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('[FORM GET КРИТИЧЕСКАЯ ОШИБКА]', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    return NextResponse.json(
      { 
        success: false,
        error: "Внутренняя ошибка сервера",
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        timestamp: new Date().toISOString()
      }, 
      { status: 500 }
    );
  }
}

// POST - сохранение оценок
export async function POST(req, { params }) {
  try {
    console.log('[FORM POST] Начало обработки запроса');
    
    const { token } = params;
    
    // Импорт модулей
    let tokenModule, notionModule;
    
    try {
      tokenModule = await import("@/lib/token");
      notionModule = await import("@/lib/notion");
    } catch (importError) {
      console.error('[FORM POST] Ошибка импорта модулей:', importError.message);
      return NextResponse.json(
        { 
          success: false,
          error: "Ошибка загрузки модулей сервера"
        }, 
        { status: 500 }
      );
    }
    
    const { verifyReviewToken } = tokenModule;
    const { updateScore, ROLE_TO_FIELD } = notionModule;
    
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
    
    // Последовательное обновление для избежания "too many subrequests"
    const results = [];
    const errors = [];
    
    for (const [index, item] of items.entries()) {
      try {
        console.log(`[FORM POST] Обновление элемента ${index + 1}/${items.length}: ${item.pageId}`);
        
        await updateScore(
          item.pageId, 
          scoreField, 
          item.value, 
          "", // Комментарий
          null // Поле комментария
        );
        
        results.push({ pageId: item.pageId, success: true });
        
        // Небольшая задержка между запросами для избежания rate limiting
        if (index < items.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
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
    
    console.log(`[FORM POST] ✅ Обновление завершено: ${results.length} успешно, ${errors.length} ошибок`);
    
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
        error: "Ошибка сохранения данных"
      }, 
      { status: 500 }
    );
  }
}