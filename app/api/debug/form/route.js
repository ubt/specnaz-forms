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
    
    try {
      const tokenModule = await import("@/lib/token");
      const notionModule = await import("@/lib/notion");
      
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
    try {
      const { verifyReviewToken } = await import("@/lib/token");
      payload = await verifyReviewToken(token);
      
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
      
      // Не возвращаем ошибку сразу, продолжаем диагностику
    }
    
    // Шаг 5: Проверка доступа к Notion
    diagnostic.steps.push({ step: 5, name: "notion_test", status: "starting" });
    
    try {
      const { notion } = await import("@/lib/notion");
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
    
    // Шаг 6: Тестирование поиска сотрудников (если токен валиден)
    const tokenValid = diagnostic.steps.find(s => s.name === "token_verification")?.status === "success";
    
    if (tokenValid && payload) {
      diagnostic.steps.push({ step: 6, name: "find_evaluatees", status: "starting" });
      
      try {
        const { listEvaluateesForReviewerUser } = await import("@/lib/notion");
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
        if (employees.length > 0) {
          diagnostic.steps.push({ step: 7, name: "load_skills", status: "starting" });
          
          try {
            const { fetchEmployeeSkillRowsForReviewerUser } = await import("@/lib/notion");
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
        diagnostic.steps.push({
          step: 6,
          name: "find_evaluatees",
          status: "error",
          error: employeeError.message,
          stack: employeeError.stack?.split('\n').slice(0, 5).join('\n')
        });
      }
    } else {
      diagnostic.steps.push({
        step: 6,
        name: "find_evaluatees",
        status: "skipped",
        reason: "Token verification failed"
      });
    }
    
    // Шаг 8: Проверка структуры базы данных
    diagnostic.steps.push({ step: 8, name: "database_structure", status: "starting" });
    
    try {
      const { notion, MATRIX_DB_ID, EMPLOYEES_DB_ID, PROP } = await import("@/lib/notion");
      
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
    
    diagnostic.summary = {
      allStepsCompleted: diagnostic.steps.every(step => step.status === "success" || step.status === "skipped"),
      totalSteps: diagnostic.steps.length,
      successfulSteps: diagnostic.steps.filter(step => step.status === "success").length,
      errors: diagnostic.steps.filter(step => step.status === "error"),
      recommendations: []
    };
    
    // Добавляем рекомендации
    if (diagnostic.summary.errors.length > 0) {
      const tokenError = diagnostic.summary.errors.find(e => e.name === "token_verification");
      if (tokenError) {
        if (tokenError.error.includes("Invalid Compact JWS")) {
          diagnostic.summary.recommendations.push("Токен поврежден или обрезан. Сгенерируйте новый токен в админ-панели.");
        } else if (tokenError.error.includes("expired")) {
          diagnostic.summary.recommendations.push("Токен истек. Сгенерируйте новый токен в админ-панели.");
        } else if (tokenError.error.includes("JWT_SECRET")) {
          diagnostic.summary.recommendations.push("Проблема с JWT_SECRET. Проверьте переменные окружения в Cloudflare Pages.");
        }
      }
      
      const envError = diagnostic.summary.errors.find(e => e.name === "environment");
      if (envError) {
        diagnostic.summary.recommendations.push("Настройте переменные окружения в Cloudflare Pages Dashboard.");
      }
      
      const evaluateesError = diagnostic.summary.errors.find(e => e.name === "find_evaluatees");
      if (evaluateesError) {
        diagnostic.summary.recommendations.push("Проверьте настройки матрицы компетенций - поля P1_peer, P2_peer, Manager_scorer, Self_scorer должны быть заполнены.");
      }
      
      const skillsError = diagnostic.summary.errors.find(e => e.name === "load_skills");
      if (skillsError) {
        diagnostic.summary.recommendations.push("Проверьте связи навыков в матрице компетенций и поле 'Описание навыка'.");
      }
      
      const dbError = diagnostic.summary.errors.find(e => e.name === "database_structure");
      if (dbError) {
        diagnostic.summary.recommendations.push("Проверьте доступ к базам данных Notion и их структуру.");
      }
    }
    
    // Проверяем конкретные проблемы
    const structureStep = diagnostic.steps.find(s => s.name === "database_structure");
    if (structureStep?.status === "success" && structureStep.data) {
      const structure = structureStep.data;
      
      if (!structure.matrix.hasEmployee) {
        diagnostic.summary.recommendations.push(`Добавьте поле "${PROP.employee}" в матрицу компетенций.`);
      }
      
      if (!structure.matrix.hasSkill) {
        diagnostic.summary.recommendations.push(`Добавьте поле "${PROP.skill}" в матрицу компетенций.`);
      }
      
      if (!structure.employees.hasAccount) {
        diagnostic.summary.recommendations.push(`Добавьте поле "${PROP.empAccount}" в базу сотрудников.`);
      }
      
      if (!structure.matrix.hasScorers.selfScorer) {
        diagnostic.summary.recommendations.push(`Добавьте поле "${PROP.selfScorer}" в матрицу компетенций.`);
      }
    }
    
    const skillsStep = diagnostic.steps.find(s => s.name === "load_skills");
    if (skillsStep?.status === "success" && skillsStep.data?.totalSkills === 0) {
      diagnostic.summary.recommendations.push("Найдены сотрудники, но нет навыков для оценки. Проверьте заполнение матрицы компетенций.");
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