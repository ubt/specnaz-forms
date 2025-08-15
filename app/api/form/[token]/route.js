export const runtime = "edge";

import { NextResponse } from "next/server";
import { verifyReviewToken } from "@/lib/token";
import { z } from "zod";
import {
  listEvaluateesForReviewerUser,
  fetchEmployeeSkillRowsForReviewerUser,
  ROLE_TO_FIELD,
  updateScore,
  detectCommentProp,
} from "@/lib/notion";

function t(s) { 
  return (s || "").trim(); 
}

export async function GET(req, { params }) {
  try {
    console.log(`[GET] Starting form data load for token: ${params.token?.substring(0, 20)}...`);
    
    const payload = await verifyReviewToken(params.token);
    console.log(`[GET] Token verified:`, { 
      reviewerUserId: payload?.reviewerUserId,
      role: payload?.role,
      teamName: payload?.teamName,
      exp: payload?.exp ? new Date(payload.exp * 1000).toISOString() : 'no expiration'
    });
    
    const reviewerUserId = t(payload?.reviewerUserId);
    
    if (!reviewerUserId) {
      console.error('[GET] No reviewerUserId found in token');
      return NextResponse.json(
        { error: "Недействительный токен" }, 
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
    
    console.log(`[GET] Loading evaluatees for reviewer: ${reviewerUserId}`);
    const startTime = Date.now();
    
    const employees = await listEvaluateesForReviewerUser(reviewerUserId);
    
    console.log(`[GET] Found ${employees?.length || 0} employees to evaluate:`, 
      employees?.map(e => `${e.employeeName} (${e.employeeId}) - role: ${e.role}`) || []
    );
    
    if (!employees?.length) {
      console.warn(`[GET] No employees found for reviewer ${reviewerUserId}`);
      return NextResponse.json(
        { 
          rows: [],
          debug: {
            reviewerUserId,
            tokenRole: payload?.role,
            teamName: payload?.teamName,
            message: "No employees found for this reviewer"
          }
        }, 
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    
    console.log(`[GET] Loading skill rows for ${employees.length} employees...`);
    const rows = await fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId);
    
    const loadTime = Date.now() - startTime;
    const totalItems = rows.reduce((sum, r) => sum + (r.items?.length || 0), 0);
    
    console.log(`[GET] Data loaded successfully in ${loadTime}ms:`, {
      employees: employees.length,
      rowGroups: rows.length,
      totalItems,
      rowDetails: rows.map(r => `${r.employeeName}: ${r.items?.length || 0} items (role: ${r.role})`)
    });
    
    return NextResponse.json(
      { 
        rows,
        stats: {
          totalEmployees: employees.length,
          totalSkills: totalItems,
          loadTime
        }
      }, 
      { headers: { "Cache-Control": "no-store" } }
    );
    
  } catch (error) {
    console.error("[GET] Error loading form data:", {
      error: error.message,
      stack: error.stack,
      token: params.token?.substring(0, 20) + '...'
    });
    
    if (error.message?.includes('JWTExpired')) {
      return NextResponse.json(
        { error: "Ссылка истекла. Запросите новую ссылку у администратора." }, 
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
    
    return NextResponse.json(
      { error: error.message || "Ошибка загрузки данных" }, 
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}

// POST остается без изменений
export async function POST(req, { params }) {
  try {
    const payload = await verifyReviewToken(params.token);
    const reviewerUserId = t(payload?.reviewerUserId);
    const role = t(payload?.role);
    
    if (!reviewerUserId) {
      return NextResponse.json(
        { error: "Недействительный токен" }, 
        { status: 401 }
      );
    }

    let body = {};
    try { 
      body = await req.json(); 
    } catch (parseError) {
      console.error("[POST] JSON parse error:", parseError);
      return NextResponse.json(
        { error: "Некорректный JSON" }, 
        { status: 400 }
      );
    }
    
    const EnhancedScoreItem = z.object({
      pageId: z.string().min(1, "Page ID обязателен").regex(/^[a-f0-9-]+$/i, "Некорректный формат Page ID"),
      value: z.number().int().min(0).max(5),
      comment: z.string().max(2000).optional().default(""),
    });

    const EnhancedSubmitPayload = z.object({
      items: z.array(EnhancedScoreItem).min(1).max(100, "Слишком много элементов за раз"),
      mode: z.enum(["draft", "final"]).default("final"),
    });
    
    const parsed = EnhancedSubmitPayload.safeParse(body);
    if (!parsed.success) {
      console.error("[POST] Validation error:", parsed.error);
      return NextResponse.json(
        { error: "Некорректные данные", details: parsed.error.errors }, 
        { status: 400 }
      );
    }

    const { items, mode } = parsed.data;
    const field = ROLE_TO_FIELD[role] || ROLE_TO_FIELD.p1_peer;
    
    console.log(`[POST] Updating ${items.length} items for role: ${role}, field: ${field}`);
    const startTime = Date.now();
    
    const commentProp = await detectCommentProp();
    
    let success = 0, errors = 0;
    
    for (const item of items) {
      try {
        await updateScore(item.pageId, field, item.value, item.comment, commentProp);
        success++;
      } catch (error) {
        console.error(`[POST] Failed to update ${item.pageId}:`, error.message);
        errors++;
      }
    }
    
    const updateTime = Date.now() - startTime;
    console.log(`[POST] Updates completed in ${updateTime}ms. Success: ${success}, Errors: ${errors}`);
    
    return NextResponse.json({ 
      ok: true, 
      role,
      processed: success + errors,
      success,
      errors,
      ...(errors > 0 && { 
        warning: `${errors} обновлений завершились с ошибками` 
      })
    });

  } catch (error) {
    console.error("[POST] Critical error:", error);
    return NextResponse.json(
      { error: error.message || "Внутренняя ошибка сервера" }, 
      { status: 500 }
    );
  }
}