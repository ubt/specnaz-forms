export const runtime = "edge";

import { NextResponse } from "next/server";

export async function GET() {
  try {
    console.log('[IMPORT TEST] Starting import diagnostics');
    
    const results = {
      timestamp: new Date().toISOString(),
      runtime: 'edge',
      tests: []
    };
    
    // Тест 1: Основные переменные окружения
    results.tests.push({
      name: 'Environment Variables',
      status: 'testing'
    });
    
    const envVars = {
      NOTION_TOKEN: !!(process.env.NOTION_TOKEN),
      JWT_SECRET: !!(process.env.JWT_SECRET),
      MATRIX_DB_ID: !!(process.env.MATRIX_DB_ID),
      EMPLOYEES_DB_ID: !!(process.env.EMPLOYEES_DB_ID)
    };
    
    results.tests[0].status = Object.values(envVars).every(Boolean) ? 'pass' : 'fail';
    results.tests[0].data = envVars;
    
    // Тест 2: Next.js импорты
    try {
      const { NextResponse: TestNextResponse } = await import("next/server");
      results.tests.push({
        name: 'Next.js Server Imports',
        status: 'pass',
        data: { NextResponse: !!TestNextResponse }
      });
    } catch (error) {
      results.tests.push({
        name: 'Next.js Server Imports',
        status: 'fail',
        error: error.message
      });
    }
    
    // Тест 3: Zod импорт
    try {
      const { z } = await import("zod");
      results.tests.push({
        name: 'Zod Import',
        status: 'pass',
        data: { z: !!z }
      });
    } catch (error) {
      results.tests.push({
        name: 'Zod Import',
        status: 'fail',
        error: error.message
      });
    }
    
    // Тест 4: José JWT импорт
    try {
      const { SignJWT, jwtVerify } = await import("jose");
      results.tests.push({
        name: 'José JWT Import',
        status: 'pass',
        data: { SignJWT: !!SignJWT, jwtVerify: !!jwtVerify }
      });
    } catch (error) {
      results.tests.push({
        name: 'José JWT Import',
        status: 'fail',
        error: error.message
      });
    }
    
    // Тест 5: Notion Client импорт
    try {
      const { Client } = await import("@notionhq/client");
      results.tests.push({
        name: 'Notion Client Import',
        status: 'pass',
        data: { Client: !!Client }
      });
    } catch (error) {
      results.tests.push({
        name: 'Notion Client Import',
        status: 'fail',
        error: error.message
      });
    }
    
    // Тест 6: Локальные модули
    try {
      // Прямой импорт без алиаса
      const tokenModule = await import("../../lib/token.js");
      results.tests.push({
        name: 'Local Token Module (Direct)',
        status: 'pass',
        data: { exports: Object.keys(tokenModule) }
      });
    } catch (error) {
      results.tests.push({
        name: 'Local Token Module (Direct)',
        status: 'fail',
        error: error.message
      });
    }
    
    try {
      // Прямой импорт без алиаса
      const notionModule = await import("../../lib/notion.js");
      results.tests.push({
        name: 'Local Notion Module (Direct)',
        status: 'pass',
        data: { exports: Object.keys(notionModule).slice(0, 10) }
      });
    } catch (error) {
      results.tests.push({
        name: 'Local Notion Module (Direct)',
        status: 'fail',
        error: error.message
      });
    }
    
    // Тест 7: Алиас импорты
    try {
      const tokenModule = await import("@/lib/token");
      results.tests.push({
        name: 'Local Token Module (Alias)',
        status: 'pass',
        data: { exports: Object.keys(tokenModule) }
      });
    } catch (error) {
      results.tests.push({
        name: 'Local Token Module (Alias)',
        status: 'fail',
        error: error.message
      });
    }
    
    try {
      const notionModule = await import("@/lib/notion");
      results.tests.push({
        name: 'Local Notion Module (Alias)',
        status: 'pass',
        data: { exports: Object.keys(notionModule).slice(0, 10) }
      });
    } catch (error) {
      results.tests.push({
        name: 'Local Notion Module (Alias)',
        status: 'fail',
        error: error.message
      });
    }
    
    // Итоговая статистика
    const passCount = results.tests.filter(t => t.status === 'pass').length;
    const failCount = results.tests.filter(t => t.status === 'fail').length;
    
    results.summary = {
      total: results.tests.length,
      passed: passCount,
      failed: failCount,
      success: failCount === 0
    };
    
    console.log('[IMPORT TEST] Completed:', results.summary);
    
    return NextResponse.json(results);
    
  } catch (error) {
    console.error('[IMPORT TEST ERROR]', error);
    
    return NextResponse.json({
      error: 'Import diagnostic failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}