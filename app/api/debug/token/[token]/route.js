// Шаг 5: Прямой поиск в матрице с правильными типами фильтров
    try {
      console.log('[TOKEN DEBUG] Searching matrix database directly...');
      
      // Получаем типы полей
      const matrixDb = await notion.databases.retrieve({ database_id: MATRIX_DB_ID });
      const matrixProps = matrixDb.properties;
      
      // Поиск по People полям
      const peopleSearches = [
        { field: PROP.selfScorer, name: 'Self Scorer' },
        { field: PROP.p1Peer, name: 'P1 Peer' },
        { field: PROP.p2Peer, name: 'P2 Peer' },
        { field: PROP.managerScorer, name: 'Manager' }
      ];
      
      // Поиск по Relation полям (для поля Employee)
      const relationSearches = [];
      if (matrixProps[PROP.employee]?.type === 'relation') {
        // Для relation поля нужны employee page IDs
        const employeePages = await getEmployeePagesByUserId(reviewerUserId);
        if (employeePages.length > 0) {
          relationSearches.push({
            field: PROP.employee,
            name: 'Employee (Relation)',
            pageIds: employeePages.map(p => p.pageId)
          });
        }
      } else if (matrixProps[PROP.employee]?.type === 'people') {
        peopleSearches.push({ field: PROP.employee, name: 'Employee (People)' });
      }
      
      const searchResults = {};
      
      // Поиск по People полям
      for (const search of peopleSearches) {
        try {
          const result = await notion.databases.query({
            database_id: MATRIX_DB_ID,
            filter: {
              property: search.field,
              people: { contains: reviewerUserId }
            },
            page_size: 10
          });
          
          searchResults[search.field] = {
            success: true,
            type: 'people',
            count: result.results.length,
            rows: result.results.map(row => ({
              id: row.id,
              employee: row.properties[PROP.employee]?.relation?.[0]?.id || 
                       row.properties[PROP.employee]?.people?.[0]?.id,
              [search.field]: row.properties[search.field]?.people?.map(p => p.id)
            }))
          };
          
          console.log(`[TOKEN DEBUG] Found ${result.results.length} rows for ${search.name} (people)`);
        } catch (error) {
          searchResults[search.field] = {
            success: false,
            type: 'people',
            error: error.message
          };
        }
      }
      
      // Поиск по Relation полям
      for (const search of relationSearches) {
        try {
          const results = [];
          for (const pageId of search.pageIds) {
            const result = await notion.databases.query({
              database_id: MATRIX_DB_ID,
              filter: {
                property: search.field,
                relation: { contains: pageId }
              },
              page_size: 10
            });
            results.push(...result.results);
          }
          
          searchResults[search.field] = {
            success: true,
            type: 'relation',
            count: results.length,
            searchedPageIds: search.pageIds,
            rows: results.map(row => ({
              id: row.id,
              employee: row.properties[PROP.employee]?.relation?.[0]?.id,
              [search.field]: row.properties[search.field]?.relation?.map(r => r.id)
            }))
          };
          
          console.log(`[TOKEN DEBUG] Found ${results.length} rows for ${search.name} (relation)`);
        } catch (error) {
          searchResults[search.field] = {
            success: false,
            type: 'relation',
            error: error.message
          };
        }
      }
      
      debug.step5_direct_search = {
        success: true,
        propertyTypes: {
          [PROP.employee]: matrixProps[PROP.employee]?.type,
          [PROP.selfScorer]: matrixProps[PROP.selfScorer]?.type,
          [PROP.p1Peer]: matrixProps[PROP.p1Peer]?.type,
          [PROP.p2Peer]: matrixProps[PROP.p2Peer]?.type,
          [PROP.managerScorer]: matrixProps[PROP.managerScorer]?.type,
        },
        searches: searchResults,
        totalMatches: Object.values(searchResults)
          .filter(r => r.success)
          .reduce((sum, r) => sum + r.count, 0)
      };
      
    } catch (error) {
      debug.step5_direct_search = {
        success: false,
        error: error.message
      };
    }// app/api/debug/token/[token]/route.js
export const runtime = "edge";

import { NextResponse } from "next/server";
import { verifyReviewToken } from "@/lib/token";
import { 
  listEvaluateesForReviewerUser, 
  getEmployeePagesByUserId,
  MATRIX_DB_ID,
  EMPLOYEES_DB_ID,
  PROP,
  notion
} from "@/lib/notion";

export async function GET(req, { params }) {
  try {
    const token = params.token;
    console.log(`[TOKEN DEBUG] Starting debug for token: ${token?.substring(0, 20)}...`);
    
    // Шаг 1: Проверка токена
    let payload;
    try {
      payload = await verifyReviewToken(token);
      console.log('[TOKEN DEBUG] Token verified successfully:', payload);
    } catch (error) {
      console.error('[TOKEN DEBUG] Token verification failed:', error.message);
      return NextResponse.json({
        step: 'token_verification',
        success: false,
        error: error.message
      });
    }
    
    const reviewerUserId = payload?.reviewerUserId;
    if (!reviewerUserId) {
      return NextResponse.json({
        step: 'token_verification',
        success: false,
        error: 'No reviewerUserId in token'
      });
    }
    
    const debug = {
      step1_token: {
        success: true,
        payload,
        reviewerUserId
      }
    };
    
    // Шаг 2: Проверка пользователя в Notion
    try {
      const user = await notion.users.retrieve({ user_id: reviewerUserId });
      debug.step2_user = {
        success: true,
        user: {
          id: user.id,
          name: user.name,
          type: user.type
        }
      };
      console.log('[TOKEN DEBUG] User found in Notion:', user.name);
    } catch (error) {
      debug.step2_user = {
        success: false,
        error: error.message
      };
      console.error('[TOKEN DEBUG] User not found in Notion:', error.message);
    }
    
    // Шаг 3: Поиск страниц сотрудника
    try {
      const employeePages = await getEmployeePagesByUserId(reviewerUserId);
      debug.step3_employee_pages = {
        success: true,
        count: employeePages.length,
        pages: employeePages
      };
      console.log(`[TOKEN DEBUG] Found ${employeePages.length} employee pages for user`);
    } catch (error) {
      debug.step3_employee_pages = {
        success: false,
        error: error.message
      };
    }
    
    // Шаг 4: Проверка структуры базы данных матрицы
    try {
      const matrixDb = await notion.databases.retrieve({ database_id: MATRIX_DB_ID });
      const properties = Object.keys(matrixDb.properties);
      debug.step4_matrix_structure = {
        success: true,
        title: matrixDb.title?.[0]?.plain_text,
        propertyCount: properties.length,
        properties,
        expectedProperties: {
          [PROP.employee]: matrixDb.properties[PROP.employee]?.type,
          [PROP.selfScorer]: matrixDb.properties[PROP.selfScorer]?.type,
          [PROP.p1Peer]: matrixDb.properties[PROP.p1Peer]?.type,
          [PROP.p2Peer]: matrixDb.properties[PROP.p2Peer]?.type,
          [PROP.managerScorer]: matrixDb.properties[PROP.managerScorer]?.type,
        }
      };
      console.log('[TOKEN DEBUG] Matrix database structure verified');
    } catch (error) {
      debug.step4_matrix_structure = {
        success: false,
        error: error.message
      };
    }
    
    // Шаг 5: Прямой поиск в матрице
    try {
      console.log('[TOKEN DEBUG] Searching matrix database directly...');
      
      // Поиск по People полям
      const peopleSearches = [
        { field: PROP.employee, name: 'Employee' },
        { field: PROP.selfScorer, name: 'Self Scorer' },
        { field: PROP.p1Peer, name: 'P1 Peer' },
        { field: PROP.p2Peer, name: 'P2 Peer' },
        { field: PROP.managerScorer, name: 'Manager' }
      ];
      
      const searchResults = {};
      
      for (const search of peopleSearches) {
        try {
          const result = await notion.databases.query({
            database_id: MATRIX_DB_ID,
            filter: {
              property: search.field,
              people: { contains: reviewerUserId }
            },
            page_size: 10
          });
          
          searchResults[search.field] = {
            success: true,
            count: result.results.length,
            rows: result.results.map(row => ({
              id: row.id,
              employee: row.properties[PROP.employee]?.relation?.[0]?.id || 
                       row.properties[PROP.employee]?.people?.[0]?.id,
              [search.field]: row.properties[search.field]?.people?.map(p => p.id)
            }))
          };
          
          console.log(`[TOKEN DEBUG] Found ${result.results.length} rows for ${search.name}`);
        } catch (error) {
          searchResults[search.field] = {
            success: false,
            error: error.message
          };
        }
      }
      
      debug.step5_direct_search = {
        success: true,
        searches: searchResults,
        totalMatches: Object.values(searchResults)
          .filter(r => r.success)
          .reduce((sum, r) => sum + r.count, 0)
      };
      
    } catch (error) {
      debug.step5_direct_search = {
        success: false,
        error: error.message
      };
    }
    
    // Шаг 6: Вызов основной функции
    try {
      const employees = await listEvaluateesForReviewerUser(reviewerUserId);
      debug.step6_main_function = {
        success: true,
        employeeCount: employees.length,
        employees: employees.map(e => ({
          id: e.employeeId,
          name: e.employeeName,
          role: e.role
        }))
      };
      console.log(`[TOKEN DEBUG] Main function returned ${employees.length} employees`);
    } catch (error) {
      debug.step6_main_function = {
        success: false,
        error: error.message,
        stack: error.stack
      };
    }
    
    // Определяем основную проблему
    let diagnosis = "Unknown issue";
    if (!debug.step2_user?.success) {
      diagnosis = "User not found in Notion workspace";
    } else if (!debug.step4_matrix_structure?.success) {
      diagnosis = "Cannot access matrix database";
    } else if (!debug.step5_direct_search?.success) {
      diagnosis = "Cannot search matrix database";
    } else if (debug.step5_direct_search?.totalMatches === 0) {
      diagnosis = "User not found in any matrix rows";
    } else if (!debug.step6_main_function?.success) {
      diagnosis = "Main function failed";
    } else if (debug.step6_main_function?.employeeCount === 0) {
      diagnosis = "Logic issue in main function";
    } else {
      diagnosis = "Everything looks good";
    }
    
    return NextResponse.json({
      diagnosis,
      debug,
      recommendations: getRecommendations(debug, diagnosis)
    });
    
  } catch (error) {
    console.error('[TOKEN DEBUG] Critical error:', error);
    return NextResponse.json({
      step: 'critical_error',
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}

function getRecommendations(debug, diagnosis) {
  const recommendations = [];
  
  if (!debug.step2_user?.success) {
    recommendations.push("Check if the user exists in your Notion workspace and has proper access");
    recommendations.push("Verify the user ID is correct in the token");
  }
  
  if (!debug.step4_matrix_structure?.success) {
    recommendations.push("Check if MATRIX_DB_ID environment variable is correct");
    recommendations.push("Verify the Notion integration has access to the matrix database");
  }
  
  if (debug.step5_direct_search?.totalMatches === 0) {
    recommendations.push("Check if the user is assigned as a reviewer in any matrix rows");
    recommendations.push("Verify the People fields in the matrix database are properly filled");
    recommendations.push("Check field names match the PROP constants in the code");
  }
  
  if (debug.step6_main_function?.employeeCount === 0 && debug.step5_direct_search?.totalMatches > 0) {
    recommendations.push("There might be a logic issue in the role computation");
    recommendations.push("Check the computeRoleOnRow function logic");
    recommendations.push("Verify employee property types (People vs Relation)");
  }
  
  if (recommendations.length === 0) {
    recommendations.push("All checks passed - the issue might be elsewhere");
    recommendations.push("Check browser console for frontend errors");
  }
  
  return recommendations;
}