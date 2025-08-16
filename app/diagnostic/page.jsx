"use client";

import { useState } from "react";

export default function DiagnosticPage() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [teamName, setTeamName] = useState("");

  const runFullDiagnostic = async () => {
    setLoading(true);
    setResults(null);

    try {
      console.log('Running diagnostic tests...');
      
      const tests = [];
      
      // Test 1: Basic API health
      try {
        const healthRes = await fetch('/api/test');
        const healthData = await healthRes.json();
        tests.push({
          name: 'Basic API Health',
          status: healthRes.ok ? 'pass' : 'fail',
          data: healthData
        });
      } catch (error) {
        tests.push({
          name: 'Basic API Health',
          status: 'fail',
          error: error.message
        });
      }

      // Test 2: Environment check
      try {
        const envRes = await fetch('/api/debug');
        const envData = await envRes.json();
        tests.push({
          name: 'Environment Variables',
          status: envRes.ok ? 'pass' : 'fail',
          data: envData
        });
      } catch (error) {
        tests.push({
          name: 'Environment Variables',
          status: 'fail',
          error: error.message
        });
      }

      // Test 3: Admin health check
      try {
        const adminRes = await fetch('/api/admin/health');
        const adminData = await adminRes.json();
        tests.push({
          name: 'Admin Health Check',
          status: adminRes.ok && adminData.allConfigured ? 'pass' : 'fail',
          data: adminData
        });
      } catch (error) {
        tests.push({
          name: 'Admin Health Check',
          status: 'fail',
          error: error.message
        });
      }

      setResults({ tests, timestamp: new Date().toISOString() });

    } catch (error) {
      setResults({
        error: error.message,
        timestamp: new Date().toISOString()
      });
    } finally {
      setLoading(false);
    }
  };

  const testTeamSearch = async () => {
    if (!teamName.trim()) {
      alert('Введите название команды');
      return;
    }

    setLoading(true);
    
    try {
      const adminKey = prompt('Введите admin key:');
      if (!adminKey) return;

      const res = await fetch('/api/admin/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamName: teamName.trim(), adminKey })
      });

      const data = await res.json();
      
      setResults({
        teamSearch: {
          status: res.ok ? 'pass' : 'fail',
          data,
          teamName: teamName.trim()
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      setResults({
        teamSearch: {
          status: 'fail',
          error: error.message,
          teamName: teamName.trim()
        },
        timestamp: new Date().toISOString()
      });
    } finally {
      setLoading(false);
    }
  };

  const testSkillLoading = async () => {
    const skillId = prompt('Введите ID навыка для тестирования (из результатов диагностики):');
    if (!skillId) return;

    setLoading(true);
    
    try {
      const res = await fetch('/api/debug/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId: skillId.trim() })
      });

      const data = await res.json();
      
      setResults({
        skillTest: {
          status: res.ok ? 'pass' : 'fail',
          data,
          skillId: skillId.trim()
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      setResults({
        skillTest: {
          status: 'fail',
          error: error.message,
          skillId: skillId.trim()
        },
        timestamp: new Date().toISOString()
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pass': return '#28a745';
      case 'fail': return '#dc3545';
      default: return '#6c757d';
    }
  };

  return (
    <main style={{
      padding: 24,
      maxWidth: 1200,
      margin: '0 auto',
      fontFamily: 'system-ui, sans-serif'
    }}>
      <h1 style={{ marginBottom: 24, color: '#2c3e50' }}>
        🔍 Диагностика системы
      </h1>
      
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 16 }}>Тесты системы</h2>
        
        <button
          onClick={runFullDiagnostic}
          disabled={loading}
          style={{
            padding: '12px 20px',
            background: loading ? '#6c757d' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 14,
            fontWeight: 600,
            marginRight: 12,
            marginBottom: 12,
            opacity: loading ? 0.7 : 1
          }}
          <button
            onClick={testSkillLoading}
            disabled={loading}
            style={{
              padding: '12px 20px',
              background: loading ? '#6c757d' : '#17a2b8',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 14,
              fontWeight: 600,
              marginRight: 12,
              marginBottom: 12,
              opacity: loading ? 0.7 : 1
            }}
          >
            🎯 Тест загрузки навыка
          </button>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
          <input
            type="text"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Введите название команды"
            style={{
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: 4,
              fontSize: 14,
              width: 200
            }}
          />
          <button
            onClick={testTeamSearch}
            disabled={loading || !teamName.trim()}
            style={{
              padding: '12px 20px',
              background: loading || !teamName.trim() ? '#6c757d' : '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: loading || !teamName.trim() ? 'not-allowed' : 'pointer',
              fontSize: 14,
              fontWeight: 600
            }}
          >
            🔍 Тест поиска команды
          </button>
        </div>
      </div>

      {results && (
        <div style={{
          background: '#f8f9fa',
          border: '1px solid #e9ecef',
          borderRadius: 8,
          padding: 20
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20
          }}>
            <h3 style={{ margin: 0, fontSize: 18 }}>Результаты диагностики</h3>
            <span style={{ fontSize: 12, color: '#6c757d' }}>
              {new Date(results.timestamp).toLocaleString()}
            </span>
          </div>

          {results.error && (
            <div style={{
              background: '#f8d7da',
              color: '#721c24',
              padding: 12,
              borderRadius: 4,
              marginBottom: 16,
              border: '1px solid #f5c6cb'
            }}>
              <strong>Ошибка:</strong> {results.error}
            </div>
          )}

          {results.tests && (
            <div>
              <h4 style={{ marginBottom: 16 }}>Системные тесты:</h4>
              {results.tests.map((test, index) => (
                <div
                  key={index}
                  style={{
                    background: 'white',
                    border: '1px solid #dee2e6',
                    borderRadius: 6,
                    padding: 16,
                    marginBottom: 12
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: 8
                  }}>
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        background: getStatusColor(test.status),
                        marginRight: 8
                      }}
                    />
                    <strong>{test.name}</strong>
                    <span style={{
                      marginLeft: 'auto',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      background: test.status === 'pass' ? '#d4edda' : '#f8d7da',
                      color: test.status === 'pass' ? '#155724' : '#721c24'
                    }}>
                      {test.status === 'pass' ? 'ПРОШЕЛ' : 'ПРОВАЛЕН'}
                    </span>
                  </div>
                  
                  {test.error && (
                    <div style={{
                      background: '#fff3cd',
                      border: '1px solid #ffeaa7',
                      padding: 8,
                      borderRadius: 4,
                      fontSize: 12,
                      color: '#856404',
                      marginBottom: 8
                    }}>
                      Ошибка: {test.error}
                    </div>
                  )}
                  
                  {test.data && (
                    <details style={{ fontSize: 12 }}>
                      <summary style={{ cursor: 'pointer', marginBottom: 8 }}>
                        Детали
                      </summary>
                      <pre style={{
                        background: '#f1f3f4',
                        padding: 8,
                        borderRadius: 4,
                        overflow: 'auto',
                        fontSize: 11,
                        lineHeight: 1.4
                      }}>
                        {JSON.stringify(test.data, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}

          {results.teamSearch && (
            <div>
              <h4 style={{ marginBottom: 16 }}>
                Тест поиска команды "{results.teamSearch.teamName}":
              </h4>
              <div style={{
                background: 'white',
                border: '1px solid #dee2e6',
                borderRadius: 6,
                padding: 16
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginBottom: 8
                }}>
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: getStatusColor(results.teamSearch.status),
                      marginRight: 8
                    }}
                  />
                  <strong>Поиск команды</strong>
                  <span style={{
                    marginLeft: 'auto',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    background: results.teamSearch.status === 'pass' ? '#d4edda' : '#f8d7da',
                    color: results.teamSearch.status === 'pass' ? '#155724' : '#721c24'
                  }}>
                    {results.teamSearch.status === 'pass' ? 'НАЙДЕНО' : 'НЕ НАЙДЕНО'}
                  </span>
                </div>
                
                {results.teamSearch.error && (
                  <div style={{
                    background: '#fff3cd',
                    border: '1px solid #ffeaa7',
                    padding: 8,
                    borderRadius: 4,
                    fontSize: 12,
                    color: '#856404',
                    marginBottom: 8
                  }}>
                    Ошибка: {results.teamSearch.error}
                  </div>
                )}
                
                {results.teamSearch.data && (
                  <details style={{ fontSize: 12 }}>
                    <summary style={{ cursor: 'pointer', marginBottom: 8 }}>
                      Результаты поиска
                    </summary>
                    <pre style={{
                      background: '#f1f3f4',
                      padding: 8,
                      borderRadius: 4,
                      overflow: 'auto',
                      fontSize: 11,
                      lineHeight: 1.4
                    }}>
                      {JSON.stringify(results.teamSearch.data, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          {results.skillTest && (
            <div>
              <h4 style={{ marginBottom: 16 }}>
                Тест навыка "{results.skillTest.skillId}":
              </h4>
              <div style={{
                background: 'white',
                border: '1px solid #dee2e6',
                borderRadius: 6,
                padding: 16
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginBottom: 8
                }}>
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: getStatusColor(results.skillTest.status),
                      marginRight: 8
                    }}
                  />
                  <strong>Загрузка навыка</strong>
                  <span style={{
                    marginLeft: 'auto',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    background: results.skillTest.status === 'pass' ? '#d4edda' : '#f8d7da',
                    color: results.skillTest.status === 'pass' ? '#155724' : '#721c24'
                  }}>
                    {results.skillTest.status === 'pass' ? 'УСПЕШНО' : 'ОШИБКА'}
                  </span>
                </div>
                
                {results.skillTest.error && (
                  <div style={{
                    background: '#fff3cd',
                    border: '1px solid #ffeaa7',
                    padding: 8,
                    borderRadius: 4,
                    fontSize: 12,
                    color: '#856404',
                    marginBottom: 8
                  }}>
                    Ошибка: {results.skillTest.error}
                  </div>
                )}
                
                {results.skillTest.data && (
                  <details style={{ fontSize: 12 }}>
                    <summary style={{ cursor: 'pointer', marginBottom: 8 }}>
                      Детали тестирования навыка
                    </summary>
                    <pre style={{
                      background: '#f1f3f4',
                      padding: 8,
                      borderRadius: 4,
                      overflow: 'auto',
                      fontSize: 11,
                      lineHeight: 1.4
                    }}>
                      {JSON.stringify(results.skillTest.data, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{
        marginTop: 32,
        padding: 16,
        background: '#e7f3ff',
        border: '1px solid #b8daff',
        borderRadius: 6,
        fontSize: 14
      }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 16 }}>💡 Руководство по диагностике</h4>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li><strong>Полная диагностика</strong> - проверяет все основные системы</li>
          <li><strong>Тест поиска команды</strong> - проверяет подключение к Notion и поиск сотрудников</li>
          <li>Зеленый статус = все работает</li>
          <li>Красный статус = есть проблемы, проверьте детали</li>
          <li>Если все тесты провалены - проверьте переменные окружения</li>
        </ul>
      </div>

      <div style={{ marginTop: 24, textAlign: 'center' }}>
        <a 
          href="/admin" 
          style={{
            color: '#007bff',
            textDecoration: 'none',
            fontSize: 14
          }}
        >
          ← Вернуться к админ-панели
        </a>
      </div>
    </main>
  );
}