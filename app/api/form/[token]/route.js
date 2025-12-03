export const runtime = "edge";

import { NextResponse } from "next/server";
import { withErrorHandler, Errors, requireParam } from "@/lib/errorHandler";
import { verifyReviewToken } from "@/lib/token";
import {
  listEvaluateesForReviewerUser,
  fetchEmployeeSkillRowsForReviewerUser,
  getEmployeeNamesByUserIds,
  PerformanceTracker
} from "@/lib/notion";
import { logger } from "@/lib/logger";

// GET - загрузка навыков для оценки
export const GET = withErrorHandler(async (req, { params }) => {
  logger.info('[FORM GET] Starting request');
  PerformanceTracker.start('form-get-total');
  
  const { token } = params;
  requireParam(token, 'token');
  
  logger.debug(`[FORM GET] Token: ${token.substring(0, 10)}...`);
  
  // Верификация токена
  let payload;
  try {
    payload = await verifyReviewToken(token);
    logger.debug('[FORM GET] Token verified:', { 
      reviewerUserId: payload.reviewerUserId,
      role: payload.role
    });
  } catch (tokenError) {
    throw Errors.Unauthorized(
      "Недействительный или истёкший токен",
      "Запросите новую ссылку у администратора"
    );
  }
  
  const { reviewerUserId, role } = payload;

  if (!reviewerUserId) {
    throw Errors.BadRequest("Некорректный токен: отсутствует ID ревьюера");
  }

  // Получаем имя ревьюера
  let reviewerName = reviewerUserId;
  try {
    const nameMap = await getEmployeeNamesByUserIds([reviewerUserId]);
    reviewerName = nameMap.get(reviewerUserId) || reviewerUserId;
  } catch {
    // Игнорируем ошибку получения имени
  }
  
  // Загрузка сотрудников для оценки
  logger.info(`[FORM GET] Loading employees for reviewer: ${reviewerUserId}`);
  PerformanceTracker.start('load-evaluatees');
  
  const employees = await listEvaluateesForReviewerUser(reviewerUserId);
  PerformanceTracker.end('load-evaluatees');
  
  logger.debug(`[FORM GET] Found ${employees?.length || 0} employees`);
  
  if (!employees?.length) {
    throw Errors.NotFound(
      "Нет сотрудников для оценки",
      "Возможно, вам не назначены задачи по оценке"
    );
  }
  
  // Загрузка навыков
  logger.info('[FORM GET] Loading skills...');
  PerformanceTracker.start('load-skills');
  
  const skillGroups = await fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId);
  PerformanceTracker.end('load-skills');
  
  logger.debug(`[FORM GET] Loaded skills for ${skillGroups?.length || 0} groups`);
  
  // Преобразование в плоский список
  const rows = [];
  let totalSkills = 0;
  
  for (const group of skillGroups || []) {
    if (!group?.items) continue;
    
    for (const item of group.items || []) {
      if (!item?.pageId) continue;
      
      rows.push({
        pageId: item.pageId,
        name: item.name || "Неизвестный навык",
        description: item.description || "",
        current: item.current,
        employeeId: group.employeeId,
        employeeName: group.employeeName || "Неизвестный сотрудник",
        role: group.role || "peer"
      });
      totalSkills++;
    }
  }
  
  const totalDuration = PerformanceTracker.end('form-get-total');
  logger.info(`[FORM GET] Completed: ${totalSkills} skills, ${totalDuration}ms`);
  
  const response = {
    rows,
    stats: {
      totalEmployees: employees.length,
      totalSkills,
      reviewerRole: role || 'peer',
      reviewerName,
      loadTime: totalDuration,
      employeeBreakdown: employees.map(e => ({
        employeeId: e.employeeId,
        employeeName: e.employeeName,
        role: e.role
      }))
    }
  };
  
  // Предупреждения
  if (totalSkills === 0) {
    response.warning = "Не найдено навыков для оценки";
    response.debug = {
      employees: employees.map(e => ({ id: e.employeeId, name: e.employeeName, role: e.role })),
      suggestions: [
        "Проверьте поля P1_peer, P2_peer, Manager_scorer в матрице",
        "Убедитесь что поле 'Навык' правильно связано"
      ]
    };
  }
  
  return NextResponse.json(response);
  
}, { operation: 'load-skills-form' });
