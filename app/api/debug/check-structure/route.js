export const runtime = "edge";

import { NextResponse } from "next/server";

function extractRollupText(prop) {
  if (!prop) return "empty";
  if (prop.type === "rollup") {
    const roll = prop.rollup;
    if (roll?.type === "array" && Array.isArray(roll.array)) {
      const text = roll.array
        .map(item => {
          if (item.type === "rich_text") {
            return item.rich_text?.map(t => t.plain_text).join("") || "";
          }
          if (item.type === "title") {
            return item.title?.map(t => t.plain_text).join("") || "";
          }
          return "";
        })
        .filter(Boolean)
        .join(" ")
        .trim();
      return text.substring(0, 100) || "empty";
    }
    if (roll?.type === "rich_text") {
      const text = roll.rich_text?.map(t => t.plain_text).join("") || "";
      return text.substring(0, 100) || "empty";
    }
    if (roll?.type === "title") {
      const text = roll.title?.map(t => t.plain_text).join("") || "";
      return text.substring(0, 100) || "empty";
    }
    return "empty";
  }
  if (prop.type === "rich_text") {
    const text = prop.rich_text?.map(t => t.plain_text).join("") || "";
    return text.substring(0, 100) || "empty";
  }
  return "empty";
}

export async function GET() {
  try {
    console.log('[STRUCTURE CHECK] Starting Notion structure analysis');
    
    const { notion, MATRIX_DB_ID, EMPLOYEES_DB_ID, PROP } = await import("@/lib/notion");
    
    const result = {
      timestamp: new Date().toISOString(),
      databases: {}
    };
    
    // Проверяем структуру матрицы оценок
    try {
      const matrixDb = await notion.databases.retrieve({ database_id: MATRIX_DB_ID });
      const matrixProps = matrixDb.properties;
      
      result.databases.matrix = {
        title: matrixDb.title?.[0]?.plain_text || "Unknown",
        id: MATRIX_DB_ID,
        properties: {},
        expectedFields: {},
        issues: []
      };
      
      // Проверяем ожидаемые поля
      const expectedFields = {
        [PROP.employee]: "relation or people",
        [PROP.skill]: "relation", 
        [PROP.skillDescription]: "rollup",
        [PROP.p1Peer]: "people",
        [PROP.p2Peer]: "people",
        [PROP.managerScorer]: "people",
        [PROP.selfScorer]: "people",
        [PROP.p1Score]: "number",
        [PROP.p2Score]: "number",
        [PROP.managerScore]: "number",
        [PROP.selfScore]: "number"
      };
      
      for (const [fieldName, expectedType] of Object.entries(expectedFields)) {
        const prop = matrixProps[fieldName];
        result.databases.matrix.expectedFields[fieldName] = {
          expected: expectedType,
          actual: prop?.type || "missing",
          exists: !!prop,
          correct: prop?.type === expectedType || (expectedType.includes("or") && expectedType.split(" or ").includes(prop?.type))
        };
        
        if (!prop) {
          result.databases.matrix.issues.push(`Missing field: ${fieldName}`);
        } else if (!result.databases.matrix.expectedFields[fieldName].correct) {
          result.databases.matrix.issues.push(`Wrong type for ${fieldName}: expected ${expectedType}, got ${prop.type}`);
        }
      }
      
      // Список всех свойств
      result.databases.matrix.properties = Object.keys(matrixProps).map(key => ({
        name: key,
        type: matrixProps[key].type,
        isExpected: !!expectedFields[key]
      }));
      
    } catch (error) {
      result.databases.matrix = { error: error.message };
    }
    
    // Проверяем структуру базы сотрудников
    try {
      const employeesDb = await notion.databases.retrieve({ database_id: EMPLOYEES_DB_ID });
      const employeesProps = employeesDb.properties;
      
      result.databases.employees = {
        title: employeesDb.title?.[0]?.plain_text || "Unknown",
        id: EMPLOYEES_DB_ID,
        properties: {},
        expectedFields: {},
        issues: []
      };
      
      const expectedEmployeeFields = {
        [PROP.team]: "select or multi_select or rich_text or title",
        [PROP.empAccount]: "people",
        [PROP.empTitle]: "title or rich_text"
      };
      
      for (const [fieldName, expectedType] of Object.entries(expectedEmployeeFields)) {
        const prop = employeesProps[fieldName];
        const typeOptions = expectedType.split(" or ");
        result.databases.employees.expectedFields[fieldName] = {
          expected: expectedType,
          actual: prop?.type || "missing",
          exists: !!prop,
          correct: prop?.type && typeOptions.includes(prop.type)
        };
        
        if (!prop) {
          result.databases.employees.issues.push(`Missing field: ${fieldName}`);
        } else if (!result.databases.employees.expectedFields[fieldName].correct) {
          result.databases.employees.issues.push(`Wrong type for ${fieldName}: expected ${expectedType}, got ${prop.type}`);
        }
      }
      
      result.databases.employees.properties = Object.keys(employeesProps).map(key => ({
        name: key,
        type: employeesProps[key].type,
        isExpected: !!expectedEmployeeFields[key]
      }));
      
    } catch (error) {
      result.databases.employees = { error: error.message };
    }
    
    // Пример данных из матрицы
    try {
      const sampleRows = await notion.databases.query({
        database_id: MATRIX_DB_ID,
        page_size: 3
      });
      
      result.sampleData = {
        matrixRowCount: sampleRows.results.length,
        sampleRows: sampleRows.results.map(row => {
          const props = row.properties;
          return {
            id: row.id,
            employee: props[PROP.employee]?.relation?.[0]?.id || props[PROP.employee]?.people?.[0]?.id || "not found",
            skill: props[PROP.skill]?.relation?.[0]?.id || "not found",
            skillDescription: extractRollupText(props[PROP.skillDescription]),
            p1Score: props[PROP.p1Score]?.number || null,
            selfScore: props[PROP.selfScore]?.number || null
          };
        })
      };
    } catch (error) {
      result.sampleData = { error: error.message };
    }
    
    // Итоговая оценка
    const matrixIssues = result.databases.matrix?.issues || [];
    const employeesIssues = result.databases.employees?.issues || [];
    
    result.summary = {
      matrixOk: matrixIssues.length === 0,
      employeesOk: employeesIssues.length === 0,
      totalIssues: matrixIssues.length + employeesIssues.length,
      recommendations: []
    };
    
    if (matrixIssues.length > 0) {
      result.summary.recommendations.push("Fix matrix database structure issues");
    }
    if (employeesIssues.length > 0) {
      result.summary.recommendations.push("Fix employees database structure issues");
    }
    
    // Специальные рекомендации
    if (result.databases.matrix?.expectedFields?.[PROP.skillDescription]?.actual === "missing") {
      result.summary.recommendations.push(`Add "${PROP.skillDescription}" rollup field to matrix database`);
    }
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error('[STRUCTURE CHECK ERROR]', error);
    
    return NextResponse.json({
      error: "Structure check failed",
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}