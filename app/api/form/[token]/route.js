export const runtime = "edge";

import { NextResponse } from "next/server";

// Безопасный импорт с обработкой ошибок
async function safeImport(moduleName) {
  try {
    console.log(`[SAFE IMPORT] Attempting to import ${moduleName}`);
    const module = await import(moduleName);
    console.log(`[SAFE IMPORT] Successfully imported ${moduleName}`);
    return module;
  } catch (error) {
    console.error(`[SAFE IMPORT] Failed to import ${moduleName}:`, {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    throw new Error(`Module import failed: ${moduleName} - ${error.message}`);
  }
}

// Проверка окружения
function validateRuntimeEnvironment() {
  const checks = {
    hasTextEncoder: typeof TextEncoder !== 'undefined',
    hasGlobalThis: typeof globalThis !== 'undefined',
    hasProcess: typeof process !== 'undefined',
    hasEnvVars: !!(process?.env?.NOTION_TOKEN && process?.env?.JWT_SECRET),
    runtime: 'edge'
  };
  
  console.log('[ENV CHECK] Runtime environment:', checks);
  
  if (!checks.hasEnvVars) {
    throw new Error('Missing required environment variables');
  }
  
  return checks;
}

// Обработчик ошибок с детальной диагностикой
function createErrorResponse(error, context = '') {
  console.error(`[ERROR HANDLER] ${context}:`, {
    message: error.message,
    stack: error.stack,
    type: error.constructor.name,
    timestamp: new Date().toISOString()
  });

  let errorMessage = "Внутренняя ошибка сервера";
  let statusCode = 500;
  let details = undefined;

  if (error.message?.includes('Missing environment variables')) {
    errorMessage = "Ошибка конфигурации сервера";
    details = "Проверьте переменные окружения в Cloudflare Pages";
  } else if (error.message?.includes('Module import failed')) {
    errorMessage = "Ошибка загрузки модулей";
    details = process.env.NODE_ENV === 'development' ? error.message : "Проверьте структуру проекта";
  } else if (error.message?.includes('TextEncoder')) {
    errorMessage = "Ошибка совместимости среды выполнения";
    details = "Проблема с Edge Runtime";
  } else if (error.status === 429) {
    errorMessage = "Слишком много запросов. Попробуйте через минуту.";
    statusCode = 429;
  } else if (error instanceof ReferenceError || error instanceof TypeError) {
    console.error('[ERROR HANDLER] JavaScript error detected:', error.message);
    errorMessage = process.env.NODE_ENV === 'development' 
      ? `Ошибка кода: ${error.message}` 
      : "Внутренняя ошибка сервера";
    details = process.env.NODE_ENV === 'development' ? {
      type: error.constructor.name,
      originalError: error.message
    } : undefined;
  } else if (error.message?.includes('Token')) {
    errorMessage = "Ошибка авторизации";
    statusCode = 401;
    details = "Токен недействителен или истек";
  } else if (error.message?.includes('Matrix database')) {
    errorMessage = "Ошибка конфигурации базы данных";
    details = "Проверьте настройки матрицы компетенций в Notion";
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

// GET - загрузка списка навыков для оценки
export async function GET(req, { params }) {
  try {
    console.log('[FORM GET] ===== Starting request processing =====');
    
    // Проверка среды выполнения
    const envCheck = validateRuntimeEnvironment();
    console.log('[FORM GET] Environment validation passed');
    
    // Проверяем параметры
    const { token } = params;
    if (!token) {
      console.error('[FORM GET] No token provided');
      return NextResponse.json(
        { error: "Токен не предоставлен" }, 
        { status: 400 }
      );
    }
    
    console.log(`[FORM GET] Processing token: ${token.substring(0, 10)}...`);
    
    // Безопасный импорт модулей с детальным логированием
    let tokenModule, notionModule;
    
    try {
      console.log('[FORM GET] Starting module imports...');
      
      // Импорт token модуля
      console.log('[FORM GET] Importing token module...');
      tokenModule = await safeImport("@/lib/token");
      console.log('[FORM GET] Token module imported successfully, exports:', Object.keys(tokenModule));
      
      // Импорт notion модуля
      console.log('[FORM GET] Importing notion module...');
      notionModule = await safeImport("@/lib/notion");
      console.log('[FORM GET] Notion module imported successfully, exports:', Object.keys(notionModule));
      
      console.log('[FORM GET] All modules imported successfully');
    } catch (importError) {
      return createErrorResponse(importError, 'Module import');
    }
    
    // Проверяем что все нужные экспорты доступны
    const { verifyReviewToken } = tokenModule;
    const { 
      listEvaluateesForReviewerUser, 
      fetchEmployeeSkillRowsForReviewerUser,
      PerformanceTracker 
    } = notionModule;
    
    if (!verifyReviewToken) {
      console.error('[FORM GET] verifyReviewToken not found in token module');
      return NextResponse.json({ error: "Ошибка конфигурации: verifyReviewToken не найден" }, { status: 500 });
    }
    
    if (!listEvaluateesForReviewerUser || !fetchEmployeeSkillRowsForReviewerUser) {
      console.error('[FORM GET] Required functions not found in notion module');
      return NextResponse.json({ error: "Ошибка конфигурации: функции Notion не найдены" }, { status: 500 });
    }
    
    // Проверка токена
    let payload;
    try {
      console.log('[FORM GET] Verifying token...');
      payload = await verifyReviewToken(token);
      console.log('[FORM GET] Token verified successfully:', { 
        reviewerUserId: payload.reviewerUserId,
        role: payload.role,
        exp: payload.exp 
      });
    } catch (tokenError) {
      console.error('[FORM GET] Token verification failed:', {
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
      console.error('[FORM GET] No reviewerUserId in token payload:', payload);
      return NextResponse.json(
        { error: "Некорректный токен: отсутствует ID ревьюера" }, 
        { status: 400 }
      );
    }
    
    // Загрузка сотрудников для оценки
    console.log(`[FORM GET] Loading evaluatees for reviewer: ${reviewerUserId}`);
    PerformanceTracker?.start('load-evaluatees');
    
    let employees;
    try {
      employees = await listEvaluateesForReviewerUser(reviewerUserId);
      const duration = PerformanceTracker?.end('load-evaluatees') || 0;
      console.log(`[FORM GET] Found ${employees?.length || 0} employees for evaluation (${duration}ms)`);
    } catch (error) {
      PerformanceTracker?.end('load-evaluatees');
      console.error('[FORM GET] Failed to load evaluatees:', {
        message: error.message,
        stack: error.stack,
        reviewerUserId
      });
      
      return createErrorResponse(error, 'Load evaluatees');
    }
    
    if (!employees?.length) {
      console.warn(`[FORM GET] No employees found for reviewer: ${reviewerUserId}`);
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
    console.log('[FORM GET] Loading skills data...');
    PerformanceTracker?.start('load-skills');
    
    let skillGroups;
    try {
      skillGroups = await fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId);
      const duration = PerformanceTracker?.end('load-skills') || 0;
      console.log(`[FORM GET] Loaded skills for ${skillGroups