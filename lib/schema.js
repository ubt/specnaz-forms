import { z } from "zod";

// Базовая валидация оценки
export const ScoreItem = z.object({
  pageId: z.string().min(1, "ID страницы обязателен"),
  value: z.number()
    .int("Оценка должна быть целым числом")
    .min(0, "Минимальная оценка: 0")
    .max(5, "Максимальная оценка: 5"),
  comment: z.string()
    .max(2000, "Комментарий не может быть длиннее 2000 символов")
    .optional()
    .transform(val => val?.trim() || ""), // Убираем пробелы
});

// Расширенная валидация с метаданными
export const ExtendedScoreItem = ScoreItem.extend({
  employeeId: z.string().optional(),
  employeeName: z.string().optional(),
  skillName: z.string().optional(),
  role: z.enum(['self', 'p1_peer', 'p2_peer', 'manager']).optional(),
});

// Валидация полезной нагрузки отправки
export const SubmitPayload = z.object({
  items: z.array(ScoreItem)
    .min(1, "Должна быть хотя бы одна оценка")
    .max(1000, "Слишком много оценок за раз (максимум 1000)"),
  mode: z.enum(["draft", "final"])
    .default("final")
    .describe("Режим сохранения: черновик или финальная отправка"),
});

// Валидация для админских операций
export const AdminSignRequest = z.object({
  teamName: z.string()
    .min(1, "Название команды обязательно")
    .max(100, "Название команды слишком длинное")
    .transform(val => val.trim()),
  expDays: z.number()
    .int("Срок действия должен быть целым числом")
    .min(1, "Минимальный срок: 1 день")
    .max(365, "Максимальный срок: 365 дней")
    .default(14),
  adminKey: z.string().optional(),
  cycleId: z.string()
    .optional()
    .describe("ID цикла оценки для фильтрации"),
  includeRoles: z.array(z.enum(['self', 'p1_peer', 'p2_peer', 'manager']))
    .optional()
    .describe("Какие роли включить в генерацию ссылок"),
});

// Валидация контекста ревьюера
export const ReviewerContext = z.object({
  userId: z.string().min(1, "ID пользователя обязателен"),
  pageIds: z.array(z.string()).default([]),
  allowedRoles: z.array(z.enum(['self', 'p1_peer', 'p2_peer', 'manager']))
    .default(['p1_peer']),
  teamName: z.string().optional(),
});

// Валидация фильтра сотрудников
export const EmployeeFilter = z.object({
  teamName: z.string()
    .min(1, "Название команды обязательно")
    .transform(val => val.trim()),
  cycleId: z.string().optional(),
  includeInactive: z.boolean().default(false),
});

// Валидация токена ревью
export const ReviewTokenPayload = z.object({
  reviewerUserId: z.string().min(1, "ID ревьюера обязателен"),
  role: z.enum(['self', 'p1_peer', 'p2_peer', 'manager'])
    .optional()
    .describe("Роль ревьюера (может определяться динамически)"),
  teamName: z.string().optional(),
  cycleId: z.string().optional(),
  exp: z.number()
    .int("Время истечения должно быть целым числом")
    .min(Math.floor(Date.now() / 1000), "Токен не может истечь в прошлом"),
});

// Валидация ответа API для списка навыков
export const SkillsResponse = z.object({
  rows: z.array(z.object({
    pageId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    current: z.number().nullable(),
    comment: z.string().optional(),
    employeeId: z.string().optional(),
    employeeName: z.string().optional(),
    role: z.string().optional(),
  })),
  stats: z.object({
    totalEmployees: z.number().optional(),
    totalSkills: z.number().optional(),
    loadTime: z.number().optional(),
  }).optional(),
  warning: z.string().optional(),
  message: z.string().optional(),
});

// Валидация ответа генерации ссылок
export const LinksResponse = z.object({
  ok: z.boolean(),
  teamName: z.string(),
  count: z.number(),
  links: z.array(z.object({
    name: z.string(),
    url: z.string().url("Некорректный URL"),
    userId: z.string().optional(),
    role: z.string().optional(),
  })),
  stats: z.object({
    employeeCount: z.number(),
    reviewerCount: z.number(),
    generationTime: z.number().optional(),
    expirationDays: z.number(),
    expiresAt: z.string().datetime().optional(),
  }).optional(),
  warnings: z.array(z.string()).optional(),
  message: z.string().optional(),
});

// Утилиты валидации

/**
 * Безопасная валидация с детальными ошибками
 */
export function safeValidate(schema, data, context = '') {
  const result = schema.safeParse(data);
  
  if (!result.success) {
    const errors = result.error.issues.map(issue => ({
      field: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
      received: issue.received,
    }));
    
    console.warn(`Validation failed${context ? ` for ${context}` : ''}:`, errors);
    
    return {
      success: false,
      errors,
      formatted: errors.map(e => `${e.field}: ${e.message}`).join(', ')
    };
  }
  
  return {
    success: true,
    data: result.data,
    errors: []
  };
}

/**
 * Валидация массива с частичными успехами
 */
export function validateArray(schema, items, context = '') {
  const results = items.map((item, index) => {
    const validation = safeValidate(schema, item, `${context}[${index}]`);
    return {
      index,
      item,
      ...validation
    };
  });
  
  const valid = results.filter(r => r.success);
  const invalid = results.filter(r => !r.success);
  
  return {
    valid: valid.map(r => r.data),
    invalid,
    stats: {
      total: items.length,
      valid: valid.length,
      invalid: invalid.length,
      successRate: valid.length / items.length
    }
  };
}

/**
 * Создание кастомного валидатора для Notion Page ID
 */
export const NotionPageId = z.string()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, 
    "Некорректный формат Notion Page ID")
  .or(z.string().regex(/^[a-f0-9]{32}$/i, "Некорректный формат Notion Page ID"));

/**
 * Создание кастомного валидатора для Notion User ID  
 */
export const NotionUserId = z.string()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
    "Некорректный формат Notion User ID");

// Переопределяем основные схемы с использованием кастомных валидаторов
export const ValidatedScoreItem = ScoreItem.extend({
  pageId: NotionPageId,
});

export const ValidatedReviewerContext = ReviewerContext.extend({
  userId: NotionUserId,
  pageIds: z.array(NotionPageId).default([]),
});

// Экспорт всех валидаторов
export {
  z as zod // Экспортируем zod для дополнительного использования
};