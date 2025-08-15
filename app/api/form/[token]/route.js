export const runtime = "edge";

import { NextResponse } from "next/server";
import { verifyReviewToken } from "@/lib/token";
import { 
  listEvaluateesForReviewerUser, 
  fetchEmployeeSkillRowsForReviewerUser,
  updateScore,
  detectCommentProp,
  ROLE_TO_FIELD,
  PerformanceTracker 
} from "@/lib/notion";
import { SubmitPayload, ValidationUtils } from "@/lib/schema";

// GET - загрузка списка навыков для оценки
export async function GET(req, { params }) {
  const operation = 'load-review-form';
  PerformanceTracker.start(operation);
  
  try {
    const { token } = params;
    
    if (!token) {
      return NextResponse.json(
        { error: "Токен не предоставлен" }, 
        { status: 400 }
      );
    }
    
    console.log(`[FORM GET] Processing token: ${token.substring(0, 10)}...`);
    
    // Проверка токена
    let payload;
    try {
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
      return NextResponse.json(
        { error: "Некорректный токен: отсутствует ID ревьюера" }, 
        { status: 400 }
      );
    }
    
    // Загрузка сотрудников для оценки
    console.log(`[FORM GET] Loading evaluatees for reviewer: ${reviewerUserId}`);
    PerformanceTracker.start('load-evaluatees');
    
    const employees = await listEvaluateesForReviewerUser(reviewerUserId);
    PerformanceTracker.end('load-evaluatees');
    
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
    
    console.log(`[FORM GET] Found ${employees.length} employees for evaluation`);
    
    // Загрузка навыков
    console.log('[FORM GET] Loading skills data...');
    PerformanceTracker.start('load-skills');
    
    const skillGroups = await fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId);
    PerformanceTracker.end('load-skills');
    
    // Преобразование в плоский список для UI
    const rows = [];
    let totalSkills = 0;
    
    for (const group of skillGroups) {
      for (const item of group.items) {
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
    
    const loadTime = PerformanceTracker.end(operation);
    
    console.log(`[FORM GET] Successfully loaded ${totalSkills} skills for ${employees.length} employees in ${loadTime}ms`);
    
    const response = {
      rows,
      stats: {
        totalEmployees: employees.length,
        totalSkills,
        loadTime,
        reviewerRole: role || 'peer'
      }
    };
    
    // Добавляем предупреждение если мало данных
    if (totalSkills === 0) {
      response.warning = "Не найдено навыков для оценки. Проверьте настройки матрицы компетенций.";
    } else if (totalSkills < 5) {
      response.warning = `Найдено только ${totalSkills} навыков. Возможно, не все данные загружены.`;
    }
    
    return NextResponse.json(response);
    
  } catch (error) {
    PerformanceTracker.end(operation);
    
    console.error('[FORM GET ERROR]', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      token: token?.substring(0, 10) + '...'
    });
    
    // Специальная обработка известных ошибок
    if (error.message?.includes('NOTION_TOKEN')) {
      return NextResponse.json(
        { error: "Ошибка конфигурации Notion API" }, 
        { status: 500 }
      );
    }
    
    if (error.message?.includes('Missing environment variables')) {
      return NextResponse.json(
        { error: "Ошибка конфигурации сервера" }, 
        { status: 500 }
      );
    }
    
    if (error.status === 429) {
      return NextResponse.json(
        { error: "Слишком много запросов. Попробуйте через минуту." }, 
        { status: 429 }
      );
    }
    
    // Если это ReferenceError или TypeError - скорее всего ошибка в коде
    if (error instanceof ReferenceError || error instanceof TypeError) {
      console.error('[FORM GET] Code error detected:', error.message);
      return NextResponse.json(
        { 
          error: process.env.NODE_ENV === 'development' 
            ? `Ошибка кода: ${error.message}` 
            : "Внутренняя ошибка сервера"
        }, 
        { status: 500 }
      );
    }
    
    return NextResponse.json(
      { 
        error: process.env.NODE_ENV === 'development' 
          ? `Внутренняя ошибка: ${error.message}` 
          : "Внутренняя ошибка сервера"
      }, 
      { status: 500 }
    );
  }
}

// POST - сохранение оценок
export async function POST(req, { params }) {
  const operation = 'submit-reviews';
  PerformanceTracker.start(operation);
  
  try {
    const { token } = params;
    
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
    
    console.log(`[FORM POST] Received body:`, { itemsCount: body.items?.length, mode: body.mode });
    
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
    
    // Определение поля для обновления и комментариев
    const scoreField = ROLE_TO_FIELD[role] || ROLE_TO_FIELD.peer;
    const commentProp = await detectCommentProp();
    
    console.log(`[FORM POST] Using score field: ${scoreField}, comment field: ${commentProp || 'none'}`);
    
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
    const totalTime = PerformanceTracker.end(operation);
    
    console.log(`[FORM POST] Batch update completed: ${results.length} success, ${errors.length} errors in ${totalTime}ms`);
    
    const response = {
      ok: true,
      updated: results.length,
      failed: errors.length,
      mode,
      stats: {
        updateTime: totalTime,
        successRate: results.length / items.length
      }
    };
    
    // Добавляем детали ошибок если есть
    if (errors.length > 0) {
      response.errors = errors;
      response.message = `Обновлено ${results.length} из ${items.length} записей. ${errors.length} ошибок.`;
    }
    
    return NextResponse.json(response);
    
  } catch (error) {
    PerformanceTracker.end(operation);
    
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