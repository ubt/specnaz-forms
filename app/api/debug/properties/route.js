// app/api/debug/properties/route.js
export const runtime = "edge";

import { NextResponse } from "next/server";
import { notion, MATRIX_DB_ID, EMPLOYEES_DB_ID, PROP } from "@/lib/notion";

export async function GET() {
  try {
    const results = {
      timestamp: new Date().toISOString(),
      databases: {}
    };
    
    // Проверка базы сотрудников
    try {
      const employeesDb = await notion.databases.retrieve({ database_id: EMPLOYEES_DB_ID });
      const employeesProps = employeesDb.properties;
      
      results.databases.employees = {
        success: true,
        title: employeesDb.title?.[0]?.plain_text || 'No title',
        id: EMPLOYEES_DB_ID,
        propertyCount: Object.keys(employeesProps).length,
        properties: Object.entries(employeesProps).map(([name, prop]) => ({
          name,
          type: prop.type,
          id: prop.id
        })),
        expectedProperties: {
          [PROP.team]: {
            found: !!employeesProps[PROP.team],
            type: employeesProps[PROP.team]?.type,
            expectedName: PROP.team
          },
          [PROP.empAccount]: {
            found: !!employeesProps[PROP.empAccount],
            type: employeesProps[PROP.empAccount]?.type,
            expectedName: PROP.empAccount
          },
          [PROP.empTitle]: {
            found: !!employeesProps[PROP.empTitle],
            type: employeesProps[PROP.empTitle]?.type,
            expectedName: PROP.empTitle
          }
        }
      };
    } catch (error) {
      results.databases.employees = {
        success: false,
        error: error.message
      };
    }
    
    // Проверка базы матрицы
    try {
      const matrixDb = await notion.databases.retrieve({ database_id: MATRIX_DB_ID });
      const matrixProps = matrixDb.properties;
      
      results.databases.matrix = {
        success: true,
        title: matrixDb.title?.[0]?.plain_text || 'No title',
        id: MATRIX_DB_ID,
        propertyCount: Object.keys(matrixProps).length,
        properties: Object.entries(matrixProps).map(([name, prop]) => ({
          name,
          type: prop.type,
          id: prop.id
        })),
        expectedProperties: {
          [PROP.employee]: {
            found: !!matrixProps[PROP.employee],
            type: matrixProps[PROP.employee]?.type,
            expectedName: PROP.employee
          },
          [PROP.selfScorer]: {
            found: !!matrixProps[PROP.selfScorer],
            type: matrixProps[PROP.selfScorer]?.type,
            expectedName: PROP.selfScorer
          },
          [PROP.p1Peer]: {
            found: !!matrixProps[PROP.p1Peer],
            type: matrixProps[PROP.p1Peer]?.type,
            expectedName: PROP.p1Peer
          },
          [PROP.p2Peer]: {
            found: !!matrixProps[PROP.p2Peer],
            type: matrixProps[PROP.p2Peer]?.type,
            expectedName: PROP.p2Peer
          },
          [PROP.managerScorer]: {
            found: !!matrixProps[PROP.managerScorer],
            type: matrixProps[PROP.managerScorer]?.type,
            expectedName: PROP.managerScorer
          },
          [PROP.skill]: {
            found: !!matrixProps[PROP.skill],
            type: matrixProps[PROP.skill]?.type,
            expectedName: PROP.skill
          },
          [PROP.selfScore]: {
            found: !!matrixProps[PROP.selfScore],
            type: matrixProps[PROP.selfScore]?.type,
            expectedName: PROP.selfScore
          },
          [PROP.p1Score]: {
            found: !!matrixProps[PROP.p1Score],
            type: matrixProps[PROP.p1Score]?.type,
            expectedName: PROP.p1Score
          },
          [PROP.p2Score]: {
            found: !!matrixProps[PROP.p2Score],
            type: matrixProps[PROP.p2Score]?.type,
            expectedName: PROP.p2Score
          },
          [PROP.managerScore]: {
            found: !!matrixProps[PROP.managerScore],
            type: matrixProps[PROP.managerScore]?.type,
            expectedName: PROP.managerScore
          },
          [PROP.comment]: {
            found: !!matrixProps[PROP.comment],
            type: matrixProps[PROP.comment]?.type,
            expectedName: PROP.comment
          }
        }
      };
    } catch (error) {
      results.databases.matrix = {
        success: false,
        error: error.message
      };
    }
    
    // Анализ проблем
    const issues = [];
    
    if (!results.databases.employees?.success) {
      issues.push("Cannot access employees database");
    } else {
      const empProps = results.databases.employees.expectedProperties;
      Object.entries(empProps).forEach(([prop, info]) => {
        if (!info.found) {
          issues.push(`Missing property "${prop}" in employees database`);
        }
      });
    }
    
    if (!results.databases.matrix?.success) {
      issues.push("Cannot access matrix database");
    } else {
      const matrixProps = results.databases.matrix.expectedProperties;
      Object.entries(matrixProps).forEach(([prop, info]) => {
        if (!info.found) {
          issues.push(`Missing property "${prop}" in matrix database`);
        }
      });
    }
    
    results.analysis = {
      issueCount: issues.length,
      issues,
      status: issues.length === 0 ? 'all_good' : 'issues_found'
    };
    
    return NextResponse.json(results);
    
  } catch (error) {
    console.error('[PROPERTY CHECK] Error:', error);
    return NextResponse.json({
      error: 'Property check failed',
      message: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}
