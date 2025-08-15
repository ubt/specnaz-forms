export const runtime = "edge";

import { NextResponse } from "next/server";
import { z } from "zod";
import { signReviewToken } from "@/lib/token";
import { findEmployeesByTeam, listReviewersForEmployees, PerformanceTracker } from "@/lib/notion";

const ReqSchema = z.object({
  teamName: z.string().min(1).max(100),
  expDays: z.number().int().min(1).max(365).default(14),
  adminKey: z.string().optional(),
  cycleId: z.string().optional(), // Для будущего фильтра по циклам
});

function t(s) { return (s || "").trim(); }

export async function POST(req) {
  const operation = 'generate-review-links';
  PerformanceTracker.start(operation);
  
  try {
    // Парсинг заголовков и тела запроса
    const hdrKey = t(req.headers.get("x-admin-key"));
    
    let body = {};
    try { 
      body = await req.json(); 
    } catch {
      return NextResponse.json(
        { error: "Некорректный JSON" }, 
        { status: 400 }
      );
    }
    
    const parsed = ReqSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { 
          error: "Некорректные параметры",
          details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(", ")
        }, 
        { status: 400 }
      );
    }
    
    const { teamName, expDays, cycleId } = parsed.data;

    // Проверка авторизации
    const provided = hdrKey || t(parsed.data.adminKey);
    const required = t(process.env.ADMIN_KEY);
    
    if (!required) {
      console.error('ADMIN_KEY not configured in environment');
      return NextResponse.json(
        { error: "Сервер не настроен. Обратитесь к администратору." }, 
        { status: 500 }
      );
    }
    
    if (provided !== required) {
      console.warn('Unauthorized admin access attempt:', {
        ip: req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for'),
        userAgent: req.headers.get('user-agent'),
        timestamp: new Date().toISOString()
      });
      
      return NextResponse.json(
        { error: "Неверный ключ администратора" }, 
        { status: 403 }
      );
    }

    // Проверка базового URL
    const base = t(process.env.NEXT_PUBLIC_BASE_URL);
    if (!base) {
      console.error('NEXT_PUBLIC_BASE_URL not configured');
      return NextResponse.json(
        { error: "Базовый URL не настроен. Обратитесь к администратору." }, 
        { status: 500 }
      );
    }

    // Поиск сотрудников по команде
    PerformanceTracker.start('find-employees');
    const employees = await findEmployeesByTeam(teamName);
    PerformanceTracker.end('find-employees');
    
    if (!employees?.length) {
      return NextResponse.json(
        { 
          error: `Команда "${teamName}" не найдена или пуста`,
          suggestion: "Проверьте правильность названия команды"
        }, 
        { status: 404 }
      );
    }

    console.log(`Found ${employees.length} employees in team "${teamName}":`, 
      employees.map(e => e.name).join(', ')
    );

    // Получение списка ревьюеров
    PerformanceTracker.start('find-reviewers');
    const reviewers = await listReviewersForEmployees(employees);
    PerformanceTracker.end('find-reviewers');
    
    if (!reviewers?.length) {
      return NextResponse.json(
        { 
          error: `Не найдено ревьюеров для команды "${teamName}"`,
          suggestion: "Убедитесь, что в матрице оценок заполнены поля ревьюеров (P1_peer, P2_peer, Manager_scorer, Self_scorer)"
        }, 
        { status: 404 }
      );
    }

    console.log(`Found ${reviewers.length} reviewers for team "${teamName}"`);

    // Генерация токенов и ссылок
    const exp = Math.floor(Date.now() / 1000) + expDays * 24 * 3600;
    const links = [];
    const errors = [];

    PerformanceTracker.start('generate-tokens');
    
    for (const reviewer of reviewers) {
      try {
        const tokenPayload = { 
          reviewerUserId: reviewer.reviewerUserId, 
          role: reviewer.role,
          teamName, // Добавляем для логирования
          exp 
        };
        
        const token = await signReviewToken(tokenPayload);
        
        links.push({ 
          name: reviewer.name, 
          url: `${base}/form/${token}`,
          userId: reviewer.reviewerUserId,
          role: reviewer.role
        });
        
      } catch (error) {
        console.error(`Failed to generate token for reviewer ${reviewer.name}:`, error);
        errors.push(`${reviewer.name}: ${error.message}`);
      }
    }
    
    PerformanceTracker.end('generate-tokens');
    
    if (!links.length) {
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
    console.log('Review links generated successfully:', {
      teamName,
      employeeCount: employees.length,
      reviewerCount: reviewers.length,
      linkCount: links.length,
      expDays,
      expTimestamp: exp,
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
    
    console.error('POST /api/admin/sign Error:', {
      endpoint: '/api/admin/sign',
      method: 'POST',
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      body: body // Безопасно логируем тело запроса (без паролей)
    });
    
    // Специальная обработка известных ошибок
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
    
    return NextResponse.json(
      { 
        error: process.env.NODE_ENV === 'development' 
          ? error.message 
          : "Внутренняя ошибка сервера. Попробуйте позже."
      }, 
      { status: 500 }
    );
  }
}