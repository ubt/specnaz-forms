export const runtime = "edge";

import { NextResponse } from "next/server";
import { verifyReviewToken } from "@/lib/token";
import { SubmitPayload } from "@/lib/schema";
import {
  listEvaluateesForReviewerUser,
  fetchEmployeeSkillRowsForReviewerUser,
  ROLE_TO_FIELD,
  batchUpdateScores,
  detectCommentProp,
  PerformanceTracker,
} from "@/lib/notion";

function t(s) { return (s || "").trim(); }

export async function GET(req, { params }) {
  const operation = `load-skills-${params.token?.substring(0, 8)}`;
  PerformanceTracker.start(operation);
  
  try {
    // Верификация токена
    const payload = await verifyReviewToken(params.token);
    const reviewerUserId = t(payload?.reviewerUserId);
    
    if (!reviewerUserId) {
      return NextResponse.json(
        { error: "Недействительный токен" }, 
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
    
    // Получаем список сотрудников для оценки
    PerformanceTracker.start('get-evaluatees');
    const { evaluatees, warning } = await listEvaluateesForReviewerUser(reviewerUserId);
    PerformanceTracker.end('get-evaluatees');
    
    if (!evaluatees?.length) {
      return NextResponse.json(
        { 
          rows: [], 
          warning: warning || "no_employees",
          message: "Нет сотрудников для оценки"
        }, 
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    
    // Получаем навыки для всех сотрудников оптимизированным способом
    PerformanceTracker.start('fetch-skills');
    const skillsData = await fetchEmployeeSkillRowsForReviewerUser(evaluatees, reviewerUserId);
    PerformanceTracker.end('fetch-skills');
    
    // Преобразуем в плоский список для совместимости с фронтендом
    const rows = [];
    for (const evaluatee of evaluatees) {
      const employeeData = skillsData[evaluatee.employeeId];
      if (!employeeData || !employeeData.items) continue;
      
      for (const item of employeeData.items) {
        rows.push({
          pageId: item.pageId,
          name: item.skillName,
          description: item.description,
          current: item.current,
          comment: item.comment || "",
          employeeId: evaluatee.employeeId,
          employeeName: evaluatee.employeeName,
          role: employeeData.role
        });
      }
    }
    
    const duration = PerformanceTracker.end(operation);
    
    return NextResponse.json(
      { 
        rows,
        stats: {
          totalEmployees: evaluatees.length,
          totalSkills: rows.length,
          loadTime: duration
        }
      }, 
      { headers: { "Cache-Control": "no-store" } }
    );
    
  } catch (error) {
    PerformanceTracker.end(operation);
    
    console.error('GET /api/form/[token] Error:', {
      endpoint: '/api/form/[token]',
      method: 'GET',
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      token: params.token?.substring(0, 10) + '...'
    });
    
    // Пользовательские ошибки для частых проблем
    if (error.name === 'JWTExpired') {
      return NextResponse.json(
        { error: "Ссылка истекла. Запросите новую ссылку у администратора." }, 
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
    
    if (error.name === 'JWTInvalid') {
      return NextResponse.json(
        { error: "Недействительная ссылка" }, 
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
    
    return NextResponse.json(
      { 
        error: process.env.NODE_ENV === 'development' 
          ? error.message 
          : "Ошибка загрузки данных. Попробуйте обновить страницу."
      }, 
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function POST(req, { params }) {
  const operation = `submit-scores-${params.token?.substring(0, 8)}`;
  PerformanceTracker.start(operation);
  
  try {
    // Верификация токена
    const payload = await verifyReviewToken(params.token);
    const reviewerUserId = t(payload?.reviewerUserId);
    const role = t(payload?.role);
    
    if (!reviewerUserId) {
      return NextResponse.json(
        { error: "Недействительный токен" }, 
        { status: 401 }
      );
    }

    // Парсинг и валидация данных
    let body = {};
    try { 
      body = await req.json(); 
    } catch {
      return NextResponse.json(
        { error: "Некорректный JSON" }, 
        { status: 400 }
      );
    }
    
    const parsed = SubmitPayload.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { 
          error: "Некорректные данные", 
          details: parsed.error.issues.map(i => i.message).join(", ")
        }, 
        { status: 400 }
      );
    }

    const { items, mode } = parsed.data;
    
    if (!items.length) {
      return NextResponse.json(
        { error: "Нет данных для сохранения" }, 
        { status: 400 }
      );
    }
    
    // Определяем поле для записи оценок и комментариев
    const field = ROLE_TO_FIELD[role] || ROLE_TO_FIELD.p1_peer; // fallback
    const commentProp = await detectCommentProp();
    
    // Валидация: проверяем, что все pageId существуют и доступны пользователю
    PerformanceTracker.start('validate-access');
    const { evaluatees } = await listEvaluateesForReviewerUser(reviewerUserId);
    const skillsData = await fetchEmployeeSkillRowsForReviewerUser(evaluatees, reviewerUserId);
    
    const allowedPageIds = new Set();
    for (const employeeData of Object.values(skillsData)) {
      if (employeeData.items) {
        employeeData.items.forEach(item => allowedPageIds.add(item.pageId));
      }
    }
    
    // Фильтруем только разрешенные страницы
    const validItems = items.filter(item => allowedPageIds.has(item.pageId));
    PerformanceTracker.end('validate-access');
    
    if (!validItems.length) {
      return NextResponse.json(
        { error: "Нет доступных для обновления записей" }, 
        { status: 403 }
      );
    }
    
    if (validItems.length !== items.length) {
      console.warn(`Filtered ${items.length - validItems.length} unauthorized items`, {
        reviewerUserId,
        role,
        requestedCount: items.length,
        validCount: validItems.length
      });
    }
    
    // Батчевое обновление оценок
    PerformanceTracker.start('update-scores');
    await batchUpdateScores(validItems, field, commentProp);
    PerformanceTracker.end('update-scores');
    
    const duration = PerformanceTracker.end(operation);
    
    console.log('Scores updated successfully:', {
      reviewerUserId,
      role,
      field,
      itemsCount: validItems.length,
      mode,
      duration
    });

    return NextResponse.json({ 
      ok: true, 
      role,
      updated: validItems.length,
      stats: {
        updateTime: duration,
        mode
      }
    });
    
  } catch (error) {
    PerformanceTracker.end(operation);
    
    console.error('POST /api/form/[token] Error:', {
      endpoint: '/api/form/[token]',
      method: 'POST',
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      token: params.token?.substring(0, 10) + '...'
    });
    
    // Специальная обработка ошибок Notion API
    if (error.status === 429) {
      return NextResponse.json(
        { error: "Слишком много запросов. Попробуйте через несколько секунд." }, 
        { status: 429 }
      );
    }
    
    if (error.status === 400 && error.message?.includes('validation')) {
      return NextResponse.json(
        { error: "Ошибка валидации данных в Notion" }, 
        { status: 400 }
      );
    }
    
    if (error.name === 'JWTExpired') {
      return NextResponse.json(
        { error: "Ссылка истекла. Запросите новую ссылку у администратора." }, 
        { status: 401 }
      );
    }
    
    return NextResponse.json(
      { 
        error: process.env.NODE_ENV === 'development' 
          ? error.message 
          : "Ошибка сохранения данных. Попробуйте еще раз."
      }, 
      { status: 500 }
    );
  }
}