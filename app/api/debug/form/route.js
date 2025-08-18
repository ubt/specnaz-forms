export const runtime = "edge";

import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { token } = await req.json();
    
    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }
    
    console.log(`[FORM DEBUG] Debugging token: ${token.substring(0, 10)}...`);
    
    const diagnostic = {
      timestamp: new Date().toISOString(),
      token: token.substring(0, 10) + "...",
      tokenLength: token.length,
      steps: []
    };
    
    // Шаг 1: Анализ структуры токена
    diagnostic.steps.push({ step: 1, name: "token_structure", status: "starting" });
    
    try {
      const parts = token.split('.');
      const structureAnalysis = {
        totalParts: parts.length,
        partsLengths: parts.map(p => p.length),
        expectedParts: 3,
        validStructure: parts.length === 3 && parts.every(p => p.length > 0)
      };
      
      // Попытка декодирования заголовка
      try {
        const header = JSON.parse(atob(parts[0]));
        structureAnalysis.header = header;
      } catch {
        structureAnalysis.headerError = "Failed to decode header";
      }
      
      // Попытка декодирования payload (без проверки подписи)
      try {
        const payload = JSON.parse(atob(parts[1]));
        structureAnalysis.payload = {
          reviewerUserId: payload.reviewerUserId,
          role: payload.role,
          exp: payload.exp,
          teamName: payload.teamName
        };
      } catch {
        structureAnalysis.payloadError = "Failed to decode payload";
      }
      
      diagnostic.steps.push({
        step: 1,
        name: "token_structure",
        status: structureAnalysis.validStructure ? "success" : "error",
        data: structureAnalysis,
        error: structureAnalysis.validStructure ? undefined : "Invalid JWT structure"
      });
      
      if (!structureAnalysis.validStructure) {
        return NextResponse.json(diagnostic, { status: 400 });
      }
      
    } catch (error) {
      diagnostic.steps.push({
        step: 1,
        name: "token_structure",
        status: "error",
        error: error.message
      });
      return NextResponse.json(diagnostic, { status: 400 });
    }
    
    // Шаг 2: Проверка переменных окружения
    diagnostic.steps.push({ step: 2, name: "environment", status: "starting" });
    
    const envCheck = {
      JWT_SECRET: !!(process.env.JWT_SECRET),
      JWT_SECRET_length: process.env.JWT_SECRET?.length || 0,
      NOTION_TOKEN: !!(process.env.NOTION_TOKEN),
      MATRIX_DB_ID: !!(process.env.MATRIX_DB_ID),
      EMPLOYEES_DB_ID: !!(process.env.EMPLOYEES_DB_ID)
    };
    
    const criticalEnvMissing = !envCheck.JWT_SECRET || !envCheck.NOTION_TOKEN;
    
    diagnostic.steps.push({
      step: 2,
      name: "environment",
      status: criticalEnvMissing ? "error" : "success",
      data: envCheck,
      error: criticalEnvMissing ? "Missing critical environment variables" : undefined
    });
    
    if (criticalEnvMissing) {
      return NextResponse.json(diagnostic, { status: 500 });
    }
    
    // Шаг 3: Импорт модулей
    diagnostic.steps.push({ step: 3, name: "imports", status: "starting" });
    
    try {
      const tokenModule = await import("@/lib/token");
      const notionModule = await import("@/lib/notion");
      
      diagnostic.steps.push({
        step: 3,
        name: "imports",
        status: "success",
        exports: {
          token: Object.keys(tokenModule),
          notion: Object.keys(notionModule).slice(0, 10)
        }
      });
    } catch (error) {
      diagnostic.steps.push({
        step: 3,
        name: "imports",
        status: "error",
        error: error.message
      });
      return NextResponse.json(diagnostic, { status: 500 });
    }
    
    // Шаг 4: Верификация токена
    diagnostic.steps.push({ step: 4, name: "token_verification", status: "starting" });
    
    try {
      const { verifyReviewToken } = await import("@/lib/token");
      const payload = await verifyReviewToken(token);
      
      diagnostic.steps.push({
        step: 4,
        name: "token_verification",
        status: "success",
        payload: {
          reviewerUserId: payload.reviewerUserId,
          role: payload.role,
          exp: payload.exp,
          teamName: payload.teamName,
          isExpired: payload.exp && payload.exp < Math.floor(Date.now() / 1000),
          expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null
        }
      });
    } catch (error) {
      diagnostic.steps.push({
        step: 4,
        name: "token_verification",
        status: "error",
        error: error.message
      });
      
      // Не возвращаем ошибку сразу, продолжаем диагностику
    }
    
    // Шаг 5: Проверка доступа к Notion (если токен валиден)
    const tokenValid = diagnostic.steps.find(s => s.name === "token_verification")?.status === "success";
    
    if (tokenValid) {
      diagnostic.steps.push({ step: 5, name: "notion_test", status: "starting" });
      
      try {
        const { notion } = await import("@/lib/notion");
        const user = await notion.users.me();
        
        diagnostic.steps.push({
          step: 5,
          name: "notion_test",
          status: "success",
          data: {
            user_name: user.name || 'Unknown',
            user_type: user.type
          }
        });
      } catch (error) {
        diagnostic.steps.push({
          step: 5,
          name: "notion_test",
          status: "error",
          error: error.message,
          status_code: error.status
        });
      }
    }
    
    diagnostic.summary = {
      allStepsCompleted: diagnostic.steps.every(step => step.status === "success" || step.status === "skipped"),
      totalSteps: diagnostic.steps.length,
      successfulSteps: diagnostic.steps.filter(step => step.status === "success").length,
      errors: diagnostic.steps.filter(step => step.status === "error"),
      recommendations: []
    };
    
    // Добавляем рекомендации
    if (diagnostic.summary.errors.length > 0) {
      const tokenError = diagnostic.summary.errors.find(e => e.name === "token_verification");
      if (tokenError) {
        if (tokenError.error.includes("Invalid Compact JWS")) {
          diagnostic.summary.recommendations.push("Токен поврежден или обрезан. Сгенерируйте новый токен в админ-панели.");
        } else if (tokenError.error.includes("expired")) {
          diagnostic.summary.recommendations.push("Токен истек. Сгенерируйте новый токен в админ-панели.");
        } else if (tokenError.error.includes("JWT_SECRET")) {
          diagnostic.summary.recommendations.push("Проблема с JWT_SECRET. Проверьте переменные окружения в Cloudflare Pages.");
        }
      }
      
      const envError = diagnostic.summary.errors.find(e => e.name === "environment");
      if (envError) {
        diagnostic.summary.recommendations.push("Настройте переменные окружения в Cloudflare Pages Dashboard.");
      }
    }
    
    return NextResponse.json(diagnostic);
    
  } catch (error) {
    console.error('[FORM DEBUG ERROR]', error);
    
    return NextResponse.json({
      error: "Diagnostic failed",
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}