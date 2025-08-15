import { z } from "zod";

// Валидация UUID/Page ID
const pageIdRegex = /^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i;

export const PageId = z.string()
  .min(1, "Page ID обязателен")
  .refine(
    (val) => {
      // Убираем дефисы для проверки
      const cleaned = val.replace(/-/g, '');
      return cleaned.length === 32 && pageIdRegex.test(val);
    },
    "Некорректный формат Page ID"
  );

// Улучшенная валидация оценки
export const ScoreValue = z.number()
  .int("Оценка должна быть целым числом")
  .min(0, "Минимальная оценка: 0")
  .max(5, "Максимальная оценка: 5");

// Валидация комментария
export const Comment = z.string()
  .max(2000, "Комментарий слишком длинный (макс. 2000 символов)")
  .optional()
  .default("")
  .transform(val => (val || "").trim()); // Автоматически обрезаем пробелы

// Базовый элемент оценки
export const ScoreItem = z.object({
  pageId: PageId,
  value: ScoreValue,
  comment: Comment,
});

// Расширенный элемент с дополнительной валидацией
export const EnhancedScoreItem = ScoreItem.extend({
  // Дополнительные поля для отладки
  skillName: z.string().optional(),
  employeeName: z.string().optional(),
}).refine(
  (data) => {
    // Проверяем, что если оценка 0, то есть комментарий
    if (data.value === 0 && (!data.comment || data.comment.trim().length === 0)) {
      return false;
    }
    return true;
  },
  {
    message: "При оценке 0 обязателен комментарий",
    path: ["comment"]
  }
);

// Полезная нагрузка для отправки
export const SubmitPayload = z.object({
  items: z.array(ScoreItem)
    .min(1, "Необходимо оценить хотя бы один навык")
    .max(100, "Слишком много элементов за раз (макс. 100)"),
  mode: z.enum(["draft", "final"]).default("final"),
}).refine(
  (data) => {
    // Проверяем уникальность pageId
    const pageIds = data.items.map(item => item.pageId);
    const uniquePageIds = new Set(pageIds);
    return pageIds.length === uniquePageIds.size;
  },
  {
    message: "Обнаружены дублирующиеся Page ID",
    path: ["items"]
  }
);

// Расширенная версия с дополнительными проверками
export const EnhancedSubmitPayload = z.object({
  items: z.array(EnhancedScoreItem)
    .min(1, "Необходимо оценить хотя бы один навык")
    .max(100, "Слишком много элементов за раз (макс. 100)"),
  mode: z.enum(["draft", "final"]).default("final"),
  metadata: z.object({
    reviewerRole: z.string().optional(),
    submissionTime: z.number().optional(),
    clientVersion: z.string().optional(),
  }).optional(),
}).refine(
  (data) => {
    const pageIds = data.items.map(item => item.pageId);
    const uniquePageIds = new Set(pageIds);
    return pageIds.length === uniquePageIds.size;
  },
  {
    message: "Обнаружены дублирующиеся Page ID",
    path: ["items"]
  }
);

// Схема для админ-запросов
export const AdminSignRequest = z.object({
  teamName: z.string()
    .min(1, "Название команды обязательно")
    .max(100, "Название команды слишком длинное")
    .trim(),
  expDays: z.number()
    .int("Срок действия должен быть целым числом")
    .min(1, "Минимальный срок: 1 день")
    .max(365, "Максимальный срок: 365 дней")
    .default(14),
  adminKey: z.string().optional(),
});

// Схема для токена ревьюера
export const ReviewerTokenPayload = z.object({
  reviewerUserId: z.string().min(1, "ID ревьюера обязателен"),
  role: z.enum(["self", "p1_peer", "p2_peer", "manager"]).optional(),
  exp: z.number().int().optional(), // Unix timestamp
  teamName: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

// Утилиты для валидации
export const ValidationUtils = {
  // Безопасная валидация с детальными ошибками
  safeValidate: (schema, data) => {
    const result = schema.safeParse(data);
    if (!result.success) {
      const errors = result.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
        code: err.code,
        received: err.received
      }));
      return { success: false, errors, data: null };
    }
    return { success: true, errors: [], data: result.data };
  },
  
  // Валидация массива с частичными ошибками
  validateArray: (schema, items) => {
    const results = items.map((item, index) => {
      const result = schema.safeParse(item);
      return {
        index,
        success: result.success,
        data: result.success ? result.data : null,
        errors: result.success ? [] : result.error.errors
      };
    });
    
    const validItems = results
      .filter(r => r.success)
      .map(r => r.data);
      
    const invalidItems = results
      .filter(r => !r.success)
      .map(r => ({ index: r.index, errors: r.errors }));
    
    return {
      validItems,
      invalidItems,
      hasErrors: invalidItems.length > 0,
      totalValid: validItems.length,
      totalInvalid: invalidItems.length
    };
  },
  
  // Нормализация Page ID
  normalizePageId: (pageId) => {
    if (typeof pageId !== 'string') return pageId;
    
    // Убираем дефисы и добавляем их в правильных местах
    const cleaned = pageId.replace(/-/g, '').toLowerCase();
    if (cleaned.length !== 32) return pageId;
    
    return `${cleaned.slice(0,8)}-${cleaned.slice(8,12)}-${cleaned.slice(12,16)}-${cleaned.slice(16,20)}-${cleaned.slice(20,32)}`;
  }
};

// Экспорт всех схем для удобства
export const Schemas = {
  PageId,
  ScoreValue,
  Comment,
  ScoreItem,
  EnhancedScoreItem,
  SubmitPayload,
  EnhancedSubmitPayload,
  AdminSignRequest,
  ReviewerTokenPayload
};

export default Schemas;