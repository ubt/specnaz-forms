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
        <p style={{ fontSize: 18, color: '#6c757d', lineHeight: 1.6 }}>
          Система оценки компетенций сотрудников
        </p>
      </div>

<iframe width="560" height="315" src="https://www.youtube.com/embed/PkT0PJwy8mI?si=QH5SZLRUnedZAZJk" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>

      <div style={{
        display: 'grid',
        gap: 24,
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))'
      }}>
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
          <p style={{ color: '#6c757d', marginBottom: 20, lineHeight: 1.5 }}>
            Генерация персональных ссылок для оценки
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
              fontWeight: 600
            }}
          >
            Открыть
          </a>
        </div>
      </div>

      <div style={{
        marginTop: 48,
        padding: 24,
        background: '#e7f3ff',
        border: '1px solid #b8daff',
        borderRadius: 12
      }}>
        <h3 style={{ fontSize: 18, marginBottom: 16, color: '#004085', fontWeight: 600 }}>
          ℹ️ Как это работает
        </h3>
        <div style={{ color: '#004085', lineHeight: 1.6, fontSize: 14 }}>
          <p style={{ marginBottom: 12 }}>
            <strong>1.</strong> Администратор создает ссылки для команды
          </p>
          <p style={{ marginBottom: 12 }}>
            <strong>2.</strong> Сотрудники оценивают компетенции по ссылкам
          </p>
          <p style={{ margin: 0 }}>
            <strong>3.</strong> Оценки сохраняются в Notion
          </p>
        </div>
      </div>
    </main>
  );
}
