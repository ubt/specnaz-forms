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
    
    // Шаг 1: Проверка импортов
    diagnostics.steps.push({ step: 1, name: "imports", status: "starting" });
    
    try {
      const tokenModule = await import("@/lib/token");
      const notionModule = await import("@/lib/notion");
      diagnostics.steps.push({ 
        step: 1, 
        name: "imports", 
        status: "success",
        exports: {
          token: Object.keys(tokenModule),
          notion: Object.keys(notionModule).slice(0, 10)
        }
      });
    } catch (error) {
      diagnostics.steps.push({ 
        step: 1, 
        name: "imports", 
        status: "error", 
        error: error.message 
      });
      return NextResponse.json(diagnostics, { status: 500 });
    }
    
    // Шаг 2: Проверка токена
    diagnostics.steps.push({ step: 2, name: "token_verification", status: "starting" });
    
    try {
      const { verifyReviewToken } = await import("@/lib/token");
      const payload = await verifyReviewToken(token);
      diagnostics.steps.push({ 
        step: 2, 
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
        step: 2, 
        name: "token_verification", 
        status: "error", 
        error: error.message 
      });
      return NextResponse.json(diagnostics, { status: 401 });
    }
    
    // Шаг 3: Проверка баз данных
    diagnostics.steps.push({ step: 3, name: "database_access", status: "starting" });
    
    try {
      const { notion, MATRIX_DB_ID, EMPLOYEES_DB_ID } = await import("@/lib/notion");
      
      // Проверяем доступ к базам данных
      const matrixDb = await notion.databases.retrieve({ database_id: MATRIX_DB_ID });
      const employeesDb = await notion.databases.retrieve({ database_id: EMPLOYEES_DB_ID });
      
      diagnostics.steps.push({ 
        step: 3, 
        name: "database_access", 
        status: "success",
        databases: {
          matrix: {
            title: matrixDb.title?.[0]?.plain_text || "Unknown",
            properties: Object.keys(matrixDb.properties)
          },
          employees: {
            title: employeesDb.title?.[0]?.plain_text || "Unknown", 
            properties: Object.keys(employeesDb.properties)
          }
        }
      });
    } catch (error) {
      diagnostics.steps.push({ 
        step: 3, 
        name: "database_access", 
        status: "error", 
        error: error.message 
      });
      return NextResponse.json(diagnostics, { status: 500 });
    }
    
    // Шаг 4: Тест поиска сотрудников для оценки
    diagnostics.steps.push({ step: 4, name: "evaluatees_search", status: "starting" });
    
    try {
      const { verifyReviewToken } = await import("@/lib/token");
      const { listEvaluateesForReviewerUser } = await import("@/lib/notion");
      
      const payload = await verifyReviewToken(token);
      const employees = await listEvaluateesForReviewerUser(payload.reviewerUserId);
      
      diagnostics.steps.push({ 
        step: 4, 
        name: "evaluatees_search", 
        status: "success",
        data: {
          reviewerUserId: payload.reviewerUserId,
          employeesFound: employees.length,
          employees: employees.map(e => ({
            id: e.employeeId,
            name: e.employeeName,
            role: e.role
          }))
        }
      });
    } catch (error) {
      diagnostics.steps.push({ 
        step: 4, 
        name: "evaluatees_search", 
        status: "error", 
        error: error.message,
        stack: error.stack
      });
      return NextResponse.json(diagnostics, { status: 500 });
    }
    
    // Шаг 5: Тест загрузки навыков
    diagnostics.steps.push({ step: 5, name: "skills_loading", status: "starting" });
    
    try {
      const { verifyReviewToken } = await import("@/lib/token");
      const { listEvaluateesForReviewerUser, fetchEmployeeSkillRowsForReviewerUser } = await import("@/lib/notion");
      
      const payload = await verifyReviewToken(token);
      const employees = await listEvaluateesForReviewerUser(payload.reviewerUserId);
      
      if (employees.length === 0) {
        diagnostics.steps.push({ 
          step: 5, 
          name: "skills_loading", 
          status: "skipped", 
          reason: "No employees found" 
        });
      } else {
        const skillGroups = await fetchEmployeeSkillRowsForReviewerUser(employees, payload.reviewerUserId);
        
        const totalSkills = skillGroups.reduce((sum, group) => sum + (group.items?.length || 0), 0);
        
        diagnostics.steps.push({ 
          step: 5, 
          name: "skills_loading", 
          status: "success",
          data: {
            skillGroupsCount: skillGroups.length,
            totalSkills,
            skillGroups: skillGroups.map(group => ({
              employeeName: group.employeeName,
              role: group.role,
              skillsCount: group.items?.length || 0,
              skills: (group.items || []).slice(0, 3).map(skill => ({
                name: skill.name,
                pageId: skill.pageId.substring(0, 8) + "...",
                current: skill.current
              }))
            }))
          }
        });
      }
    } catch (error) {
      diagnostics.steps.push({ 
        step: 5, 
        name: "skills_loading", 
        status: "error", 
        error: error.message,
        stack: error.stack
      });
      return NextResponse.json(diagnostics, { status: 500 });
    }
    
    diagnostics.summary = {
      allStepsCompleted: diagnostics.steps.every(step => step.status === "success" || step.status === "skipped"),
      totalSteps: diagnostics.steps.length,
      successfulSteps: diagnostics.steps.filter(step => step.status === "success").length,
      errors: diagnostics.steps.filter(step => step.status === "error")
    };
    
    return NextResponse.json(diagnostics);
    
  } catch (error) {
    return NextResponse.json({
      error: "Diagnostic failed",
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}