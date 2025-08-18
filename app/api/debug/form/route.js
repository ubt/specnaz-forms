export const runtime = "edge";

import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { token } = await req.json();
    
    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }
    
    const diagnostics = {
      timestamp: new Date().toISOString(),
      token: token.substring(0, 10) + "...",
      steps: []
    };
    
    // Шаг 1: Проверка окружения
    diagnostics.steps.push({ step: 1, name: "environment", status: "starting" });
    
    const envCheck = {
      NOTION_TOKEN: !!(process.env.NOTION_TOKEN),
      MATRIX_DB_ID: !!(process.env.MATRIX_DB_ID),
      EMPLOYEES_DB_ID: !!(process.env.EMPLOYEES_DB_ID),
      JWT_SECRET: !!(process.env.JWT_SECRET)
    };
    
    const allEnvGood = Object.values(envCheck).every(Boolean);
    
    diagnostics.steps.push({ 
      step: 1, 
      name: "environment", 
      status: allEnvGood ? "success" : "error",
      data: envCheck,
      error: allEnvGood ? undefined : "Missing environment variables"
    });
    
    if (!allEnvGood) {
      return NextResponse.json(diagnostics, { status: 500 });
    }
    
    // Шаг 2: Проверка импортов
    diagnostics.steps.push({ step: 2, name: "imports", status: "starting" });
    
    try {
      const { verifyReviewToken } = await import("@/lib/token");
      const { notion } = await import("@/lib/notion");
      
      diagnostics.steps.push({ 
        step: 2, 
        name: "imports", 
        status: "success",
        data: { tokenImport: true, notionImport: true }
      });
    } catch (error) {
      diagnostics.steps.push({ 
        step: 2, 
        name: "imports", 
        status: "error", 
        error: error.message 
      });
      return NextResponse.json(diagnostics, { status: 500 });
    }
    
    // Шаг 3: Проверка токена
    diagnostics.steps.push({ step: 3, name: "token_verification", status: "starting" });
    
    try {
      const { verifyReviewToken } = await import("@/lib/token");
      const payload = await verifyReviewToken(token);
      
      diagnostics.steps.push({ 
        step: 3, 
        name: "token_verification", 
        status: "success",
        payload: {
          reviewerUserId: payload.reviewerUserId,
          role: payload.role,
          exp: payload.exp,
          teamName: payload.teamName
        }
      });
    } catch (error) {
      diagnostics.steps.push({ 
        step: 3, 
        name: "token_verification", 
        status: "error", 
        error: error.message 
      });
      return NextResponse.json(diagnostics, { status: 401 });
    }
    
    // Шаг 4: Проверка доступа к Notion
    diagnostics.steps.push({ step: 4, name: "notion_access", status: "starting" });
    
    try {
      const { notion } = await import("@/lib/notion");
      const user = await notion.users.me();
      
      diagnostics.steps.push({ 
        step: 4, 
        name: "notion_access", 
        status: "success",
        data: {
          user_name: user.name || 'Unknown',
          user_type: user.type
        }
      });
    } catch (error) {
      diagnostics.steps.push({ 
        step: 4, 
        name: "notion_access", 
        status: "error", 
        error: error.message,
        status_code: error.status
      });
    }
    
    // Шаг 5: Тест простого запроса к базе данных
    diagnostics.steps.push({ step: 5, name: "database_test", status: "starting" });
    
    try {
      const { notion, MATRIX_DB_ID } = await import("@/lib/notion");
      
      const db = await notion.databases.retrieve({ database_id: MATRIX_DB_ID });
      
      diagnostics.steps.push({ 
        step: 5, 
        name: "database_test", 
        status: "success",
        data: {
          title: db.title?.[0]?.plain_text || "Unknown",
          properties_count: Object.keys(db.properties).length,
          some_properties: Object.keys(db.properties).slice(0, 5)
        }
      });
    } catch (error) {
      diagnostics.steps.push({ 
        step: 5, 
        name: "database_test", 
        status: "error", 
        error: error.message,
        status_code: error.status
      });
    }
    
    diagnostics.summary = {
      allStepsCompleted: diagnostics.steps.every(step => step.status === "success" || step.status === "skipped"),
      totalSteps: diagnostics.steps.length,
      successfulSteps: diagnostics.steps.filter(step => step.status === "success").length,
      errors: diagnostics.steps.filter(step => step.status === "error").map(step => step.error)
    };
    
    return NextResponse.json(diagnostics);
    
  } catch (error) {
    console.error('[DEBUG FORM ERROR]', error);
    
    return NextResponse.json({
      error: "Diagnostic failed",
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}