// app/api/debug/route.js
export const runtime = "edge";

import { NextResponse } from "next/server";
import { notion, MATRIX_DB_ID, EMPLOYEES_DB_ID } from "@/lib/notion";

export async function GET(request) {
  try {
    console.log('[DEBUG] Starting debug checks...');
    
    const results = {
      timestamp: new Date().toISOString(),
      environment: {
        hasNotionToken: !!process.env.NOTION_TOKEN,
        hasMatrixDbId: !!process.env.MATRIX_DB_ID,
        hasEmployeesDbId: !!process.env.EMPLOYEES_DB_ID,
        matrixDbId: process.env.MATRIX_DB_ID?.substring(0, 8) + '...',
        employeesDbId: process.env.EMPLOYEES_DB_ID?.substring(0, 8) + '...',
      },
      tests: {}
    };
    
    // Тест 1: Проверка подключения к Notion API
    try {
      console.log('[DEBUG] Testing Notion API connection...');
      const user = await notion.users.me();
      results.tests.notionConnection = {
        success: true,
        user: user.name || user.id
      };
    } catch (error) {
      results.tests.notionConnection = {
        success: false,
        error: error.message,
        status: error.status
      };
    }
    
    // Тест 2: Проверка доступа к базе сотрудников
    try {
      console.log('[DEBUG] Testing employees database access...');
      const db = await notion.databases.retrieve({ 
        database_id: EMPLOYEES_DB_ID 
      });
      results.tests.employeesDatabase = {
        success: true,
        title: db.title?.[0]?.plain_text || 'No title',
        properties: Object.keys(db.properties || {})
      };
    } catch (error) {
      results.tests.employeesDatabase = {
        success: false,
        error: error.message,
        status: error.status
      };
    }
    
    // Тест 3: Проверка доступа к базе матрицы
    try {
      console.log('[DEBUG] Testing matrix database access...');
      const db = await notion.databases.retrieve({ 
        database_id: MATRIX_DB_ID 
      });
      results.tests.matrixDatabase = {
        success: true,
        title: db.title?.[0]?.plain_text || 'No title',
        properties: Object.keys(db.properties || {})
      };
    } catch (error) {
      results.tests.matrixDatabase = {
        success: false,
        error: error.message,
        status: error.status
      };
    }
    
    // Тест 4: Проверка поиска команды (если указана в query)
    const url = new URL(request.url);
    const teamName = url.searchParams.get('team');
    if (teamName) {
      try {
        console.log(`[DEBUG] Testing team search for: ${teamName}`);
        const { findEmployeesByTeam } = await import('@/lib/notion');
        const employees = await findEmployeesByTeam(teamName);
        results.tests.teamSearch = {
          success: true,
          teamName,
          employeeCount: employees.length,
          employees: employees.map(e => ({ name: e.name, userCount: e.userIds.length }))
        };
      } catch (error) {
        results.tests.teamSearch = {
          success: false,
          teamName,
          error: error.message
        };
      }
    }
    
    return NextResponse.json(results);
    
  } catch (error) {
    console.error('[DEBUG] Critical error:', error);
    return NextResponse.json({
      error: 'Debug endpoint failed',
      message: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}
