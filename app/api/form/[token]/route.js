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

// Улучшенная валидация
const EnhancedScoreItem = z.object({
  pageId: z.string().min(1, "Page ID обязателен").regex(/^[a-f0-9-]+$/i, "Некорректный формат Page ID"),
  value: z.number().int().min(0).max(5),
  comment: z.string().max(2000).optional().default(""),
});

const EnhancedSubmitPayload = z.object({
  items: z.array(EnhancedScoreItem).min(1).max(100, "Слишком много элементов за раз"),
  mode: z.enum(["draft", "final"]).default("final"),
});

// Batch-процессор для обновлений
class BatchProcessor {
  constructor(options = {}) {
    this.concurrency = options.concurrency || 2;
    this.batchSize = options.batchSize || 3;
    this.retryAttempts = options.retryAttempts || 2;
  }
  
  async process(items, processor) {
    const results = { success: 0, errors: 0, errorDetails: [] };
    
    // Разбиваем на батчи
    const batches = [];
    for (let i = 0; i < items.length; i += this.batchSize) {
      batches.push(items.slice(i, i + this.batchSize));
    }
    
    // Семафор для ограничения параллельности
    let activeTasks = 0;
    const maxConcurrency = this.concurrency;
    
    const processBatch = async (batch, batchIndex) => {
      console.log(`[BATCH ${batchIndex + 1}/${batches.length}] Processing ${batch.length} items`);
      
      const batchResults = await Promise.allSettled(
        batch.map(async (item) => {
          for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
            try {
              const result = await processor(item);
              return { success: true, result, item };
            } catch (error) {
              if (attempt === this.retryAttempts - 1) {
                console.error(`Failed to process ${item.pageId}:`, error.message);
                return { success: false, error, item };
              }
              // Ждем перед повтором
              await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
          }
        })
      );
      
      // Собираем результаты
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          if (result.value.success) {
            results.success++;
          } else {
            results.errors++;
            results.errorDetails.push(result.value);
          }
        } else {
          results.errors++;
          results.errorDetails.push({ success: false, error: result.reason });
        }
      }
      
      // Пауза между батчами
      if (batchIndex < batches.length - 1) {
        await new Promise(r => setTimeout(r, 200));
      }
    };
    
    // Запускаем батчи с ограниченной параллельностью
    const batchPromises = [];
    
    for (let i = 0; i < batches.length; i++) {
      const batchPromise = (async () => {
        while (activeTasks >= maxConcurrency) {
          await new Promise(r => setTimeout(r, 100));
        }
        activeTasks++;
        try {
          await processBatch(batches[i], i);
        } finally {
          activeTasks--;
        }
      })();
      
      batchPromises.push(batchPromise);
    }
    
    await Promise.all(batchPromises);
    return results;
  }
}

function t(s) { return (s || "").trim(); }

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
    const startTime = Date.now();
    
    const employees = await listEvaluateesForReviewerUser(reviewerUserId);
    
    if (!employees?.length) {
      return NextResponse.json(
        { rows: [] }, 
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    
    const rows = await fetchEmployeeSkillRowsForReviewerUser(employees, reviewerUserId);
    
    const loadTime = Date.now() - startTime;
    console.log(`[GET] Data loaded in ${loadTime}ms. Employees: ${employees.length}, Total items: ${rows.reduce((sum, r) => sum + (r.items?.length || 0), 0)}`);
    
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
    
    const parsed = EnhancedSubmitPayload.safeParse(body);
    if (!parsed.success) {
      console.error("[POST] Validation error:", parsed.error);
      return NextResponse.json(
        { error: "Некорректные данные", details: parsed.error.errors }, 
        { status: 400 }
      );
    }

    const { items, mode } = parsed.data;
    const field = ROLE_TO_FIELD[role] || ROLE_TO_FIELD.peer;
    
    console.log(`[POST] Updating ${items.length} items for role: ${role}, field: ${field}`);
    const startTime = Date.now();
    
    // Определяем поле для комментариев
    const commentProp = await detectCommentProp();
    
    // Создаем batch-процессор
    const batchProcessor = new BatchProcessor({
      concurrency: 2,
      batchSize: 3,
      retryAttempts: 3
    });
    
    // Процессор для одного элемента
    const updateProcessor = async (item) => {
      return await updateScore(item.pageId, field, item.value, item.comment, commentProp);
    };
    
    // Выполняем batch-обновление
    const result = await batchProcessor.process(items, updateProcessor);
    
    const updateTime = Date.now() - startTime;
    console.log(`[POST] Updates completed in ${updateTime}ms. Success: ${result.success}, Errors: ${result.errors}`);
    
    if (result.errors > 0) {
      console.warn(`[POST] Some updates failed:`, result.errorDetails.slice(0, 3)); // Логируем первые 3 ошибки
    }
    
    // Возвращаем результат даже при частичных ошибках
    return NextResponse.json({ 
      ok: true, 
      role,
      processed: result.success + result.errors,
      success: result.success,
      errors: result.errors,
      ...(result.errors > 0 && { 
        warning: `${result.errors} обновлений завершились с ошибками` 
      })
    });

  } catch (error) {
    console.error("[POST] Critical error:", error);
    return NextResponse.json(
      { error: error.message || "Внутренняя ошибка сервера" }, 
      { status: 500 }
    );
  }