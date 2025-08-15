// Простой rate limiter для Edge runtime
class SimpleRateLimit {
  constructor() {
    this.requests = [];
    this.currentDelay = 300;
    this.minDelay = 200;
    this.maxDelay = 2000;
    this.windowMs = 60000; // 1 минута
  }
  
  cleanOldRecords() {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    this.requests = this.requests.filter(t => t > cutoff);
  }
  
  async wait() {
    this.cleanOldRecords();
    
    const now = Date.now();
    const recentRequests = this.requests.filter(t => now - t < 5000); // За последние 5 сек
    
    // Если слишком много запросов - увеличиваем задержку
    if (recentRequests.length > 5) {
      this.currentDelay = Math.min(this.currentDelay * 1.5, this.maxDelay);
    } else if (recentRequests.length === 0) {
      // Если нет недавних запросов - уменьшаем задержку
      this.currentDelay = Math.max(this.currentDelay * 0.9, this.minDelay);
    }
    
    await new Promise(r => setTimeout(r, this.currentDelay));
    this.requests.push(Date.now());
  }
  
  recordError(error) {
    if (error?.status === 429) {
      this.currentDelay = this.maxDelay;
    }
  }
  
  reset() {
    this.requests = [];
    this.currentDelay = this.minDelay;
  }
}

// Глобальный экземпляр
export const rateLimit = new SimpleRateLimit();

// Простая функция для обратной совместимости
let lastRequest = 0;
export async function simpleRateLimit() {
  const now = Date.now();
  const diff = now - lastRequest;
  
  if (diff < 300) {
    await new Promise(r => setTimeout(r, 300 - diff));
  }
  
  lastRequest = Date.now();
}

export default rateLimit;