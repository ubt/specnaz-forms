export const runtime = "edge";

import { NextResponse } from "next/server";

export async function GET() {
  try {
    console.log('[DEBUG] Starting environment check');
    
    // Проверяем переменные окружения
    const envCheck = {
      NOTION_TOKEN: !!(process.env.NOTION_TOKEN),
      MATRIX_DB_ID: !!(process.env.MATRIX_DB_ID),
      EMPLOYEES_DB_ID: !!(process.env.EMPLOYEES_DB_ID),
      JWT_SECRET: !!(process.env.JWT_SECRET),
      ADMIN_KEY: !!(process.env.ADMIN_KEY),
      NEXT_PUBLIC_BASE_URL: !!(process.env.NEXT_PUBLIC_BASE_URL)
    };
    
    console.log('[DEBUG] Environment variables:', envCheck);
    
    // Попробуем импортировать модули
    let importErrors = [];
    
    try {
      const { notion } = await import("@/lib/notion");
      console.log('[DEBUG] Notion client imported successfully');
    } catch (error) {
      importErrors.push(`Notion import: ${error.message}`);
    }
    
    try {
      const { verifyReviewToken } = await import("@/lib/token");
      console.log('[DEBUG] Token module imported successfully');
    } catch (error) {
      importErrors.push(`Token import: ${error.message}`);
    }
    
    // Проверяем Notion API
    let notionCheck = null;
    try {
      const { notion } = await import("@/lib/notion");
      // Пробуем простой запрос
      const testUser = await notion.users.me();
      notionCheck = { status: 'ok', user: testUser.name || 'Unknown' };
      console.log('[DEBUG] Notion API working:', testUser.name);
    } catch (error) {
      notionCheck = { status: 'error', message: error.message };
      console.error('[DEBUG] Notion API error:', error.message);
    }
    
    const result = {
      timestamp: new Date().toISOString(),
      runtime: 'edge',
      environment: envCheck,
      importErrors,
      notionCheck,
      nodeEnv: process.env.NODE_ENV
    };
    
    console.log('[DEBUG] Final result:', result);
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error('[DEBUG] Critical error:', error);
    
    return NextResponse.json({
      error: 'Debug endpoint failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}