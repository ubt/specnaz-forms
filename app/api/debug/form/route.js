export const runtime = "edge";

import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { token } = await req.json();
    
    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }
    
    console.log(`[FORM DEBUG] Debugging token: ${token.substring(0, 10)}...`);
    
    const diagnostic = {
      timestamp: new Date().toISOString(),
      token: token.substring(0, 10) + "...",
      tokenLength: token.length,
      steps: []
    };
    
    // Шаг 1: Анализ структуры токена
    diagnostic.steps.push({ step: 1, name: "token_structure", status: "starting" });
    
    try {
      const parts = token.split('.');
      const structureAnalysis = {
        totalParts: parts.length,
        partsLengths: parts.map(p => p.length),
        expectedParts: 3,
        validStructure: parts.length === 3 && parts.every(p => p.length > 0)
      };
      
      // Попытка декодирования заголовка
      try {
        const header = JSON.parse(atob(parts[0]));
        structureAnalysis.header = header;
      } catch {
        structureAnalysis.headerError = "Failed to decode header";
      }
      
      // Попытка декодирования payload (без проверки подписи)
      try {
        const payload = JSON.parse(atob(parts[1]));
        structureAnalysis.payload = {
          reviewerUserId: payload.reviewerUserId,
          role: payload.role,
          exp: payload.exp,
          teamName: payload.teamName
        };
      } catch {
        structureAnalysis.payloadError = "Failed to decode payload";
      }
      
      diagnostic.steps.push({
        step: 1,
        name: "token_structure",
        status: structureAnalysis.validStructure ? "success" : "error",
        data: structureAnalysis,
        error: structureAnalysis.validStructure ? undefined : "Invalid JWT structure"
      });
      
      if (!structureAnalysis.validStructure) {
        return NextResponse.json(diagnostic, { status: 400 });
      }
      
    } catch (error) {
      diagnostic.steps.push({
        step: 1,
        name: "token_structure",
        status: "error",
        error: error.message
      });
      return NextResponse.json(diagnostic, { status: 400 });
    }
    
    // Шаг 2: Проверка переменных окружения
    diagnostic.steps.push({ step: 2, name: "environment", status: "starting" });
    
    const envCheck = {
      JWT_SECRET: !!(process.env.JWT_SECRET),
      JWT_SECRET_length: process.env.JWT_SECRET?.length || 0,
      NOTION_TOKEN: !!(process.env.NOTION_TOKEN),
      MATRIX_DB_ID: !!(process.env.MATRIX_DB_ID),
      EMPLOYEES_DB_ID: !!(process.env.EMPLOYEES_DB_ID)
    };
    
    const criticalEnvMissing = !envCheck.JWT_SECRET || !envCheck.NOTION_TOKEN;
    
    diagnostic.steps.push({
      step: 2,
      name: "environment",
      status: criticalEnvMissing ? "error" : "success",
      data: envCheck,
      error: criticalEnvMissing ? "Missing critical environment variables" : undefined
    });
    
    if (criticalEnvMissing) {
      return NextResponse.json(diagnostic, { status: 500 });
    }
    
    // Шаг 3: Импорт модулей
    diagnostic.steps.push({ step: 3, name: "imports", status: "starting" });
    
    let tokenModule, notionModule;
    try {
      tokenModule = await import("@/lib/token");
      notionModule = await import("@/lib/notion");
      
      diagnostic.steps.push({
        step: 3,
        name: "imports",
        status: "success",
        exports: {
          token: Object.keys(tokenModule),
          notion: Object.keys(notionModule).slice(0, 10)
        }
      });
    } catch (error) {
      diagnostic.steps.push({
        step: 3,
        name: "imports",
        status: "error",
        error: error.message
      });
      return NextResponse.json(diagnostic, { status: 500 });
    }
    
    // Шаг 4: Верификация токена
    diagnostic.steps.push({ step: 4, name: "token_verification", status: "starting" });
    
    let payload;
    let tokenValid = false;
    try {
      const { verifyReviewToken } = tokenModule;
      payload = await verifyReviewToken(token);
      tokenValid = true;
      
      diagnostic.steps.push({
        step: 4,
        name: "token_verification",
        status: "success",
        payload: {
          reviewerUserId: payload.reviewerUserId,
          role: payload.role,
          exp: payload.exp,
          teamName: payload.teamName,
          isExpired: payload.exp && payload.exp < Math.floor(Date.now() / 1000),
          expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null
        }
      });
    } catch (error) {
      diagnostic.steps.push({
        step: 4,
        name: "token_verification",
        status: "error",
        error: error.message
      });
    }
    
    // Шаг 5: Проверка доступа к Notion
    diagnostic.steps.push({ step: 5, name: "notion_test", status: "starting" });
    
    try {
      const { notion } = notionModule;
      const user = await notion.users.me();
      
      diagnostic.steps.push({
        step: 5,
        name: "notion_test",
        status: "success",
        data: {
          user_name: user.name || 'Unknown',
          user_type: user.type
        }
      });
    } catch (error) {
      diagnostic.steps.push({
        step: 5,
        name: "notion_test",
        status: "error",
        error: error.message,
        status_code: error.status
      });
    }
    
    // Шаг 6: Тестирование поиска сотрудников (ИСПРАВЛЕНА ЛОГИКА)
    if (tokenValid && payload) {
      diagnostic.steps.push({ step: 6, name: "find_evaluatees", status: "starting" });
      
      try {
        const { listEvaluateesForReviewerUser } = notionModule;
        console.log(`[DEBUG] Testing listEvaluateesForReviewerUser for ${payload.reviewerUserId}`);
        
        const employees = await listEvaluateesForReviewerUser(payload.reviewerUserId);
        
        diagnostic.steps.push({
          step: 6,
          name: "find_evaluatees",
          status: "success",
          data: {
            employeeCount: employees.length,
            employees: employees.map(e => ({
              id: e.employeeId,
              name: e.employeeName,
              role: e.role
            }))
          }
        });
        
        // Шаг 7: Тестирование загрузки навыков (если найдены сотрудники)
        diagnostic.steps.push({ step: 7, name: "load_skills", status: "starting" });
        
        if (employees.length > 0) {
          try {
            const { fetchEmployeeSkillRowsForReviewerUser } = notionModule;
            console.log(`[DEBUG] Testing fetchEmployeeSkillRowsForReviewerUser for ${employees.length} employees`);
            
            const skillGroups = await fetchEmployeeSkillRowsForReviewerUser(employees, payload.reviewerUserId);
            
            const totalSkills = skillGroups.reduce((sum, group) => sum + (group.items?.length || 0), 0);
            
            diagnostic.steps.push({
              step: 7,
              name: "load_skills",
              status: "success",
              data: {
                skillGroupsCount: skillGroups.length,
                totalSkills,
                skillGroups: skillGroups.map(group => ({
                  employeeName: group.employeeName,
                  role: group.role,
                  skillsCount: group.items?.length || 0,
                  sampleSkills: (group.items || []).slice(0, 2).map(skill => ({
                    name: skill.name,
                    description: skill.description?.substring(0, 100) + (skill.description?.length > 100 ? '...' : ''),
                    current: skill.current,
                    pageId: skill.pageId?.substring(0, 8) + "..."
                  }))
                }))
              }
            });
            
          } catch (skillsError) {
            console.error(`[DEBUG] Skills loading failed:`, skillsError);
            diagnostic.steps.push({
              step: 7,
              name: "load_skills",
              status: "error",
              error: skillsError.message,
              stack: skillsError.stack?.split('\n').slice(0, 5).join('\n')
            });
          }
        } else {
          diagnostic.steps.push({
            step: 7,
            name: "load_skills",
            status: "skipped",
            reason: "No employees found to load skills for"
          });
        }
        
      } catch (employeeError) {
        console.error(`[DEBUG] Employee search failed:`, employeeError);
        diagnostic.steps.push({
          step: 6,
          name: "find_evaluatees",
          status: "error",
          error: employeeError.message,
          stack: employeeError.stack?.split('\n').slice(0, 5).join('\n')
        });
        
        // Все равно пытаемся проверить структуру навыков
        diagnostic.steps.push({
          step: 7,
          name: "load_skills",
          status: "skipped",
          reason: "Employee search failed"
        });
      }
    } else {
      diagnostic.steps.push({
        step: 6,
        name: "find_evaluatees",
        status: "skipped",
        reason: "Token verification failed"
      });
      diagnostic.steps.push({
        step: 7,
        name: "load_skills",
        status: "skipped",
        reason: "Token verification failed"
      });
    }
    
    // Шаг 8: Проверка структуры базы данных
    diagnostic.steps.push({ step: 8, name: "database_structure", status: "starting" });
    
    try {
      const { notion, MATRIX_DB_ID, EMPLOYEES_DB_ID, PROP } = notionModule;
      
      // Проверяем структуру матрицы
      const matrixDb = await notion.databases.retrieve({ database_id: MATRIX_DB_ID });
      const matrixProps = matrixDb.properties;
      
      // Проверяем структуру сотрудников
      const employeesDb = await notion.databases.retrieve({ database_id: EMPLOYEES_DB_ID });
      const employeesProps = employeesDb.properties;
      
      const structureCheck = {
        matrix: {
          hasEmployee: !!matrixProps[PROP.employee],
          employeeType: matrixProps[PROP.employee]?.type,
          hasSkill: !!matrixProps[PROP.skill],
          skillType: matrixProps[PROP.skill]?.type,
          hasSkillDescription: !!matrixProps[PROP.skillDescription],
          skillDescriptionType: matrixProps[PROP.skillDescription]?.type,
          hasScorers: {
            selfScorer: !!matrixProps[PROP.selfScorer],
            p1Peer: !!matrixProps[PROP.p1Peer],
            p2Peer: !!matrixProps[PROP.p2Peer],
            managerScorer: !!matrixProps[PROP.managerScorer]
          },
          hasScoreFields: {
            selfScore: !!matrixProps[PROP.selfScore],
            p1Score: !!matrixProps[PROP.p1Score],
            p2Score: !!matrixProps[PROP.p2Score],
            managerScore: !!matrixProps[PROP.managerScore]
          }
        },
        employees: {
          hasTeam: !!employeesProps[PROP.team],
          teamType: employeesProps[PROP.team]?.type,
          hasAccount: !!employeesProps[PROP.empAccount],
          accountType: employeesProps[PROP.empAccount]?.type
        }
      };
      
      diagnostic.steps.push({
        step: 8,
        name: "database_structure",
        status: "success",
        data: structureCheck
      });
      
    } catch (dbError) {
      diagnostic.steps.push({
        step: 8,
        name: "database_structure",
        status: "error",
        error: dbError.message
      });
    }
    
    // Шаг 9: Тест данных матрицы
    diagnostic.steps.push({ step: 9, name: "matrix_data_test", status: "starting" });
    
    try {
      const { notion, MATRIX_DB_ID, PROP } = notionModule;
      
      // Получаем несколько записей из матрицы для анализа
      const sampleData = await notion.databases.query({
        database_id: MATRIX_DB_ID,
        page_size: 5
      });
      
      const analysis = {
        totalRows: sampleData.results.length,
        sampleRows: sampleData.results.map(row => {
          const props = row.properties;
          return {
            id: row.id,
            employee: props[PROP.employee]?.relation?.[0]?.id || 'empty',
            skill: props[PROP.skill]?.relation?.[0]?.id || 'empty',
            selfScorer: props[PROP.selfScorer]?.people?.map(p => p.id) || [],
            p1Peer: props[PROP.p1Peer]?.people?.map(p => p.id) || [],
            p2Peer: props[PROP.p2Peer]?.people?.map(p => p.id) || [],
            managerScorer: props[PROP.managerScorer]?.people?.map(p => p.id) || [],
            hasSkillDescription: !!(props[PROP.skillDescription]?.rollup || props[PROP.skillDescription]?.rich_text)
          };
        })
      };
      
      diagnostic.steps.push({
        step: 9,
        name: "matrix_data_test",
        status: "success",
        data: analysis
      });
      
    } catch (matrixError) {
      diagnostic.steps.push({
        step: 9,
        name: "matrix_data_test",
        status: "error",
        error: matrixError.message
      });
    }
    
    // Финальная сводка
    diagnostic.summary = {
      allStepsCompleted: diagnostic.steps.every(step => step.status === "success" || step.status === "skipped"),
      totalSteps: diagnostic.steps.length,
      successfulSteps: diagnostic.steps.filter(step => step.status === "success").length,
      errors: diagnostic.steps.filter(step => step.status === "error"),
      recommendations: []
    };
    
    // Генерируем рекомендации на основе результатов
    const errors = diagnostic.summary.errors;
    
    if (errors.some(e => e.name === "find_evaluatees")) {
      diagnostic.summary.recommendations.push("❌ Критическая проблема: не найдены сотрудники для оценки. Проверьте заполнение полей P1_peer, P2_peer, Manager_scorer, Self_scorer в матрице компетенций.");
    }
    
    if (errors.some(e => e.name === "load_skills")) {
      diagnostic.summary.recommendations.push("❌ Проблема с загрузкой навыков. Проверьте поле 'Навык' в матрице и связи с базой навыков.");
    }
    
    const structureStep = diagnostic.steps.find(s => s.name === "database_structure");
    if (structureStep?.status === "success" && structureStep.data) {
      const structure = structureStep.data;
      
      if (!structure.matrix.hasSkillDescription) {
        diagnostic.summary.recommendations.push("⚠️ Отсутствует поле 'Описание навыка' в матрице. Добавьте rollup поле для отображения информации о навыках.");
      }
    }
    
    const matrixDataStep = diagnostic.steps.find(s => s.name === "matrix_data_test");
    if (matrixDataStep?.status === "success" && matrixDataStep.data) {
      const data = matrixDataStep.data;
      
      if (data.totalRows === 0) {
        diagnostic.summary.recommendations.push("❌ Матрица компетенций пуста. Добавьте записи с сотрудниками и навыками.");
      } else {
        const hasEmptyScorers = data.sampleRows.some(row => 
          row.selfScorer.length === 0 && 
          row.p1Peer.length === 0 && 
          row.p2Peer.length === 0 && 
          row.managerScorer.length === 0
        );
        
        if (hasEmptyScorers) {
          diagnostic.summary.recommendations.push("⚠️ Найдены записи без назначенных оценивающих. Заполните поля P1_peer, P2_peer, Manager_scorer, Self_scorer.");
        }
        
        if (payload && !data.sampleRows.some(row => 
          row.selfScorer.includes(payload.reviewerUserId) ||
          row.p1Peer.includes(payload.reviewerUserId) ||
          row.p2Peer.includes(payload.reviewerUserId) ||
          row.managerScorer.includes(payload.reviewerUserId)
        )) {
          diagnostic.summary.recommendations.push(`❌ Пользователь ${payload.reviewerUserId} не найден ни в одной из ролей оценивающих. Добавьте его в соответствующие поля матрицы.`);
        }
      }
    }
    
    if (diagnostic.summary.recommendations.length === 0 && diagnostic.summary.successfulSteps === diagnostic.summary.totalSteps) {
      diagnostic.summary.recommendations.push("✅ Все проверки пройдены успешно! Система должна работать корректно.");
    }
    
    return NextResponse.json(diagnostic);
    
  } catch (error) {
    console.error('[FORM DEBUG ERROR]', error);
    
    return NextResponse.json({
      error: "Diagnostic failed",
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}