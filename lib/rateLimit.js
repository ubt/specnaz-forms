// Улучшенный rate limiter для Notion API с адаптивной задержкой

class NotionRateLimit {
  constructor() {
    this.requestTimes = [];
    this.minGap = 300; // Минимальная задержка 300ms
    this.maxGap = 2000; // Максимальная задержка 2s
    this.consecutive429 = 0;
    this.lastRequestTime = 0;
    
    // Настройки для разных операций
    this.operationLimits = {
      query: 250,    // Запросы к БД
      update: 400,   // Обновления страниц
      retrieve: 200, // Получение отдельных страниц
      bulk: 500      // Массовые операции
    };
  }
  
  /**
   * Основной метод для ожидания перед запросом
   * @param {string} operation - тип операции (query, update, retrieve, bulk)
   */
  async wait(operation = 'query') {
    const now = Date.now();
    
    // Очищаем старые записи (последние 60 секунд)
    this.requestTimes = this.requestTimes.filter(t => now - t < 60000);
    
    // Вычисляем адаптивную задержку
    const gap = this.calculateGap(operation);
    
    // Проверяем, нужно ли ждать
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < gap) {
      const waitTime = gap - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Проверяем лимит запросов в минуту (консервативно: 180/мин)
    if (this.requestTimes.length >= 180) {
      const oldestRequest = Math.min(...this.requestTimes);
      const waitUntilOldestExpires = 60000 - (now - oldestRequest);
      if (waitUntilOldestExpires > 0) {
        console.warn(`[RateLimit] Waiting ${waitUntilOldestExpires}ms due to rate limit`);
        await new Promise(resolve => setTimeout(resolve, waitUntilOldestExpires));
      }
    }
    
    // Записываем время запроса
    this.lastRequestTime = Date.now();
    this.requestTimes.push(this.lastRequestTime);
  }
  
  /**
   * Вычисляет адаптивную задержку на основе типа операции и истории ошибок
   */
  calculateGap(operation) {
    const baseGap = this.operationLimits[operation] || this.minGap;
    
    // Увеличиваем задержку при частых 429 ошибках
    const adaptiveMultiplier = 1 + (this.consecutive429 * 0.5);
    
    // Учитываем частоту последних запросов
    const recentRequests = this.requestTimes.filter(t => Date.now() - t < 10000).length;
    const frequencyMultiplier = recentRequests > 20 ? 1.5 : 1;
    
    const calculatedGap = baseGap * adaptiveMultiplier * frequencyMultiplier;
    
    return Math.min(Math.max(calculatedGap, this.minGap), this.maxGap);
  }
  
  /**
   * Обработка успешного запроса
   */
  handleSuccess() {
    // Постепенно уменьшаем счетчик 429 ошибок
    this.consecutive429 = Math.max(0, this.consecutive429 - 0.1);
  }
  
  /**
   * Обработка 429 ошибки
   */
  handle429() {
    this.consecutive429++;
    console.warn(`[RateLimit] 429 error count: ${this.consecutive429}`);
  }
  
  /**
   * Получение статистики rate limiter'а
   */
  getStats() {
    const now = Date.now();
    const recentRequests = this.requestTimes.filter(t => now - t < 60000).length;
    
    return {
      requestsLastMinute: recentRequests,
      consecutive429: this.consecutive429,
      lastRequestAgo: now - this.lastRequestTime,
      currentGap: this.calculateGap('query')
    };
  }
  
  /**
   * Сброс статистики (для тестов)
   */
  reset() {
    this.requestTimes = [];
    this.consecutive429 = 0;
    this.lastRequestTime = 0;
  }
}

// Глобальный экземпляр
const globalRateLimit = new NotionRateLimit();

/**
 * Обёртка для Notion API запросов с автоматическим rate limiting и retry
 * @param {Function} apiCall - функция API вызова
 * @param {string} operation - тип операции
 * @param {number} maxRetries - максимальное количество повторов
 */
export async function withRateLimit(apiCall, operation = 'query', maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await globalRateLimit.wait(operation);
      const result = await apiCall();
      globalRateLimit.handleSuccess();
      return result;
      
    } catch (error) {
      lastError = error;
      
      if (error.status === 429) {
        globalRateLimit.handle429();
        
        // Экспоненциальная задержка для retry
        const retryDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.warn(`[RateLimit] 429 error, retrying in ${retryDelay}ms (attempt ${attempt}/${maxRetries})`);
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
      }
      
      // Для других ошибок не повторяем
      break;
    }
  }
  
  throw lastError;
}

/**
 * Простая функция для обратной совместимости
 */
export async function rateLimit() {
  await globalRateLimit.wait('query');
}

/**
 * Экспорт класса для продвинутого использования
 */
export { NotionRateLimit };

/**
 * Экспорт глобального экземпляра
 */
export { globalRateLimit as adaptiveRateLimit };

/**
 * Утилита для мониторинга rate limit
 */
export function logRateLimitStats() {
  if (process.env.NODE_ENV === 'development') {
    const stats = globalRateLimit.getStats();
    console.log('[RateLimit Stats]', stats);
  }
}