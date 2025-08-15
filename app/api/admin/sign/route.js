export const runtime = "edge";
export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { z } from "zod";

// Безопасные импорты с обработкой ошибок
async function safeImport(modulePath) {
  try {
    return await import(modulePath);
  } catch (error) {
    console.error(`[IMPORT ERROR] Failed to import ${modulePath}:`, error.message);
    throw new Error(`Module import failed: ${modulePath} - ${error.message}`);
  }
}

const ReqSchema = z.object({
  teamName: z.string().min(1).max(100),
  expDays: z.number().int().min(1).max(365).default(14),
  adminKey: z.string().optional(),
  cycleId: z.string().optional(),
});

function t(s) { return (s || "").trim(); }

// Улучшенная проверка переменных окружения с детальной диагностикой
function validateEnvironment() {
  console.log('[ENV CHECK] Starting environment validation...');
  
  const required = {
    ADMIN_KEY: process.env.ADMIN_KEY,
    JWT_SECRET: process.env.JWT_SECRET,
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
    NOTION_TOKEN: process.env.NOTION_TOKEN,
    MATRIX_DB_ID: process.env.MATRIX_DB_ID,
    EMPLOYEES_DB_ID: process.env.EMPLOYEES_DB_ID
  };
  
  // Детальная проверка каждой переменной
  const validation = {};
  for (const [key, value] of Object.entries(required)) {
    const exists = !!value;
    const hasContent = exists && value.trim().length > 0;
    const isValidLength = hasContent && value.trim().length > 3;
    
    validation[key] = {
      exists,
      hasContent,
      isValidLength,
      length: exists ? value.length : 0,
      preview: exists ? `${value.substring(0, 8)}...` : 'undefined'
    };
    
    console.log(`[ENV CHECK] ${key}: exists=${exists}, hasContent=${hasContent}, length=${validation[key].length}`);
  }
  
  const missing = Object.entries(validation)
    .filter(([key, info]) => !info.isValidLength)
    .map(([key]) => key);
    
  if (missing.length > 0) {
    console.error('[ENV CHECK] Missing or invalid environment variables:', missing);
    throw new Error(`Missing or invalid environment variables: ${missing.join(', ')}`);
  }
  
  console.log('[ENV CHECK] ✅ All environment variables are valid');
  return required;
}

export async function POST(req) {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  console.log(`[${requestId}] === ADMIN REQUEST START ===`);
  console.log(`[${requestId}] Runtime: ${process.env.VERCEL_REGION || 'edge'}`);
  console.log(`[${requestId}] URL: ${req.url}`);
  
  let body = {};
  let env = {};
  
  try {
    // 1. Проверка окружения
    console.log(`[${requestId}] Step 1: Environment validation`);
    env = validateEnvironment();
    
    // 2. Парсинг заголовков и тела
    console.log(`[${requestId}] Step 2: Request parsing`);
    const hdrKey = t(req.headers.get("x-admin-key"));
    
    try {
      body = await req.json();
      console.log(`[${requestId}] Request body:`, { 
        teamName: body.teamName, 
        expDays: body.expDays,
        hasAdminKey: !!body.adminKey 
      });
    } catch (parseError) {
      console.error(`[${requestId}] JSON parse error:`, parseError.message);
      return NextResponse.json(
        { error: "Некорректный JSON в теле запроса" }, 
        { status: 400 }
      );
    }
    
    // 3. Валидация схемы
    console.log(`[${requestId}] Step 3: Schema validation`);
    const parsed = ReqSchema.safeParse(body);
    if (!parsed.success) {
      console.error(`[${requestId}] Schema validation failed:`, parsed.error.issues);
      return NextResponse.json(
        { 
          error: "Некорректные параметры",
          details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(", ")
        }, 
        { status: 400 }
      );
    }
    
    const { teamName, expDays, cycleId } = parsed.data;
    
    // 4. Проверка авторизации
    console.log(`[${requestId}] Step 4: Authorization check`);
    const provided = hdrKey || t(parsed.data.adminKey);
    const required = t(env.ADMIN_KEY);
    
    if (provided !== required) {
      console.warn(`[${requestId}] Unauthorized access attempt:`, {
        hasHeader: !!hdrKey,
        hasBodyKey: !!parsed.data.adminKey,
        providedLength: provided.length,
        requiredLength: required.length
      });
      
      return NextResponse.json(
        { error: "Неверный ключ администратора" }, 
        { status: 403 }
      );
    }
    
    // 5. Безопасные импорты модулей
    console.log(`[${requestId}] Step 5: Module imports`);
    let tokenModule, notionModule;
    
    try {
      tokenModule = await safeImport("@/lib/token");
      notionModule = await safeImport("@/lib/notion");
      console.log(`[${requestId}] ✅ All modules imported successfully`);
    } catch (importError) {
      console.error(`[${requestId}] Module import failed:`, importError.message);
      return NextResponse.json(
        { 
          error: "Ошибка загрузки модулей сервера",
          details: process.env.NODE_ENV === 'development' ? importError.message : undefined
        }, 
        { status: 500 }
      );
    }
    
    const { signReviewToken } = tokenModule;
    const { 
      findEmployeesByTeam, 
      listReviewersForEmployees, 
      PerformanceTracker 
    } = notionModule;
    
    // 6. Поиск сотрудников команды
    console.log(`[${requestId}] Step 6: Finding employees for team: ${teamName}`);
    const employeesStartTime = Date.now();
    
    const employees = await Promise.race([
      findEmployeesByTeam(teamName),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout: Employee search took too long')), 15000)
      )
    ]);
    
    const employeesTime = Date.now() - employeesStartTime;
    console.log(`[${requestId}] Employee search completed in ${employeesTime}ms`);
    
    if (!employees?.length) {
      console.warn(`[${requestId}] No employees found for team: ${teamName}`);
      return NextResponse.json(
        { 
          error: `Команда "${teamName}" не найдена или пуста`,
          suggestion: "Проверьте правильность названия команды в базе данных Notion",
          debug: {
            searchTime: employeesTime,
            teamName: teamName
          }
        }, 
        { status: 404 }
      );
    }

    console.log(`[${requestId}] ✅ Found ${employees.length} employees:`, 
      employees.map(e => `${e.name} (${e.userIds.length} userIds)`).join(', ')
    );

    // 7. Получение списка ревьюеров
    console.log(`[${requestId}] Step 7: Finding reviewers`);
    const reviewersStartTime = Date.now();
    
    const reviewers = await Promise.race([
      listReviewersForEmployees(employees),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout: Reviewer search took too long')), 15000)
      )
    ]);
    
    const reviewersTime = Date.now() - reviewersStartTime;
    console.log(`[${requestId}] Reviewer search completed in ${reviewersTime}ms`);
    
    if (!reviewers?.length) {
      console.warn(`[${requestId}] No reviewers found for team: ${teamName}`);
      return NextResponse.json(
        { 
          error: `Не найдено ревьюеров для команды "${teamName}"`,
          suggestion: "Убедитесь, что в матрице оценок заполнены поля ревьюеров",
          debug: {
            employeeCount: employees.length,
            searchTime: reviewersTime
          }
        }, 
        { status: 404 }
      );
    }

    console.log(`[${requestId}] ✅ Found ${reviewers.length} reviewers`);

    // 8. Генерация токенов и ссылок
    console.log(`[${requestId}] Step 8: Generating tokens and links`);
    const tokenStartTime = Date.now();
    const exp = Math.floor(Date.now() / 1000) + expDays * 24 * 3600;
    const links = [];
    const errors = [];

    for (const [index, reviewer] of reviewers.entries()) {
      try {
        console.log(`[${requestId}] Generating token ${index + 1}/${reviewers.length} for: ${reviewer.name}`);
        
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
        const errorMsg = `${reviewer.name}: ${error.message}`;
        console.error(`[${requestId}] Token generation failed for ${reviewer.name}:`, error.message);
        errors.push(errorMsg);
      }
    }
    
    const tokenTime = Date.now() - tokenStartTime;
    console.log(`[${requestId}] Token generation completed in ${tokenTime}ms`);
    
    if (!links.length) {
      console.error(`[${requestId}] Failed to generate any links`);
      return NextResponse.json(
        { 
          error: "Не удалось сгенерировать ни одной ссылки",
          details: errors.join("; "),
          debug: {
            reviewerCount: reviewers.length,
            errors: errors
          }
        }, 
        { status: 500 }
      );
    }

    const totalTime = Date.now() - startTime;
    
    // Успешный ответ с детальной статистикой
    console.log(`[${requestId}] === SUCCESS === Total time: ${totalTime}ms`);

    const response = {
      ok: true,
      teamName,
      count: links.length,
      links,
      stats: {
        employeeCount: employees.length,
        reviewerCount: reviewers.length,
        linkCount: links.length,
        expirationDays: expDays,
        expiresAt: new Date(exp * 1000).toISOString(),
        performance: {
          totalTime,
          employeeSearchTime: employeesTime,
          reviewerSearchTime: reviewersTime,
          tokenGenerationTime: tokenTime
        }
      }
    };
    
    if (errors.length > 0) {
      response.warnings = errors;
      response.message = `Сгенерировано ${links.length} ссылок из ${reviewers.length} ревьюеров. ${errors.length} ошибок.`;
    }
    
    console.log(`[${requestId}] === REQUEST END ===`);
    return NextResponse.json(response);
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    
    console.error(`[${requestId}] === CRITICAL ERROR === Time: ${totalTime}ms`);
    console.error(`[${requestId}] Error details:`, {
      name: error.name,
      message: error.message,
      stack: error.stack,
      body: { ...body, adminKey: body.adminKey ? '[REDACTED]' : undefined },
      env: Object.keys(env).reduce((acc, key) => ({
        ...acc,
        [key]: env[key] ? '[SET]' : '[MISSING]'
      }), {}),
      timestamp: new Date().toISOString()
    });
    
    // Детальная обработка известных ошибок
    let errorResponse = { error: "Внутренняя ошибка сервера" };
    let statusCode = 500;
    
    if (error.message?.includes('Missing environment variables')) {
      errorResponse = {
        error: "Ошибка конфигурации сервера",
        details: process.env.NODE_ENV === 'development' ? error.message : "Обратитесь к администратору"
      };
    } else if (error.message?.includes('Module import failed')) {
      errorResponse = {
        error: "Ошибка загрузки модулей сервера",
        details: process.env.NODE_ENV === 'development' ? error.message : "Попробуйте позже"
      };
    } else if (error.message?.includes('Timeout')) {
      errorResponse = {
        error: "Превышено время ожидания",
        details: "Операция заняла слишком много времени. Попробуйте с меньшей командой или позже."
      };
      statusCode = 408;
    } else if (error.message?.includes('NOTION')) {
      errorResponse = {
        error: "Ошибка Notion API",
        details: process.env.NODE_ENV === 'development' ? error.message : "Проверьте подключение к Notion"
      };
    } else if (error.status === 429) {
      errorResponse = {
        error: "Слишком много запросов к Notion API",
        details: "Попробуйте через минуту"
      };
      statusCode = 429;
    } else if (error.status === 401 || error.status === 403) {
      errorResponse = {
        error: "Ошибка доступа к Notion API",
        details: "Проверьте токен и права доступа"
      };
    }
    
    // Добавляем отладочную информацию в development
    if (process.env.NODE_ENV === 'development') {
      errorResponse.debug = {
        requestId,
        totalTime,
        errorName: error.name,
        stack: error.stack?.split('\n').slice(0, 5)
      };
    }
    
    return NextResponse.json(errorResponse, { status: statusCode });
  }
}