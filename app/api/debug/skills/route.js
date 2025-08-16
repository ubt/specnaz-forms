// Добавьте это в app/api/debug/skills/route.js

export const runtime = "edge";

import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { skillId, token } = await req.json();
    
    if (!skillId) {
      return NextResponse.json({ error: "Skill ID required" }, { status: 400 });
    }
    
    console.log(`[SKILL DEBUG] Debugging skill: ${skillId}`);
    
    const diagnostic = {
      skillId,
      timestamp: new Date().toISOString(),
      tests: []
    };
    
    // Импорт модулей
    let notionModule;
    try {
      notionModule = await import("@/lib/notion");
      diagnostic.tests.push({ name: "Module Import", status: "success" });
    } catch (error) {
      diagnostic.tests.push({ name: "Module Import", status: "error", error: error.message });
      return NextResponse.json(diagnostic, { status: 500 });
    }
    
    const { notion } = notionModule;
    
    // Тест 1: Прямое получение страницы навыка
    try {
      console.log(`[SKILL DEBUG] Attempting direct page retrieval...`);
      const skillPage = await notion.pages.retrieve({ page_id: skillId });
      
      diagnostic.tests.push({
        name: "Direct Page Retrieval",
        status: "success",
        data: {
          id: skillPage.id,
          created_time: skillPage.created_time,
          last_edited_time: skillPage.last_edited_time,
          archived: skillPage.archived,
          properties: Object.keys(skillPage.properties || {})
        }
      });
      
      // Извлекаем название
      const props = skillPage.properties || {};
      let skillName = "Без названия";
      
      for (const [key, value] of Object.entries(props)) {
        if (value?.type === "title" && value.title?.length > 0) {
          skillName = value.title.map(t => t.plain_text).join("");
          break;
        }
      }
      
      diagnostic.skillName = skillName;
      diagnostic.skillProperties = props;
      
    } catch (error) {
      console.error(`[SKILL DEBUG] Direct retrieval failed:`, error);
      diagnostic.tests.push({
        name: "Direct Page Retrieval", 
        status: "error",
        error: error.message,
        status_code: error.status
      });
    }
    
    // Тест 2: Поиск в матрице оценок
    try {
      console.log(`[SKILL DEBUG] Searching in matrix database...`);
      const matrixRows = await notion.databases.query({
        database_id: process.env.MATRIX_DB_ID,
        filter: {
          property: "Навык",
          relation: { contains: skillId }
        },
        page_size: 10
      });
      
      diagnostic.tests.push({
        name: "Matrix Database Search",
        status: "success", 
        data: {
          found_rows: matrixRows.results.length,
          sample_properties: matrixRows.results[0]?.properties ? Object.keys(matrixRows.results[0].properties) : []
        }
      });
      
      // Проверяем есть ли описание в матрице
      if (matrixRows.results.length > 0) {
        const firstRow = matrixRows.results[0];
        const description = firstRow.properties["Описание навыка"];
        if (description) {
          diagnostic.matrixDescription = {
            type: description.type,
            content: description.rich_text?.map(t => t.plain_text).join("") || "Пусто"
          };
        }
      }
      
    } catch (error) {
      console.error(`[SKILL DEBUG] Matrix search failed:`, error);
      diagnostic.tests.push({
        name: "Matrix Database Search",
        status: "error", 
        error: error.message
      });
    }
    
    // Тест 3: Проверка прав доступа
    try {
      console.log(`[SKILL DEBUG] Checking database access...`);
      
      // Проверяем доступ к навыкам через базу данных навыков
      const databases = await notion.search({
        filter: { property: "object", value: "database" },
        page_size: 10
      });
      
      const skillDatabases = databases.results.filter(db => {
        const title = db.title?.[0]?.plain_text?.toLowerCase() || "";
        return title.includes("навык") || title.includes("skill") || title.includes("компетенц");
      });
      
      diagnostic.tests.push({
        name: "Database Access Check",
        status: "success",
        data: {
          total_databases: databases.results.length,
          skill_related_databases: skillDatabases.length,
          database_titles: skillDatabases.map(db => db.title?.[0]?.plain_text || "Без названия")
        }
      });
      
    } catch (error) {
      diagnostic.tests.push({
        name: "Database Access Check",
        status: "error",
        error: error.message
      });
    }
    
    return NextResponse.json(diagnostic);
    
  } catch (error) {
    console.error('[SKILL DEBUG ERROR]', error);
    return NextResponse.json({
      error: "Diagnostic failed",
      message: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}