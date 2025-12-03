// lib/config.js - Централизованная конфигурация приложения

export const CONFIG = {
  // Настройки кэширования
  CACHE: {
    SKILLS_TTL: 10 * 60 * 1000,        // 10 минут для навыков
    DB_STRUCTURE_TTL: 30 * 60 * 1000,  // 30 минут для структур БД
    EMPLOYEE_TTL: 15 * 60 * 1000,      // 15 минут для сотрудников
    MAX_ENTRIES: 500,                   // Максимум записей в кэше
    CLIENT_TTL: 5 * 60 * 1000,         // 5 минут для клиентского кэша
  },

  // Настройки Rate Limiting для Notion API
  RATE_LIMIT: {
    MIN_DELAY: 50,           // Минимальная задержка между запросами (мс)
    MAX_DELAY: 5000,         // Максимальная задержка (мс)
    INITIAL_DELAY: 100,      // Начальная задержка
    BURST_THRESHOLD: 10,     // Порог для burst режима
    BACKOFF_MULTIPLIER: 1.5, // Множитель при увеличении задержки
    RECOVERY_MULTIPLIER: 0.8, // Множитель при уменьшении задержки
    WINDOW_MS: 60000,        // Окно для подсчета запросов (1 минута)
  },

  // Настройки Batch обработки
  BATCH: {
    MAX_OPERATIONS: 500,      // Максимум операций в одном batch
    DEFAULT_BATCH_SIZE: 50,   // Размер батча по умолчанию
    MAX_BATCH_SIZE: 100,      // Максимальный размер батча
    MAX_CONCURRENCY: 3,       // Максимум параллельных запросов
    DEFAULT_CONCURRENCY: 2,   // Параллельность по умолчанию
    MIN_RATE_LIMIT_DELAY: 2000, // Минимальная задержка между батчами
    MAX_RETRIES: 3,           // Максимум повторов
  },

  // Настройки Cloudflare KV
  KV: {
    MIN_TTL: 60,              // Минимальный TTL (требование CF)
    MAX_VALUE_SIZE: 25000000, // 25MB максимальный размер значения
    MAX_KEY_LENGTH: 512,      // Максимальная длина ключа
    DEFAULT_TTL: 3600,        // 1 час по умолчанию
    BATCH_TTL: 7200,          // 2 часа для batch операций
    RESULT_TTL: 1800,         // 30 минут для результатов
  },

  // Настройки Admin Rate Limiting
  ADMIN: {
    MAX_REQUESTS: 10,         // Максимум запросов в окне
    WINDOW_MS: 60000,         // 1 минута окно
    BLOCK_DURATION_MS: 300000, // 5 минут блокировки
  },

  // Настройки пагинации Notion
  PAGINATION: {
    DEFAULT_PAGE_SIZE: 100,   // Размер страницы по умолчанию
    MAX_PAGES: 20,            // Максимум страниц для загрузки
  },

  // Параллельность загрузки
  PARALLEL: {
    SKILL_LOAD_BATCH: 30,     // Параллельная загрузка навыков
    EMPLOYEE_LOAD_BATCH: 20,  // Параллельная загрузка сотрудников
  },
};

// Названия полей в Notion (для удобства переименования)
export const PROP = {
  // БД "Оценки компетенций" (Matrix)
  employee: "Сотрудник",
  skill: "Навык",
  skillName: "Навык - название",
  skillDescription: "Описание навыка",
  
  // Поля оценивающих (People)
  selfScorer: "Self_scorer",
  p1Peer: "P1_peer",
  p2Peer: "P2_peer",
  managerScorer: "Manager_scorer",
  
  // Поля оценок (Number)
  selfScore: "Self_score",
  p1Score: "P1_score",
  p2Score: "P2_score",
  managerScore: "Manager_score",
  
  // БД "Сотрудники"
  team: "Команда",
  empAccount: "Учетка",
  empTitle: "Сотрудник",
};

// Маппинг ролей к полям оценок
export const ROLE_TO_FIELD = {
  self: "Self_score",
  p1_peer: "P1_score", 
  p2_peer: "P2_score",
  manager: "Manager_score",
  peer: "P1_score", // fallback
};

// Маппинг ролей к полям scorer
export const ROLE_TO_SCORER_FIELD = {
  self: "Self_scorer",
  p1_peer: "P1_peer",
  p2_peer: "P2_peer", 
  manager: "Manager_scorer",
};

export default CONFIG; 