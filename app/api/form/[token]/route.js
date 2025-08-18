// Используем Edge Runtime для совместимости с Cloudflare Pages 
export const runtime = 'edge'; 

/**
 * Трансформирует данные от Notion API в простой формат для фронтенда
 */
function transformNotionPage(page) {
  const properties = page.properties;
  const transformed = {
    id: page.id,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time
  };

  // Обрабатываем различные типы свойств Notion
  Object.entries(properties).forEach(([key, property]) => {
    switch (property.type) {
      case 'title':
        transformed[key] = property.title?.[0]?.plain_text || '';
        break;
      case 'rich_text':
        transformed[key] = property.rich_text
          .map(text => text.plain_text)
          .join('');
        break;
      case 'multi_select':
        transformed[key] = property.multi_select.map(option => option.name);
        break;
      case 'select':
        transformed[key] = property.select?.name || null;
        break;
      case 'status':
        transformed[key] = property.status?.name || null;
        break;
      case 'number':
        transformed[key] = property.number;
        break;
      case 'checkbox':
        transformed[key] = property.checkbox;
        break;
      case 'relation':
        transformed[key] = property.relation.map(rel => rel.id);
        break;
      case 'people':
        transformed[key] = property.people.map(person => ({
          id: person.id,
          name: person.name,
          avatar_url: person.avatar_url
        }));
        break;
      default:
        transformed[key] = property[property.type];
    }
  });

  return transformed;
}

/**
 * Стандартизированный формат ответов API
 */
class ApiResponse {
  static success(data, meta = {}) {
    return {
      success: true,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        ...meta
      }
    };
  }

  static error(message, code = 'UNKNOWN_ERROR', details = null) {
    return {
      success: false,
      error: {
        message,
        code,
        details,
        timestamp: new Date().toISOString()
      }
    };
  }
}

/**
 * Обработчик ошибок Notion API
 */
function handleNotionAPIError(error, req) {
  console.error('Notion API Error:', error);
  
  const errorResponse = {
    error: true,
    timestamp: new Date().toISOString(),
    path: new URL(req.url).pathname
  };

  // Специфичные ошибки Notion API
  if (error.status === 404) {
    return new Response(JSON.stringify(ApiResponse.error(
      'База данных или страница не найдена',
      'NOT_FOUND'
    )), { 
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (error.status === 401) {
    return new Response(JSON.stringify(ApiResponse.error(
      'Неверный токен API или недостаточно прав доступа',
      'UNAUTHORIZED'
    )), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (error.status === 429) {
    return new Response(JSON.stringify(ApiResponse.error(
      'Превышен лимит запросов',
      'RATE_LIMITED',
      { retryAfter: 60 }
    )), { 
      status: 429,
      headers: { 
        'Content-Type': 'application/json',
        'Retry-After': '60'
      }
    });
  }

  // Общая ошибка
  return new Response(JSON.stringify(ApiResponse.error(
    'Внутренняя ошибка сервера',
    'INTERNAL_ERROR'
  )), { 
    status: 500,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Получает все данные из Notion базы с пагинацией
 */
async function getAllNotionData(databaseId, pageSize = 100) {
  const allResults = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    try {
      const query = {
        page_size: Math.min(pageSize, 100), // Максимум 100 в Notion API
        filter: {
          property: 'Активен', // Фильтр только активных навыков
          checkbox: { equals: true }
        },
        sorts: [
          {
            property: 'Название',
            direction: 'ascending'
          }
        ]
      };
      
      if (cursor) {
        query.start_cursor = cursor;
      }

      // Используем fetch API вместо Notion SDK для совместимости с Edge Runtime 
      const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(query)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`HTTP ${response.status}: ${errorData.message || 'Unknown error'}`);
      }

      const data = await response.json();
      allResults.push(...data.results);
      
      hasMore = data.has_more;
      cursor = data.next_cursor;
      
    } catch (error) {
      console.error('Ошибка при получении данных от Notion:', error);
      break; // Прерываем цикл при ошибке
    }
  }

  // Трансформируем данные для фронтенда
  return allResults.map(transformNotionPage);
}

/**
 * GET обработчик для загрузки навыков
 */
export async function GET(req, { params }) {
  const { token } = params;
  const { searchParams } = new URL(req.url);
  
  try {
    // Валидация токена
    if (!token || typeof token !== 'string') {
      return new Response(JSON.stringify(ApiResponse.error(
        'Токен обязателен',
        'INVALID_TOKEN'
      )), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Валидация переменных окружения
    if (!process.env.NOTION_TOKEN || !process.env.NOTION_DATABASE_ID) {
      console.error('Отсутствуют переменные окружения NOTION_TOKEN или NOTION_DATABASE_ID');
      return new Response(JSON.stringify(ApiResponse.error(
        'Конфигурация сервера неполная',
        'SERVER_CONFIG_ERROR'
      )), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Здесь можно добавить валидацию токена против базы данных пользователей
    // const isValidToken = await validateUserToken(token);
    // if (!isValidToken) { ... }

    console.log(`Загрузка навыков для токена: ${token}`); 

    // Получаем данные от Notion API
    const skillsData = await getAllNotionData(process.env.NOTION_DATABASE_ID);
    
    console.log(`Успешно загружено ${skillsData.length} навыков`); 

    // Возвращаем структурированный ответ
    return new Response(JSON.stringify(ApiResponse.success(skillsData, {
      count: skillsData.length,
      token: token
    })), {
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300', // Кэшируем на 5 минут
        // CORS заголовки для Cloudflare Pages 
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });

  } catch (error) {
    console.error('Критическая ошибка в API endpoint:', error);
    
    return handleNotionAPIError(error, req);
  }
}

/**
 * OPTIONS обработчик для CORS preflight запросов
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}