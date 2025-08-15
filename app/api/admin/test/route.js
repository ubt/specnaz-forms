// app/api/admin/test/route.js
export const runtime = "edge";

import { NextResponse } from "next/server";

export async function GET() {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    runtime: "edge",
    environment: process.env.NODE_ENV,
    headers: {}
  };

  try {
    // Проверка переменных окружения
    const envVars = [
      'NOTION_TOKEN',
      'MATRIX_DB_ID', 
      'EMPLOYEES_DB_ID',
      'JWT_SECRET',
      'ADMIN_KEY',
      'NEXT_PUBLIC_BASE_URL'
    ];

    diagnostics.environment_check = {};
    envVars.forEach(varName => {
      const value = process.env[varName];
      diagnostics.environment_check[varName] = {
        exists: !!value,
        hasContent: !!(value && value.trim()),
        length: value ? value.length : 0,
        preview: value ? `${value.substring(0, 8)}...` : 'undefined'
      };
    });

    // Проверка импортов
    diagnostics.import_check = {};
    
    try {
      const tokenModule = await import("@/lib/token");
      diagnostics.import_check.token = {
        success: true,
        exports: Object.keys(tokenModule)
      };
    } catch (error) {
      diagnostics.import_check.token = {
        success: false,
        error: error.message
      };
    }

    try {
      const notionModule = await import("@/lib/notion");
      diagnostics.import_check.notion = {
        success: true,
        exports: Object.keys(notionModule).slice(0, 10) // Первые 10 экспортов
      };
    } catch (error) {
      diagnostics.import_check.notion = {
        success: false,
        error: error.message
      };
    }

    // Тест Notion API (если токен есть)
    if (process.env.NOTION_TOKEN) {
      try {
        const { notion } = await import("@/lib/notion");
        const user = await notion.users.me();
        diagnostics.notion_api = {
          success: true,
          user_name: user.name || 'Unknown',
          user_type: user.type
        };
      } catch (error) {
        diagnostics.notion_api = {
          success: false,
          error: error.message,
          status: error.status
        };
      }
    }

    // Общая оценка готовности
    const envReady = Object.values(diagnostics.environment_check).every(check => check.hasContent);
    const importsReady = Object.values(diagnostics.import_check).every(check => check.success);
    const notionReady = diagnostics.notion_api?.success ?? false;

    diagnostics.summary = {
      environment_ready: envReady,
      imports_ready: importsReady,
      notion_ready: notionReady,
      overall_ready: envReady && importsReady && notionReady
    };

    return NextResponse.json(diagnostics);

  } catch (error) {
    return NextResponse.json({
      error: 'Diagnostic test failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      ...diagnostics
    }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { teamName, adminKey } = body;

    if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
      return NextResponse.json(
        { error: 'Invalid admin key' },
        { status: 403 }
      );
    }

    // Тест поиска команды
    const { findEmployeesByTeam } = await import("@/lib/notion");
    const employees = await findEmployeesByTeam(teamName);

    return NextResponse.json({
      success: true,
      teamName,
      employees: employees.map(e => ({
        name: e.name,
        userCount: e.userIds.length
      })),
      employeeCount: employees.length
    });

  } catch (error) {
    return NextResponse.json({
      error: 'Team search test failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}