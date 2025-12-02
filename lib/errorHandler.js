// lib/errorHandler.js - Centralized error handling for API routes
import { NextResponse } from "next/server";
import { logger, sanitizeForLog } from "./logger";

/**
 * Standard API error class with status code and details
 */
export class APIError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Common error types as factory functions
 */
export const Errors = {
  BadRequest: (message = "Некорректный запрос", details = null) =>
    new APIError(message, 400, details),

  Unauthorized: (message = "Требуется авторизация", details = null) =>
    new APIError(message, 401, details),

  Forbidden: (message = "Доступ запрещён", details = null) =>
    new APIError(message, 403, details),

  NotFound: (message = "Ресурс не найден", details = null) =>
    new APIError(message, 404, details),

  TooManyRequests: (message = "Слишком много запросов", details = null) =>
    new APIError(message, 429, details),

  InternalServer: (message = "Внутренняя ошибка сервера", details = null) =>
    new APIError(message, 500, details),

  ServiceUnavailable: (message = "Сервис временно недоступен", details = null) =>
    new APIError(message, 503, details),
};

/**
 * Error classifier - determines error type and appropriate response
 */
function classifyError(error) {
  // Notion API errors
  if (error?.status === 429 || error?.code === 'rate_limited') {
    return {
      status: 429,
      message: "Превышен лимит запросов к Notion API",
      details: "Попробуйте через минуту",
      retryAfter: error.headers?.['retry-after'] || 60
    };
  }

  if (error?.status === 401 || error?.status === 403) {
    return {
      status: 403,
      message: "Ошибка доступа к Notion API",
      details: "Проверьте токен и права доступа"
    };
  }

  if (error?.status >= 500 && error?.status < 600) {
    return {
      status: 503,
      message: "Сервис Notion временно недоступен",
      details: "Попробуйте позже"
    };
  }

  // Environment/configuration errors
  if (error.message?.includes('Missing environment variables') ||
      error.message?.includes('NOTION_TOKEN') ||
      error.message?.includes('JWT_SECRET')) {
    return {
      status: 500,
      message: "Ошибка конфигурации сервера",
      details: process.env.NODE_ENV === 'development' ? error.message : "Обратитесь к администратору"
    };
  }

  // Validation errors (from Zod or manual validation)
  if (error.name === 'ZodError' || error.issues) {
    return {
      status: 400,
      message: "Ошибка валидации данных",
      details: error.issues?.map(i => `${i.path.join('.')}: ${i.message}`).join("; ") || error.message
    };
  }

  // JWT/Token errors
  if (error.message?.includes('token') || error.message?.includes('JWT')) {
    return {
      status: 401,
      message: "Недействительный или истёкший токен",
      details: "Запросите новую ссылку у администратора"
    };
  }

  // Custom APIError
  if (error instanceof APIError) {
    return {
      status: error.statusCode,
      message: error.message,
      details: error.details
    };
  }

  // JavaScript errors
  if (error instanceof TypeError || error instanceof ReferenceError) {
    return {
      status: 500,
      message: process.env.NODE_ENV === 'development'
        ? `Ошибка кода: ${error.message}`
        : "Внутренняя ошибка сервера",
      details: process.env.NODE_ENV === 'development' ? {
        type: error.constructor.name,
        stack: error.stack?.split('\n').slice(0, 3).join('\n')
      } : undefined
    };
  }

  // Default error
  return {
    status: error.statusCode || error.status || 500,
    message: error.message || "Внутренняя ошибка сервера",
    details: error.details || undefined
  };
}

/**
 * Main error handler - converts errors to NextResponse
 * @param {Error} error - The error to handle
 * @param {Object} context - Additional context (request info, operation name, etc.)
 * @returns {NextResponse} - Formatted error response
 */
export function handleApiError(error, context = {}) {
  const { operation, request, additionalInfo } = context;

  // Log the error
  const logContext = {
    ...sanitizeForLog(additionalInfo || {}),
    operation,
    timestamp: new Date().toISOString()
  };

  logger.error(`[API ERROR] ${error.message}`, logContext);

  // Classify and format error
  const errorInfo = classifyError(error);

  // Build response
  const responseBody = {
    error: errorInfo.message,
    ...(errorInfo.details && { details: errorInfo.details }),
    ...(errorInfo.retryAfter && { retryAfter: errorInfo.retryAfter }),
    timestamp: new Date().toISOString()
  };

  // Add debug info in development
  if (process.env.NODE_ENV === 'development') {
    responseBody.debug = {
      originalError: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      type: error.constructor.name,
      ...logContext
    };
  }

  // Build headers
  const headers = {};
  if (errorInfo.retryAfter) {
    headers['Retry-After'] = errorInfo.retryAfter.toString();
  }

  return NextResponse.json(responseBody, {
    status: errorInfo.status,
    headers
  });
}

/**
 * Async error wrapper for API route handlers
 * Automatically catches and handles errors
 *
 * Usage:
 * export const POST = withErrorHandler(async (req) => {
 *   // Your handler code
 *   return NextResponse.json({ success: true });
 * }, { operation: 'create-user' });
 */
export function withErrorHandler(handler, context = {}) {
  return async (req, routeContext) => {
    try {
      return await handler(req, routeContext);
    } catch (error) {
      return handleApiError(error, {
        ...context,
        request: {
          method: req.method,
          url: req.url,
          headers: Object.fromEntries(req.headers.entries())
        }
      });
    }
  };
}

/**
 * Validation helper - throws APIError if condition fails
 */
export function assert(condition, message, statusCode = 400, details = null) {
  if (!condition) {
    throw new APIError(message, statusCode, details);
  }
}

/**
 * Require parameter helper
 */
export function requireParam(value, paramName, details = null) {
  assert(
    value !== null && value !== undefined && value !== '',
    `Отсутствует обязательный параметр: ${paramName}`,
    400,
    details
  );
  return value;
}

export default {
  handleApiError,
  withErrorHandler,
  APIError,
  Errors,
  assert,
  requireParam
};
