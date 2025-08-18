export const runtime = "edge";

import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { skillId } = await req.json();
    
    if (!skillId) {
      return NextResponse.json({ error: "Skill ID required" }, { status: 400 });
    }
    
    console.log(`[SKILL DETAIL DEBUG] Analyzing skill: ${skillId}`);
    
    const diagnostic = {
      skillId,
      timestamp: new Date().toISOString(),
      steps: []
    };
    
    // Импорт модулей
    let notionModule;
    try {
      notionModule = await import("@/lib/notion");
      diagnostic.steps.push({ step: 1, name: "Module Import", status: "success" });
    } catch (error) {
      diagnostic.steps.push({ step: 1, name: "Module Import", status: "error", error: error.message });
      return NextResponse.json(diagnostic, { status: 500 });
    }
    
    const { notion, MATRIX_DB_ID, PROP } = notionModule;
    
    // Тест 1: Прямое получение страницы навыка
    diagnostic.steps.push({ step: 2, name: "Direct Page Retrieval", status: "starting" });
    
    let skillPageData = null;
    try {
      console.log(`[SKILL DETAIL DEBUG] Retrieving skill page...`);
      const skillPage = await notion.pages.retrieve({ page_id: skillId });
      
      skillPageData = {
        id: skillPage.id,
        created_time: skillPage.created_time,
        last_edited_time: skillPage.last_edited_time,
        archived: skillPage.archived,
        properties: {}
      };
      
      // Анализируем свойства
      const props = skillPage.properties || {};
      for (const [key, value] of Object.entries(props)) {
        skillPageData.properties[key] = {
          type: value.type,
          content: null
        };
        
        // Извлекаем содержимое в зависимости от типа
        if (value.type === "title" && value.title?.length > 0) {
          skillPageData.properties[key].content = value.title.map(t => t.plain_text).join("");
        } else if (value.type === "rich_text" && value.rich_text?.length > 0) {
          skillPageData.properties[key].content = value.rich_text.map(t => t.plain_text).join("");
        } else if (value.type === "select" && value.select) {
          skillPageData.properties[key].content = value.select.name;
        } else if (value.type === "multi_select" && value.multi_select?.length > 0) {
          skillPageData.properties[key].content = value.multi_select.map(s => s.name).join(", ");
        }
      }
      
      diagnostic.steps.push({
        step: 2,
        name: "Direct Page Retrieval",
        status: "success",
        data: skillPageData
      });
      
    } catch (error) {
      console.error(`[SKILL DETAIL DEBUG] Direct retrieval failed:`, error);
      diagnostic.steps.push({
        step: 2,
        name: "Direct Page Retrieval", 
        status: "error",
        error: error.message,
        status_code: error.status
      });
    }
    
    // Тест 2: Поиск в матрице оценок
    diagnostic.steps.push({ step: 3, name: "Matrix Database Search", status: "starting" });
    
    let matrixRowsData = [];
    try {
      console.log(`[SKILL DETAIL DEBUG] Searching in matrix database...`);
      const matrixRows = await notion.databases.query({
        database_id: MATRIX_DB_ID,
        filter: {
          property: PROP.skill,
          relation: { contains: skillId }
        },
        page_size: 10
      });
      
      for (const row of matrixRows.results) {
        const rowData = {
          id: row.id,
          properties: {}
        };
        
        // Анализируем свойства строки матрицы
        const props = row.properties || {};
        for (const [key, value] of Object.entries(props)) {
          rowData.properties[key] = {
            type: value.type,
            content: null
          };
          
          if (key === PROP.skillDescription && value.type === "rollup") {
            // Детальный анализ rollup поля
            rowData.properties[key].rollupType = value.rollup?.type;
            rowData.properties[key].rollupContent = {};
            
            if (value.rollup?.type === "array" && value.rollup.array?.length > 0) {
              rowData.properties[key].rollupContent.arrayLength = value.rollup.array.length;
              rowData.properties[key].rollupContent.items = value.rollup.array.map((item, index) => ({
                index,
                type: item.type,
                content: item.type === "title" ? item.title?.map(t => t.plain_text).join("") :
                        item.type === "rich_text" ? item.rich_text?.map(t => t.plain_text).join("") :
                        item.type === "select" ? item.select?.name :
                        "unknown type"
              }));
            } else if (value.rollup?.type === "title") {
              rowData.properties[key].rollupContent.title = value.rollup.title?.map(t => t.plain_text).join("");
            } else if (value.rollup?.type === "rich_text") {
              rowData.properties[key].rollupContent.richText = value.rollup.rich_text?.map(t => t.plain_text).join("");
            }
          } else if (value.type === "relation" && value.relation?.length > 0) {
            rowData.properties[key].content = value.relation.map(r => r.id);
          } else if (value.type === "people" && value.people?.length > 0) {
            rowData.properties[key].content = value.people.map(p => p.id);
          } else if (value.type === "number") {
            rowData.properties[key].content = value.number;
          }
        }
        
        matrixRowsData.push(rowData);
      }
      
      diagnostic.steps.push({
        step: 3,
        name: "Matrix Database Search",
        status: "success", 
        data: {
          found_rows: matrixRows.results.length,
          rows: matrixRowsData
        }
      });
      
    } catch (error) {
      console.error(`[SKILL DETAIL DEBUG] Matrix search failed:`, error);
      diagnostic.steps.push({
        step: 3,
        name: "Matrix Database Search",
        status: "error", 
        error: error.message
      });
    }
    
    // Тест 3: Имитация функции loadSkillInformation
    diagnostic.steps.push({ step: 4, name: "Skill Information Loading", status: "starting" });
    
    try {
      let extractedName = "Неизвестный навык";
      let extractedDescription = "";
      
      // Пытаемся извлечь из rollup данных
      if (matrixRowsData.length > 0) {
        const firstRow = matrixRowsData[0];
        const skillDescProp = firstRow.properties[PROP.skillDescription];
        
        if (skillDescProp?.rollupContent) {
          if (skillDescProp.rollupContent.items) {
            // Массив rollup
            for (const item of skillDescProp.rollupContent.items) {
              if (item.type === "title" && item.content) {
                extractedName = item.content;
                break;
              }
              if (item.type === "rich_text" && item.content) {
                extractedDescription = item.content;
              }
            }
          } else if (skillDescProp.rollupContent.title) {
            extractedName = skillDescProp.rollupContent.title;
          } else if (skillDescProp.rollupContent.richText) {
            extractedDescription = skillDescProp.rollupContent.richText;
          }
        }
      }
      
      // Пытаемся извлечь из данных страницы
      if (extractedName === "Неизвестный навык" && skillPageData?.properties) {
        for (const [key, prop] of Object.entries(skillPageData.properties)) {
          if (prop.type === "title" && prop.content) {
            extractedName = prop.content;
            break;
          }
        }
      }
      
      diagnostic.steps.push({
        step: 4,
        name: "Skill Information Loading",
        status: "success",
        data: {
          extractedName,
          extractedDescription: extractedDescription.substring(0, 200) + (extractedDescription.length > 200 ? "..." : ""),
          descriptionLength: extractedDescription.length,
          method: extractedName !== "Неизвестный навык" ? "successful" : "failed"
        }
      });
      
    } catch (error) {
      diagnostic.steps.push({
        step: 4,
        name: "Skill Information Loading",
        status: "error",
        error: error.message
      });
    }
    
    // Итоговый анализ
    diagnostic.summary = {
      skillFound: !!skillPageData,
      matrixReferencesFound: matrixRowsData.length,
      hasRollupData: matrixRowsData.some(row => row.properties[PROP.skillDescription]?.type === "rollup"),
      recommendations: []
    };
    
    if (!skillPageData) {
      diagnostic.summary.recommendations.push("Страница навыка не найдена или недоступна");
    }
    
    if (matrixRowsData.length === 0) {
      diagnostic.summary.recommendations.push("Навык не найден в матрице оценок");
    } else if (!matrixRowsData.some(row => row.properties[PROP.skillDescription])) {
      diagnostic.summary.recommendations.push("Поле 'Описание навыка' отсутствует в матрице");
    }
    
    return NextResponse.json(diagnostic);
    
  } catch (error) {
    console.error('[SKILL DETAIL DEBUG ERROR]', error);
    return NextResponse.json({
      error: "Skill detail diagnostic failed",
      message: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}