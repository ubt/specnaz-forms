export const runtime = "edge";

import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { token } = await req.json();
    
    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }
    
    console.log(`[SKILLS TEST] Testing skills loading for token: ${token.substring(0, 10)}...`);
    
    const diagnostic = {
      timestamp: new Date().toISOString(),
      token: token.substring(0, 10) + "...",
      steps: []
    };
    
    // Шаг 1: Импорт модулей
    diagnostic.steps.push({ step: 1, name: "imports", status: "starting" });
    
    try {
      const { verifyReviewToken } = await import("@/lib/token");
      const { 
        listEvaluateesForReviewerUser, 
        fetchEmployeeSkillRowsForReviewerUser 
      } = await import("@/lib/notion");
      
      diagnostic.steps.push({ 
        step: 1, 
        name: "imports", 
        status: "success"
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
    
    // Шаг 2: Верификация токена
    diagnostic.steps.push({ step: 2, name: "token_verification", status: "starting" });
    
    let payload;
    try {
      const { verifyReviewToken } = await import("@/lib/token");
      payload = await verifyReviewToken(token);
      
      diagnostic.steps.push({ 
        step: 2, 
        name: "token_verification", 
        status: "success",
        payload: {
          reviewerUserId: payload.reviewerUserId,
          role: payload.role,
          teamName: payload.teamName
        }
      });
    } catch (error) {
      diagnostic.steps.push({ 
        step: 2, 
        name: "token_verification", 
        status: "error", 
        error: error.message 
      });
      return NextResponse.json(diagnostic, { status: 401 });
    }
    
    // Шаг 3: Поиск сотрудников для оценки
    diagnostic.steps.push({ step: 3, name: "find_evaluatees", status: "starting" });
    
    let employees;
    try {
      const { listEvaluateesForReviewerUser } = await import("@/lib/notion");
      employees = await listEvaluateesForReviewerUser(payload.reviewerUserId);
      
      diagnostic.steps.push({ 
        step: 3, 
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
    } catch (error) {
      diagnostic.steps.push({ 
        step: 3, 
        name: "find_evaluatees", 
        status: "error", 
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 3).join('\n')
      });
      return NextResponse.json(diagnostic, { status: 500 });
    }
    
    if (!employees?.length) {
      diagnostic.steps.push({ 
        step: 4, 
        name: "skills_loading", 
        status: "skipped", 
        reason: "No employees found" 
      });
      
      diagnostic.summary = {
        success: false,
        message: "No employees found for evaluation",
        recommendations: [
          "Check if the reviewer is assigned to evaluate anyone",
          "Verify P1_peer, P2_peer, Manager_scorer fields in matrix",
          "Check if Self_scorer is set for self-evaluation"
        ]
      };
      
      return NextResponse.json(diagnostic);
    }
    
    // Шаг 4: Загрузка навыков
    diagnostic.steps.push({ step: 4, name: "skills_loading", status: "starting" });
    
    try {
      const { fetchEmployeeSkillRowsForReviewerUser } = await import("@/lib/notion");
      const skillGroups = await fetchEmployeeSkillRowsForReviewerUser(employees, payload.reviewerUserId);
      
      const totalSkills = skillGroups.reduce((sum, group) => sum + (group.items?.length || 0), 0);
      
      diagnostic.steps.push({ 
        step: 4, 
        name: "skills_loading", 
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
      
      diagnostic.summary = {
        success: totalSkills > 0,
        message: totalSkills > 0 
          ? `Successfully loaded ${totalSkills} skills for ${employees.length} employees`
          : "No skills found to evaluate",
        totalEmployees: employees.length,
        totalSkills,
        recommendations: totalSkills === 0 ? [
          "Check if 'Навык' field in matrix is properly linked to skills database",
          "Verify 'Описание навыка' field is filled in matrix records",
          "Check if skills are assigned to the found employees"
        ] : []
      };
      
    } catch (error) {
      diagnostic.steps.push({ 
        step: 4, 
        name: "skills_loading", 
        status: "error", 
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 5).join('\n')
      });
      
      diagnostic.summary = {
        success: false,
        message: "Failed to load skills",
        error: error.message,
        recommendations: [
          "Check Notion API permissions",
          "Verify matrix database structure",
          "Check skills database connection"
        ]
      };
    }
    
    return NextResponse.json(diagnostic);
    
  } catch (error) {
    console.error('[SKILLS TEST ERROR]', error);
    
    return NextResponse.json({
      error: "Skills test failed",
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}