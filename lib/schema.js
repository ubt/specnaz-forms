import { z } from "zod";

// Page ID
export const PageId = z.string().min(1, "Page ID обязателен");

// Оценка
export const ScoreValue = z.number()
  .int("Оценка должна быть целым числом")
  .min(0, "Минимальная оценка: 0")
  .max(5, "Максимальная оценка: 5");

// Комментарий
export const Comment = z.string()
  .max(1000, "Комментарий слишком длинный")
  .optional()
  .default("");

// Элемент оценки
export const ScoreItem = z.object({
  pageId: PageId,
  value: ScoreValue,
  comment: Comment,
});

// Payload для отправки
export const SubmitPayload = z.object({
  items: z.array(ScoreItem)
    .min(1, "Необходимо оценить хотя бы один навык")
    .max(100, "Слишком много элементов"),
});

// Админ запрос
export const AdminSignRequest = z.object({
  teamName: z.string()
    .min(2, "Название команды слишком короткое")
    .max(100, "Название команды слишком длинное")
    .trim(),
  expDays: z.number()
    .int()
    .min(1, "Минимальный срок: 1 день")
    .max(365, "Максимальный срок: 365 дней")
    .default(14),
  adminKey: z.string().optional(),
});

// Токен ревьюера
export const ReviewerTokenPayload = z.object({
  reviewerUserId: z.string().min(1),
  role: z.string().optional(),
  exp: z.number().int().optional(),
  teamName: z.string().optional(),
});

// Batch операция
export const BatchOperation = z.object({
  pageId: z.string().min(1, "Page ID обязателен"),
  properties: z.record(z.any()).refine(
    (props) => Object.keys(props).length > 0,
    { message: "Properties не могут быть пустыми" }
  )
});

// Batch запрос
export const BatchSubmitRequest = z.object({
  operations: z.array(BatchOperation)
    .min(1, "Необходима хотя бы одна операция")
    .max(500, "Слишком много операций"),
  options: z.object({
    batchSize: z.number().int().min(1).max(100).optional(),
    concurrency: z.number().int().min(1).max(5).optional(),
    rateLimitDelay: z.number().int().min(1000).max(10000).optional(),
    maxRetries: z.number().int().min(1).max(5).optional()
  }).optional().default({})
});

export default {
  PageId,
  ScoreValue,
  Comment,
  ScoreItem,
  SubmitPayload,
  AdminSignRequest,
  ReviewerTokenPayload,
  BatchOperation,
  BatchSubmitRequest
};
