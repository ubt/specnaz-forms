// lib/kv-queue.js - ИСПРАВЛЕННАЯ версия для Next.js на Cloudflare Pages
import { getRequestContext } from '@cloudflare/next-on-pages';

// Глобальные переменные для состояния
let kvInitialized = false;
let initAttempts = 0;
let lastInitTime = 0;

// Диагностическая информация
const diagnostics = {
  initAttempts: 0,
  lastError: null,
  lastSuccess: null,
  kvConnected: false
};

// ИСПРАВЛЕННАЯ инициализация KV для Next.js на Pages
export function initKV() {
  initAttempts++;
  diagnostics.initAttempts = initAttempts;
  
  try {
    // В Next.js на Pages KV доступен только внутри request handlers
    // через getRequestContext(), поэтому просто отмечаем что инициализация вызвана
    kvInitialized = true;
    lastInitTime = Date.now();
    
    console.log(`[KV INIT] Инициализация помечена успешной (попытка #${initAttempts})`);
    return true;
  } catch (error) {
    console.error('[KV INIT] Ошибка инициализации:', error.message);
    diagnostics.lastError = error.message;
    return false;
  }
}

// Получение KV namespace внутри request handler
export function getKV() {
  try {
    const { env } = getRequestContext();
    if (!env.NOTION_QUEUE_KV) {
      throw new Error('NOTION_QUEUE_KV binding not found');
    }
    return env.NOTION_QUEUE_KV;
  } catch (error) {
    console.error('[KV ACCESS] Ошибка доступа к KV:', error.message);
    throw new Error(`KV недоступен: ${error.message}`);
  }
}

// Проверка доступности KV
export async function isKVConnected() {
  try {
    const kv = getKV();
    
    // Быстрый тест доступности
    const testKey = `health_${Date.now()}`;
    await kv.put(testKey, 'test', { expirationTtl: 60 });
    const result = await kv.get(testKey);
    await kv.delete(testKey);
    
    const connected = result === 'test';
    diagnostics.kvConnected = connected;
    
    if (connected) {
      diagnostics.lastSuccess = new Date().toISOString();
    }
    
    return connected;
  } catch (error) {
    console.error('[KV CONNECTION] Ошибка проверки:', error.message);
    diagnostics.kvConnected = false;
    diagnostics.lastError = error.message;
    return false;
  }
}

// Генерация уникального ID для batch операций
function generateBatchId() {
  return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Генерация ID для job
function generateJobId(batchId, index) {
  return `job_${batchId}_${index}`;
}

// Добавление batch в KV очередь
export async function addBatchToKVQueue(operations, options = {}) {
  console.log(`[KV QUEUE] Добавляем ${operations.length} операций в KV очередь`);
  
  try {
    const kv = getKV();
    const batchId = generateBatchId();
    
    // Разделяем операции на job'ы
    const batchSize = options.batchSize || 25;
    const jobs = [];
    
    for (let i = 0; i < operations.length; i += batchSize) {
      const chunk = operations.slice(i, i + batchSize);
      const jobId = generateJobId(batchId, jobs.length);
      
      jobs.push({
        jobId,
        operations: chunk,
        status: 'pending',
        created: Date.now(),
        retries: 0
      });
    }
    
    console.log(`[KV QUEUE] Создано ${jobs.length} job'ов для batch ${batchId}`);
    
    // Сохраняем каждый job в KV
    const promises = jobs.map(async (job) => {
      const key = `queue:job:${job.jobId}`;
      await kv.put(key, JSON.stringify(job), { 
        expirationTtl: 3600 // 1 час на выполнение
      });
    });
    
    await Promise.all(promises);
    
    // Сохраняем метаданные batch
    const batchMeta = {
      batchId,
      totalJobs: jobs.length,
      totalOperations: operations.length,
      jobIds: jobs.map(j => j.jobId),
      status: 'pending',
      created: Date.now(),
      options
    };
    
    await kv.put(`queue:batch:${batchId}`, JSON.stringify(batchMeta), {
      expirationTtl: 3600
    });
    
    console.log(`[KV QUEUE] Batch ${batchId} успешно сохранен в KV`);
    
    return {
      batchId,
      jobIds: jobs.map(j => j.jobId),
      totalJobs: jobs.length,
      totalOperations: operations.length
    };
    
  } catch (error) {
    console.error('[KV QUEUE] Ошибка добавления в очередь:', error.message);
    throw new Error(`Ошибка KV очереди: ${error.message}`);
  }
}

// Получение статуса batch операций
export async function getKVBatchStatus(jobIds) {
  try {
    const kv = getKV();
    console.log(`[KV STATUS] Получаем статус для ${jobIds.length} задач`);
    
    const promises = jobIds.map(async (jobId) => {
      try {
        const key = `queue:job:${jobId}`;
        const jobData = await kv.get(key, 'json');
        
        if (!jobData) {
          return {
            jobId,
            status: 'not_found',
            error: 'Job not found in KV'
          };
        }
        
        return {
          jobId,
          status: jobData.status,
          operations: jobData.operations?.length || 0,
          processed: jobData.processed || 0,
          successful: jobData.successful || 0,
          failed: jobData.failed || 0,
          progress: jobData.operations?.length > 0 ? 
            Math.round((jobData.processed / jobData.operations.length) * 100) : 0,
          created: jobData.created,
          updated: jobData.updated || jobData.created,
          retries: jobData.retries || 0
        };
      } catch (error) {
        console.error(`[KV STATUS] Ошибка получения статуса ${jobId}:`, error.message);
        return {
          jobId,
          status: 'error',
          error: error.message
        };
      }
    });
    
    const results = await Promise.all(promises);
    console.log(`[KV STATUS] Получен статус для ${results.length} задач`);
    
    return results;
  } catch (error) {
    console.error('[KV STATUS] Критическая ошибка:', error.message);
    throw new Error(`Ошибка получения статуса: ${error.message}`);
  }
}

// Получение результатов выполнения
export async function getKVBatchResults(jobIds) {
  try {
    const kv = getKV();
    console.log(`[KV RESULTS] Получаем результаты для ${jobIds.length} задач`);
    
    const promises = jobIds.map(async (jobId) => {
      try {
        const key = `queue:results:${jobId}`;
        const results = await kv.get(key, 'json');
        
        if (!results) {
          console.warn(`[KV RESULTS] Результаты для ${jobId} не найдены`);
          return [];
        }
        
        return Array.isArray(results) ? results : [];
      } catch (error) {
        console.error(`[KV RESULTS] Ошибка получения результатов ${jobId}:`, error.message);
        return [];
      }
    });
    
    const allResults = await Promise.all(promises);
    const flatResults = allResults.flat();
    
    console.log(`[KV RESULTS] Получено ${flatResults.length} результатов`);
    return flatResults;
  } catch (error) {
    console.error('[KV RESULTS] Критическая ошибка:', error.message);
    throw new Error(`Ошибка получения результатов: ${error.message}`);
  }
}

// Класс для batch обработки Notion операций
export class NotionBatchProcessor {
  constructor(notionClient, options = {}) {
    this.notion = notionClient;
    this.options = {
      batchSize: options.batchSize || 25,
      concurrency: options.concurrency || 2,
      rateLimitDelay: options.rateLimitDelay || 2500,
      maxRetries: options.maxRetries || 3,
      useKV: options.useKV || false,
      ...options
    };
  }
  
  async processBatchDirectly(operations) {
    console.log(`[DIRECT PROCESSING] Начинаем обработку ${operations.length} операций`);
    const startTime = Date.now();
    
    const results = [];
    let successful = 0;
    let failed = 0;
    
    // Разбиваем на chunks для rate limiting
    const chunks = this.chunkArray(operations, this.options.batchSize);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[DIRECT PROCESSING] Обрабатываем chunk ${i + 1}/${chunks.length} (${chunk.length} операций)`);
      
      // Обрабатываем операции в chunk'е
      for (const operation of chunk) {
        try {
          await this.rateLimitedDelay();
          const result = await this.executeNotionOperation(operation);
          results.push({ ...result, status: 'success' });
          successful++;
        } catch (error) {
          console.error(`[DIRECT PROCESSING] Ошибка операции:`, error.message);
          results.push({ 
            operation, 
            status: 'error', 
            error: error.message 
          });
          failed++;
        }
      }
    }
    
    const duration = Date.now() - startTime;
    
    console.log(`[DIRECT PROCESSING] Завершено: ${successful} успешно, ${failed} ошибок, ${duration}ms`);
    
    return {
      results,
      stats: {
        totalOperations: operations.length,
        successful,
        failed,
        duration
      }
    };
  }
  
  async executeNotionOperation(operation) {
    const { pageId, properties } = operation;
    
    return await this.notion.pages.update({
      page_id: pageId,
      properties
    });
  }
  
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
  
  async rateLimitedDelay() {
    await new Promise(resolve => setTimeout(resolve, this.options.rateLimitDelay));
  }
}

// Получение диагностической информации
export function getKVDiagnostics() {
  return {
    ...diagnostics,
    kvInitialized,
    lastInitTime,
    isConfigured: kvInitialized,
    timestamp: new Date().toISOString()
  };
}

// Функция для очистки старых данных из KV
export async function cleanupKVQueue() {
  try {
    const kv = getKV();
    
    // Получаем список всех ключей с префиксом queue:
    const list = await kv.list({ prefix: 'queue:' });
    
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 часа
    
    let cleaned = 0;
    
    for (const key of list.keys) {
      try {
        const data = await kv.get(key.name, 'json');
        if (data && data.created && (now - data.created) > maxAge) {
          await kv.delete(key.name);
          cleaned++;
        }
      } catch (error) {
        console.warn(`[KV CLEANUP] Ошибка очистки ${key.name}:`, error.message);
      }
    }
    
    console.log(`[KV CLEANUP] Очищено ${cleaned} устаревших записей`);
    return cleaned;
  } catch (error) {
    console.error('[KV CLEANUP] Ошибка очистки:', error.message);
    return 0;
  }
}