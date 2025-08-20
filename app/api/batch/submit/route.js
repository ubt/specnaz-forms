// app/api/batch/submit/route.js - ФИНАЛЬНАЯ версия с надежной KV инициализацией
export const runtime = "edge";

import { NextResponse } from "next/server";
import { verifyReviewToken } from "@/lib/token";
import { NotionBatchProcessor, addBatchToKVQueue, isKVConnected, initKV } from "@/lib/kv-queue";
import { notion } from "@/lib/notion";

// Обновленные лимиты безопасности
const LIMITS = {
  DIRECT_PROCESSING: {
    maxOperations: 10,
    maxOperationSize: 8000
  },
  KV_QUEUE: {
    maxOperations: 1000,
    maxOperationSize: 10000
  },
  GENERAL: {
    maxConcurrency: 3,
    minRateLimit: 2000,
    maxRetries: 3
  }
};

export async function POST(req, context) {
  console.log('[BATCH SUBMIT] ===== 🚀 Новый запрос на batch обработку (Next.js на CF Pages) =====');
  
  // ИСПРАВЛЕНО: Инициализация KV для Next.js на Cloudflare Pages
  console.log('[BATCH SUBMIT] 🔧 Инициализация KV для Next.js на CF Pages...');
  console.log('[BATCH SUBMIT] 📊 Context анализ:', {
    hasContext: !!context,
    contextKeys: context ? Object.keys(context) : [],
    globalKVExists: typeof NOTION_QUEUE_KV !== 'undefined',
    processEnvKV: typeof process?.env?.NOTION_QUEUE_KV
  });
  
  try {
    // Инициализируем KV с context, но не блокируем выполнение при неудаче
    const kvInitResult = initKV(context);
    console.log(`[BATCH SUBMIT] KV инициализация: ${kvInitResult ? '✅ УСПЕШНО' : '⚠️ НЕУДАЧНО (продолжаем без KV)'}`);
  } catch (initError) {
    console.warn('[BATCH SUBMIT] ⚠️ Ошибка инициализации KV (не критично):', initError.message);
  }
  
  
  
// УЛУЧШЕННАЯ функция для прямой обработки
async function handleDirectProcessing(operations, options, reason = 'direct') {
  console.log(`[DIRECT PROCESSING] 🚀 Причина: ${reason}, операций: ${operations.length}`);
  
  try {
    const processor = new NotionBatchProcessor(notion, options);
    const result = await processor.processBatchDirectly(operations);
    
    const successRate = result.stats.totalOperations > 0 ?
      (result.stats.successful / result.stats.totalOperations * 100).toFixed(1) : 0;

    const message = reason === 'kv_fallback' 
      ? `🔄 KV недоступно, выполнена прямая обработка. Успешно: ${result.stats.successful}/${result.stats.totalOperations} (${successRate}%). Время: ${(result.stats.duration / 1000).toFixed(1)}с.`
      : `✅ Прямая обработка завершена! Успешно: ${result.stats.successful}/${result.stats.totalOperations} (${successRate}%). Время: ${(result.stats.duration / 1000).toFixed(1)}с.`;

    return NextResponse.json({
      success: true,
      mode: reason === 'kv_fallback' ? 'direct_processing_fallback' : 'direct_processing',
      results: result.results,
      stats: result.stats,
      message: message,
      completed: true,
      timestamp: new Date().toISOString(),
      kvFallback: reason === 'kv_fallback'
    });
    
  } catch (directError) {
    console.error('[DIRECT PROCESSING] ❌ Ошибка прямой обработки:', directError.message);
    
    return NextResponse.json(
      {
        error: "❌ Ошибка при прямой обработке операций",
        details: directError.message,
        mode: 'direct_processing_failed',
        suggestion: "Попробуйте уменьшить количество операций или повторите позже"
      },
      { status: 500 }
    );
  }
}

export async function GET(req, context) {
  console.log('[KV DIAGNOSTICS] 🔍 ДИАГНОСТИКА для Next.js на Cloudflare Pages');
  
  const diagnostics = {
    timestamp: new Date().toISOString(),
    runtime: "edge",
    platform: "Next.js на Cloudflare Pages",
    url: req.url,
    nextjsVersion: "14.2.5"
  };

  // УЛУЧШЕННАЯ проверка context для Next.js
  diagnostics.context = {
    provided: !!context,
    type: typeof context,
    contextKeys: context ? Object.keys(context) : [],
    
    // Стандартные проверки
    hasEnv: !!context?.env,
    hasBindings: !!context?.bindings,
    envKeys: context?.env ? Object.keys(context.env) : [],
    
    // Next.js специфичные проверки
    nextjsSpecific: {
      hasParams: !!context?.params,
      paramsKeys: context?.params ? Object.keys(context.params) : []
    }
  };

  // УЛУЧШЕННАЯ проверка доступных способов доступа к KV
  diagnostics.kvAccess = {
    globalNOTION_QUEUE_KV: {
      exists: typeof NOTION_QUEUE_KV !== 'undefined',
      type: typeof NOTION_QUEUE_KV,
      isKVObject: typeof NOTION_QUEUE_KV !== 'undefined' && 
                  typeof NOTION_QUEUE_KV === 'object' &&
                  typeof NOTION_QUEUE_KV.get === 'function'
    },
    globalThisAccess: {
      exists: typeof globalThis !== 'undefined' && !!globalThis.NOTION_QUEUE_KV,
      type: typeof globalThis?.NOTION_QUEUE_KV
    },
    processEnvAccess: {
      exists: !!(process?.env?.NOTION_QUEUE_KV),
      type: typeof process?.env?.NOTION_QUEUE_KV,
      isObject: typeof process?.env?.NOTION_QUEUE_KV === 'object'
    },
    contextAccess: {
      throughEnv: !!context?.env?.NOTION_QUEUE_KV,
      throughBindings: !!context?.bindings?.NOTION_QUEUE_KV,
      directContext: !!context?.NOTION_QUEUE_KV
    }
  };

  // Инициализация KV с детальным логированием
  console.log('[KV DIAGNOSTICS] 🔧 Попытка инициализации KV...');
  const kvInitResult = initKV(context);
  
  diagnostics.kvInitialization = {
    success: kvInitResult,
    connected: isKVConnected(),
    details: getKVDiagnostics()
  };
