// Улучшенный адаптивный rate limiter для Edge runtime
class AdaptiveRateLimit {
  constructor() {
    this.requests = [];
    this.errors = [];
    this.currentDelay = 200;
    this.minDelay = 150;
    this.maxDelay = 5000;
    this.windowMs = 60000; // 1 минута
    this.maxRpm = 180; // Лимит Notion API
    this.errorThreshold = 3;
    this.consecutiveSuccess = 0;
  }
  
  cleanOldRecords() {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    
    this.requests = this.requests.filter(t => t > cutoff);
    this.errors = this.errors.filter(t => t > cutoff);
  }
  
  getRequestRate() {
    this.cleanOldRecords();
    return this.requests.length;
  }
  
  getErrorRate() {
    this.cleanOldRecords();
    return this.errors.length;
  }
  
  adaptDelay() {
    const errorRate = this.getErrorRate();
    const requestRate = this.getRequestRate();
    
    // Если много ошибок - увеличиваем задержку агрессивно
    if (errorRate >= this.errorThreshold) {
      this.currentDelay = Math.min(this.currentDelay * 1.8, this.maxDelay);
      this.consecutiveSuccess = 0;
      console.warn(`[RATE LIMIT] High error rate (${errorRate}), delay: ${this.currentDelay}ms`);
    }
    // Если высокая нагрузка - умеренно увеличиваем
    else if (requestRate > this.maxRpm * 0.8) {
      this.currentDelay = Math.min(this.currentDelay * 1.3, this.maxDelay);
      this.consecutiveSuccess = 0;
    }
    // Если всё хорошо - постепенно уменьшаем
    else if (errorRate === 0 && this.consecutiveSuccess > 5) {
      this.currentDelay = Math.max(this.currentDelay * 0.9, this.minDelay);
    }
  }
  
  async wait() {
    this.adaptDelay();
    
    const now = Date.now();
    
    // Проверяем burst rate (последние 3 секунды)
    const burstWindow = 3000;
    const recentRequests = this.requests.filter(t => now - t < burstWindow);
    const burstLimit = 10; // Максимум 10 запросов за 3 секунды
    
    if (recentRequests.length >= burstLimit) {
      const extraDelay = 500;
      console.warn(`[RATE LIMIT] Burst limit reached, adding ${extraDelay}ms delay`);
      await new Promise(r => setTimeout(r, extraDelay));
    }
    
    // Основная задержка
    await new Promise(r => setTimeout(r, this.currentDelay));
    
    this.requests.push(Date.now());
  }
  
  recordError(error) {
    this.errors.push(Date.now());
    this.consecutiveSuccess = 0;
    
    if (error?.status === 429) {
      // При 429 резко увеличиваем задержку
      this.currentDelay = Math.min(this.currentDelay * 2.5, this.maxDelay);
      console.warn(`[RATE LIMIT] 429 error, delay increased to ${this.currentDelay}ms`);
    } else if (error?.status >= 500) {
      // Серверные ошибки - умеренное увеличение
      this.currentDelay = Math.min(this.currentDelay * 1.5, this.maxDelay);
    }
  }
  
  recordSuccess() {
    this.consecutiveSuccess++;
    
    // После многих успешных запросов можем быть агрессивнее
    if (this.consecutiveSuccess > 20) {
      this.currentDelay = Math.max(this.currentDelay * 0.95, this.minDelay);
    }
  }
  
  getStats() {
    return {
      currentDelay: this.currentDelay,
      requestRate: this.getRequestRate(),
      errorRate: this.getErrorRate(),
      consecutiveSuccess: this.consecutiveSuccess,
      totalRequests: this.requests.length
    };
  }
  
  // Сброс состояния (для экстренных случаев)
  reset() {
    this.requests = [];
    this.errors = [];
    this.currentDelay = this.minDelay;
    this.consecutiveSuccess = 0;
    console.log('[RATE LIMIT] State reset');
  }
}

// Глобальный экземпляр для всего приложения
export const adaptiveRateLimit = new AdaptiveRateLimit();

// Простой rate limiter для обратной совместимости
let lastRequest = 0;
const MIN_GAP_MS = 300; // Увеличили базовую задержку

export async function rateLimit() {
  const now = Date.now();
  const diff = now - lastRequest;
  
  if (diff < MIN_GAP_MS) {
    await new Promise(r => setTimeout(r, MIN_GAP_MS - diff));
  }
  
  lastRequest = Date.now();
}

// Экспорт для использования в других модулях
export default adaptiveRateLimit;