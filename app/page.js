export default function Home() {
  return (
    <main style={{ 
      padding: 32, 
      maxWidth: 800, 
      margin: '0 auto',
      fontFamily: 'system-ui, sans-serif'
    }}>
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <h1 style={{ 
          fontSize: 36, 
          color: '#2c3e50',
          marginBottom: 16,
          fontWeight: 700
        }}>
          📊 Notion Skill Review
        </h1>
        <p style={{ 
          fontSize: 18, 
          color: '#6c757d',
          lineHeight: 1.6
        }}>
          Система оценки компетенций сотрудников через Notion API
        </p>
      </div>

      <div style={{
        display: 'grid',
        gap: 24,
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))'
      }}>
        {/* Админ-панель */}
        <div style={{
          background: '#f8f9fa',
          border: '1px solid #e9ecef',
          borderRadius: 12,
          padding: 24,
          textAlign: 'center'
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🛠️</div>
          <h2 style={{ fontSize: 20, marginBottom: 12, color: '#495057' }}>
            Админ-панель
          </h2>
          <p style={{ 
            color: '#6c757d', 
            marginBottom: 20,
            lineHeight: 1.5
          }}>
            Генерация персональных ссылок для оценки компетенций сотрудников
          </p>
          <a 
            href="/admin" 
            style={{
              display: 'inline-block',
              padding: '12px 24px',
              background: '#007bff',
              color: 'white',
              textDecoration: 'none',
              borderRadius: 8,
              fontWeight: 600,
              transition: 'background-color 0.2s ease'
            }}
          >
            Открыть админ-панель
          </a>
        </div>
      </div>

      {/* Информационная секция */}
      <div style={{
        marginTop: 48,
        padding: 24,
        background: '#e7f3ff',
        border: '1px solid #b8daff',
        borderRadius: 12
      }}>
        <h3 style={{ 
          fontSize: 18, 
          marginBottom: 16, 
          color: '#004085',
          fontWeight: 600
        }}>
          ℹ️ Как это работает
        </h3>
        <div style={{ 
          color: '#004085', 
          lineHeight: 1.6,
          fontSize: 14
        }}>
          <p style={{ marginBottom: 12 }}>
            <strong>1. Генерация ссылок:</strong> Администратор создает персональные ссылки для оценки компетенций команды
          </p>
          <p style={{ marginBottom: 12 }}>
            <strong>2. Оценка навыков:</strong> Сотрудники переходят по своим ссылкам и оценивают компетенции коллег
          </p>
          <p style={{ marginBottom: 12 }}>
            <strong>3. Сохранение в Notion:</strong> Все оценки автоматически сохраняются в базу данных Notion
          </p>
          <p style={{ margin: 0 }}>
            <strong>Формат ссылок:</strong> <code style={{ 
              background: 'rgba(0,0,0,0.1)', 
              padding: '2px 6px', 
              borderRadius: 4,
              fontSize: 13
            }}>
              /form/&lt;зашифрованный-токен&gt;
            </code>
          </p>
        </div>
      </div>

      {/* Статус системы */}
      <div style={{
        marginTop: 24,
        padding: 16,
        background: '#d4edda',
        border: '1px solid #c3e6cb',
        borderRadius: 8,
        fontSize: 14,
        color: '#155724'
      }}>
        <strong>✅ Готово к работе:</strong> Система настроена и готова к использованию. Используйте админ-панель для создания ссылок оценки.
      </div>
    </main>
  );
}