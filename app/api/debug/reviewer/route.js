export const runtime = "edge";

import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { reviewerUserId } = await req.json();
    
    if (!reviewerUserId) {
      return NextResponse.json({ error: "reviewerUserId required" }, { status: 400 });
    }
    
    console.log(`[REVIEWER DEBUG] Testing reviewer: ${reviewerUserId}`);
    
    const diagnostic = {
      timestamp: new Date().toISOString(),
      reviewerUserId,
      steps: []
    };
    
    // Шаг 1: Импорт модулей
    diagnostic.steps.push({ step: 1, name: "imports", status: "starting" });
    
    try {
      const notionModule = await import("@/lib/notion");
      diagnostic.steps.push({ 
        step: 1, 
        name: "imports", 
        status: "success",
        exports: Object.keys(notionModule).slice(0, 10)
      });
    } catch (error) {
      diagnostic.steps.push({ 
        step: 1, 
        name: "imports", 
        status: "error", 
        error: error.message 
      });
      return NextResponse.json(diagnostic, { status: 500 });
    }
    
    // Шаг 2: Проверка матрицы оценок
    diagnostic.steps.push({ step: 2, name: "matrix_check", status: "starting" });
    
    try {
      const { notion, MATRIX_DB_ID, PROP } = await import("@/lib/notion");
      
      // Проверяем есть ли записи для этого ревьюера
      const searchFilters = [
        { property: PROP.selfScorer, people: { contains: reviewerUserId } },
        { property: PROP.p1Peer, people: { contains: reviewerUserId } },
        { property: PROP.p2Peer, people: { contains: reviewerUserId } },
        { property: PROP.managerScorer, people: { contains: reviewerUserId } }
      ];
      
      const matrixResults = [];
      
      for (let i = 0; i < searchFilters.length; i++) {
        const filter = searchFilters[i];
        const fieldName = Object.keys(filter.property === PROP.selfScorer ? {selfScorer: 1} : 
                                     filter.property === PROP.p1Peer ? {p1Peer: 1} :
                                     filter.property === PROP.p2Peer ? {p2Peer: 1} : {managerScorer: 1})[0];
        
        try {
          const result = await notion.databases.query({
            database_id: MATRIX_DB_ID,
            filter: filter,
            page_size: 10
          });
          
          matrixResults.push({
            field: fieldName,
            property: filter.property,
            found: result.results.length,
            sampleIds: result.results.slice(0, 3).map(r => r.id)
          });
        } catch (filterError) {
          matrixResults.push({
            field: fieldName,
            property: filter.property,
            error: filterError.message
          });
        }
      }
      
      diagnostic.steps.push({ 
        step: 2, 
        name: "matrix_check", 
        status: "success",
        data: {
          reviewerUserId,
          matrixResults,
          totalRowsFound: matrixResults.reduce((sum, r) => sum + (r.found || 0), 0)
        }
      });
    } catch (error) {
      diagnostic.steps.push({ 
        step: 2, 
        name: "matrix_check", 
        status: "error", 
        error: error.message 
      });
    }
    
    // Шаг 3: Проверка страниц сотрудника
    diagnostic.steps.push({ step: 3, name: "employee_pages", status: "starting" });
    
    try {
      const { getEmployeePagesByUserId } = await import("@/lib/notion");
      const employeePages = await getEmployeePagesByUserId(reviewerUserId);
      
      diagnostic.steps.push({ 
        step: 3, 
        name: "employee_pages", 
        status: "success",
        data: {
          pagesFound: employeePages.length,
          pages: employeePages.map(p => ({ id: p.pageId, name: p.name }))
        }
      });
    } catch (error) {
      diagnostic.steps.push({ 
        step: 3, 
        name: "employee_pages", 
        status: "error", 
        error: error.message 
      });
    }
    
    // Шаг 4: Полный тест функции
    diagnostic.steps.push({ step: 4, name: "full_function_test", status: "starting" });
    
    try {
      const { listEvaluateesForReviewerUser } = await import("@/lib/notion");
      const employees = await listEvaluateesForReviewerUser(reviewerUserId);
      
      diagnostic.steps.push({ 
        step: 4, 
        name: "full_function_test", 
        status: "success",
        data: {
          employeesFound: employees.length,
          employees: employees.map(e => ({
            id: e.employeeId,
            name: e.employeeName,
            role: e.role
          }))
        }
      });
      
      diagnostic.summary = {
        success: employees.length > 0,
        message: employees.length > 0 
          ? `Found ${employees.length} employees for evaluation`
          : "No employees found for evaluation",
        employeesCount: employees.length,
        recommendations: employees.length === 0 ? [
          "Check if reviewer is assigned as P1_peer, P2_peer, Manager_scorer, or Self_scorer in matrix",
          "Verify reviewer user ID exists in employee database",
          "Check if matrix database has any records at all"
        ] : []
      };
    } catch (error) {
      diagnostic.steps.push({ 
        step: 4, 
        name: "full_function_test", 
        status: "error", 
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 5).join('\n')
      });
      
      diagnostic.summary = {
        success: false,
        message: "Function test failed",
        error: error.message
      };
    }
    
    return NextResponse.json(diagnostic);
    
  } catch (error) {
    console.error('[REVIEWER DEBUG ERROR]', error);
    
    return NextResponse.json({
      error: "Reviewer debug failed",
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}