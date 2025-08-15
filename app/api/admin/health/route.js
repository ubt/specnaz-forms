export const runtime = "edge";

import { NextResponse } from "next/server";

export async function GET() {
  try {
    const checks = {
      hasAdminKey: !!(process.env.ADMIN_KEY && String(process.env.ADMIN_KEY).trim()),
      hasJwtSecret: !!(process.env.JWT_SECRET && String(process.env.JWT_SECRET).trim()),
      hasNotionToken: !!(process.env.NOTION_TOKEN && String(process.env.NOTION_TOKEN).trim()),
      hasMatrixDbId: !!(process.env.MATRIX_DB_ID && String(process.env.MATRIX_DB_ID).trim()),
      hasEmployeesDbId: !!(process.env.EMPLOYEES_DB_ID && String(process.env.EMPLOYEES_DB_ID).trim()),
      baseUrlSet: !!(process.env.NEXT_PUBLIC_BASE_URL && String(process.env.NEXT_PUBLIC_BASE_URL).trim()),
    };
    
    const allGood = Object.values(checks).every(Boolean);
    
    // Дополнительные проверки
    const envInfo = {
      nodeEnv: process.env.NODE_ENV,
      runtime: 'edge',
      timestamp: new Date().toISOString()
    };
    
    return NextResponse.json({ 
      ...checks, 
      allConfigured: allGood,
      environment: envInfo,
      status: allGood ? 'healthy' : 'misconfigured'
    });
    
  } catch (error) {
    console.error('[HEALTH CHECK ERROR]', error);
    return NextResponse.json({ 
      error: 'Health check failed',
      details: error.message 
    }, { status: 500 });
  }