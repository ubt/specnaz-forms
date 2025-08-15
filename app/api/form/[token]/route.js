export const runtime = "edge";

import { NextResponse } from "next/server";
import { verifyReviewToken } from "@/lib/token";
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
    const payload = await verifyReviewToken(params.token);
    const reviewerUserId = t(payload?.reviewerUserId);
    
    if (!reviewerUserId) {
      return NextResponse.json(
        { error: "Недействительный токен" }, 
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
    
    console.log(`[GET] Loading data for reviewer: ${reviewerUserId}`);
    
    const employees = await listEvaluateesForReviewerUser(reviewerUserId);
    
    if (!employees?.length) {
      return NextResponse.json(
        { rows: [] }, 
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    
    const rows = await fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId);
    
    return NextResponse.json(
      { rows }, 
      { headers: { "Cache-Control": "no-store" } }
    );
    
  } catch (error) {
    console.error("[GET] Error loading form data:", error);
    return NextResponse.json(
      { error: error.message || "Ошибка загрузки данных" }, 
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}

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
    
    if (!body.items || !Array.isArray(body.items)) {
      return NextResponse.json(
        { error: "Некорректные данные: items должен быть массивом" }, 
        { status: 400 }
      );
    }

    const { items } = body;
    const field = ROLE_TO_FIELD[role] || "P1_score";
    
    console.log(`[POST] Updating ${items.length} items for role: ${role}, field: ${field}`);
    
    // Определяем поле для комментариев
    const commentProp = await detectCommentProp();
    
    // Последовательно обновляем все элементы
    let success = 0;
    let errors = 0;
    
    for (const item of items) {
      try {
        if (!item.pageId || typeof item.value !== 'number') {
          console.error('Invalid item:', item);
          errors++;
          continue;
        }
        
        await updateScore(item.pageId, field, item.value, item.comment || "", commentProp);
        success++;
        
        // Небольшая пауза между запросами
        await new Promise(r => setTimeout(r, 300));
        
      } catch (error) {
        console.error(`Failed to update ${item.pageId}:`, error.message);
        errors++;
      }
    }
    
    console.log(`[POST] Updates completed. Success: ${success}, Errors: ${errors}`);
    
    return NextResponse.json({ 
      ok: true, 
      role,
      processed: success + errors,
      success: success,
      errors: errors,
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