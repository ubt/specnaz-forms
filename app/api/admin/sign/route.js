export const runtime = "edge";

import { NextResponse } from "next/server";
import { withErrorHandler, Errors, assert } from "@/lib/errorHandler";
import { AdminSignRequest } from "@/lib/schema";
import { signReviewToken } from "@/lib/token";
import { findEmployeesByTeam, listReviewersForEmployees, PerformanceTracker } from "@/lib/notion";
import { checkAdminRateLimit } from "@/lib/adminRateLimit";
import { logger } from "@/lib/logger";

function t(s) { return (s || "").trim(); }

// Проверка переменных окружения
function validateEnvironment() {
  const required = {
    ADMIN_KEY: process.env.ADMIN_KEY,
    JWT_SECRET: process.env.JWT_SECRET,
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
    NOTION_TOKEN: process.env.NOTION_TOKEN,
    MATRIX_DB_ID: process.env.MATRIX_DB_ID,
    EMPLOYEES_DB_ID: process.env.EMPLOYEES_DB_ID
  };
  
  const missing = Object.entries(required)
    .filter(([, value]) => !value?.trim())
    .map(([key]) => key);
    
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
  
  return required;
}

export const POST = withErrorHandler(async (req) => {
  PerformanceTracker.start('generate-links');

  // Rate limiting
  const rateLimitResult = checkAdminRateLimit(req);
  if (!rateLimitResult.allowed) {
    return rateLimitResult.response;
  }

  // Проверка окружения
  const env = validateEnvironment();
  
  // Парсинг запроса
  let body = {};
  try { 
    body = await req.json(); 
  } catch {
    throw Errors.BadRequest("Некорректный JSON");
  }

  const parsed = AdminSignRequest.safeParse(body);
  if (!parsed.success) {
    throw Errors.BadRequest(
      "Некорректные параметры",
      parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(", ")
    );
  }

  const { teamName, expDays } = parsed.data;
  logger.info(`[ADMIN] Generating links for team: ${teamName}`);

  // Авторизация
  const hdrKey = t(req.headers.get("x-admin-key"));
  const provided = hdrKey || t(parsed.data.adminKey);
  const required = t(env.ADMIN_KEY);
  
  assert(provided === required, "Неверный ключ администратора", 403);
  
  // Поиск сотрудников
  PerformanceTracker.start('find-employees');
  const employees = await findEmployeesByTeam(teamName);
  PerformanceTracker.end('find-employees');
  
  if (!employees?.length) {
    throw Errors.NotFound(
      `Команда "${teamName}" не найдена`,
      "Проверьте название в базе Notion"
    );
  }

  logger.info(`[ADMIN] Found ${employees.length} employees`);

  // Получение ревьюеров
  PerformanceTracker.start('find-reviewers');
  const reviewers = await listReviewersForEmployees(employees);
  PerformanceTracker.end('find-reviewers');
  
  if (!reviewers?.length) {
    throw Errors.NotFound(
      `Не найдено ревьюеров для "${teamName}"`,
      "Проверьте поля P1_peer, P2_peer, Manager_scorer"
    );
  }

  logger.info(`[ADMIN] Found ${reviewers.length} reviewers`);

  // Генерация токенов
  const exp = Math.floor(Date.now() / 1000) + expDays * 24 * 3600;
  const links = [];
  const errors = [];

  PerformanceTracker.start('generate-tokens');
  
  for (const reviewer of reviewers) {
    try {
      const tokenPayload = { 
        reviewerUserId: reviewer.reviewerUserId, 
        role: reviewer.role || 'peer',
        teamName,
        exp 
      };
      
      const token = await signReviewToken(tokenPayload);
      
      links.push({ 
        name: reviewer.name, 
        url: `${env.NEXT_PUBLIC_BASE_URL}/form/${token}`,
        userId: reviewer.reviewerUserId,
        role: reviewer.role || 'peer'
      });
      
    } catch (error) {
      logger.error(`[ADMIN] Token error for ${reviewer.name}:`, error.message);
      errors.push(`${reviewer.name}: ${error.message}`);
    }
  }
  
  PerformanceTracker.end('generate-tokens');
  
  if (!links.length) {
    throw Errors.InternalServer(
      "Не удалось сгенерировать ссылки",
      errors.join("; ")
    );
  }

  const duration = PerformanceTracker.end('generate-links');
  
  logger.info(`[ADMIN] Generated ${links.length} links in ${duration}ms`);

  const response = {
    ok: true,
    teamName,
    count: links.length,
    links,
    stats: {
      employeeCount: employees.length,
      reviewerCount: reviewers.length,
      generationTime: duration,
      expirationDays: expDays,
      expiresAt: new Date(exp * 1000).toISOString()
    }
  };
  
  if (errors.length > 0) {
    response.warnings = errors;
    response.message = `Сгенерировано ${links.length} из ${reviewers.length}. ${errors.length} ошибок.`;
  }
  
  return NextResponse.json(response);
  
}, { operation: 'admin-sign' });
