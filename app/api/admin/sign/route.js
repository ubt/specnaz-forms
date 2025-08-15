export const runtime = "edge";

import { NextResponse } from "next/server";
import { z } from "zod";
import { signReviewToken } from "@/lib/token";
import { findEmployeesByTeam, listReviewersForEmployees, PerformanceTracker } from "@/lib/notion";

const ReqSchema = z.object({
  teamName: z.string().min(1).max(100),
  expDays: z.number().int().min(1).max(365).default(14),
  adminKey: z.string().optional(),
  cycleId: z.string().optional(),
});

function t(s) { return (s || "").trim(); }

// Проверка обязательных переменных окружения
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
    .filter(([key, value]) => !value?.trim())
    .map(([key]) => key);
    
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
  
  return required;
}

export async function POST(req) {
  const operation = 'generate-review-links';
  PerformanceTracker.start(operation);
  
  let body = {};
  
  try {
    // Проверяем переменные окружения в первую очередь
    console.log('[ENV CHECK] Validating environment variables...');
    const env = validateEnvironment();
    console.log('[ENV CHECK] All required environment variables are present');
    
    // Парсинг заголовков и тела запроса
    const hdrKey = t(req.headers.get("x-admin-key"));
    
    try { 
      body = await req.json(); 
    } catch (parseError) {
      console.error('[PARSE ERROR]', parseError.message);
      return NextResponse.json(
        { error: "Некорректный JSON в теле запроса" }, 
        { status: 400 }
      );
    }
    
    console.log('[REQUEST] Parsing request body...', { teamName: body.teamName, expDays: body.expDays });
    
    const parsed = ReqSchema.safeParse(body);
    if (!parsed.success) {
      console.error('[VALIDATION ERROR]', parsed.error.issues);
      return NextResponse.json(
        { 
          error: "Некорректные параметры",
          details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(", ")
        }, 
        { status: 400 }
      );
    }
    
    const { teamName, expDays, cycleId } = parsed.data;
    console.log('[REQUEST] Validated parameters:', { teamName, expDays });

    // Проверка авторизации
    const provided = hdrKey || t(parsed.data.adminKey);
    const required = t(env.ADMIN_KEY);
    
    if (provided !== required) {
      console.warn('[AUTH] Unauthorized admin access attempt:', {
        hasHeader: !!hdrKey,
        hasBodyKey: !!parsed.data.adminKey,
        timestamp: new Date().toISOString()
      });
      
      return NextResponse.json(
        { error: "Неверный ключ администратора" }, 
        { status: 403 }
      );
    }
    
    console.log('[AUTH] Admin authorization successful');

    // Поиск сотрудников по команде
    console.log('[STEP 1] Searching for employees in team:', teamName);
    PerformanceTracker.start('find-employees');
    
    const employees = await findEmployeesByTeam(teamName);
    PerformanceTracker.end('find-employees');
    
    if (!employees?.length) {
      console.warn('[STEP 1] No employees found for team:', teamName);
      return NextResponse.json(
        { 
          error: `Команда "${teamName}" не найдена или пуста`,
          suggestion: "Проверьте правильность названия команды в базе данных Notion"
        }, 
        { status: 404 }
      );
    }

    console.log(`[STEP 1] Found ${employees.length} employees:`, 
      employees.map(e => `${e.name} (${e.userIds.length} userIds)`).join(', ')
    );

    // Получение списка ревьюеров
    console.log('[STEP 2] Finding reviewers for employees...');
    PerformanceTracker.start('find-reviewers');
    
    const reviewers = await listReviewersForEmployees(employees);
    PerformanceTracker.end('find-reviewers');
    
    if (!reviewers?.length) {
      console.warn('[STEP 2] No reviewers found for team:', teamName);
      return NextResponse.json(
        { 
          error: `Не найдено ревьюеров для команды "${teamName}"`,
          suggestion: "Убедитесь, что в матрице оценок заполнены поля ревьюеров (P1_peer, P2_peer, Manager_scorer, Self_scorer)"
        }, 
        { status: 404 }
      );
    }

    console.log(`[STEP 2] Found ${reviewers.length} reviewers`);

    // Генерация токенов и ссылок
    console.log('[STEP 3] Generating tokens and links...');
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
        
        console.log(`[TOKEN] Generating for reviewer: ${reviewer.name} (${reviewer.reviewerUserId})`);
        const token = await signReviewToken(tokenPayload);
        
        links.push({ 
          name: reviewer.name, 
          url: `${env.NEXT_PUBLIC_BASE_URL}/form/${token}`,
          userId: reviewer.reviewerUserId,
          role: reviewer.role || 'peer'
        });
        
      } catch (error) {
        console.error(`[TOKEN] Failed to generate token for reviewer ${reviewer.name}:`, error);
        errors.push(`${reviewer.name}: ${error.message}`);
      }
    }
    
    PerformanceTracker.end('generate-tokens');
    
    if (!links.length) {
      console.error('[STEP 3] Failed to generate any links');
      return NextResponse.json(
        { 
          error: "Не удалось сгенерировать ни одной ссылки",
          details: errors.join("; ")
        }, 
        { status: 500 }
      );
    }

    const duration = PerformanceTracker.end(operation);
    
    // Логирование успешной генерации
    console.log('[SUCCESS] Review links generated successfully:', {
      teamName,
      employeeCount: employees.length,
      reviewerCount: reviewers.length,
      linkCount: links.length,
      expDays,
      duration,
      errors: errors.length > 0 ? errors : undefined
    });

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
    
    // Добавляем предупреждения если были ошибки
    if (errors.length > 0) {
      response.warnings = errors;
      response.message = `Сгенерировано ${links.length} ссылок из ${reviewers.length} ревьюеров. ${errors.length} ошибок.`;
    }
    
    return NextResponse.json(response);
    
  } catch (error) {
    PerformanceTracker.end(operation);
    
    console.error('[CRITICAL ERROR] POST /api/admin/sign:', {
      error: error.message,
      stack: error.stack,
      body: { ...body, adminKey: body.adminKey ? '[REDACTED]' : undefined },
      timestamp: new Date().toISOString()
    });
    
    // Детальная обработка известных ошибок
    if (error.message?.includes('Missing environment variables')) {
      return NextResponse.json(
        { 
          error: "Ошибка конфигурации сервера",
          details: process.env.NODE_ENV === 'development' ? error.message : "Обратитесь к администратору"
        }, 
        { status: 500 }
      );
    }
    
    if (error.message?.includes('NOTION_TOKEN')) {
      return NextResponse.json(
        { error: "Ошибка конфигурации Notion API. Обратитесь к администратору." }, 
        { status: 500 }
      );
    }
    
    if (error.message?.includes('DATABASE_ID')) {
      return NextResponse.json(
        { error: "Ошибка конфигурации баз данных. Обратитесь к администратору." }, 
        { status: 500 }
      );
    }
    
    if (error.status === 429) {
      return NextResponse.json(
        { error: "Слишком много запросов к Notion API. Попробуйте через минуту." }, 
        { status: 429 }
      );
    }
    
    if (error.status === 401 || error.status === 403) {
      return NextResponse.json(
        { error: "Ошибка доступа к Notion API. Проверьте токен и права доступа." }, 
        { status: 500 }
      );
    }
    
    // Общая ошибка
    return NextResponse.json(
      { 
        error: process.env.NODE_ENV === 'development' 
          ? `Внутренняя ошибка: ${error.message}` 
          : "Внутренняя ошибка сервера. Попробуйте позже.",
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      }, 
      { status: 500 }
    );
  }
}