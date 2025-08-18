"use client";

import { useState } from "react";

export default function DiagnosticPage() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [teamName, setTeamName] = useState("");
  const [testToken, setTestToken] = useState("");

  const runFullDiagnostic = async () => {
    setLoading(true);
    setResults(null);

    try {
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
          name: 'Admin Configuration',
          status: adminRes.ok && adminData.allConfigured ? 'pass' : 'fail',
          data: adminData
        });
      } catch (error) {
        tests.push({
          name: 'Admin Configuration',
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

  const testFormToken = async () => {
    if (!testToken.trim()) {
      alert('Введите токен для тестирования');
      return;
    }

    setLoading(true);
    
    try {
      const res = await fetch('/api/debug/form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: testToken.trim() })
      });

      const data = await res.json();
      
      setResults({
        formTest: {
          status: res.ok ? 'pass' : 'fail',
          data,
          token: testToken.substring(0, 10) + '...'
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      setResults({
        formTest: {
          status: 'fail',
          error: error.message,
          token: testToken.substring(0, 10) + '...'
        },
        timestamp: new Date().toISOString()
      });
    } finally {
      setLoading(false);
    }
  };

  const testSkillLoad = async () => {
    const skillId = prompt('Введите ID навыка для тестирования:');
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

  const getStatusIcon = (status) => {
    switch (status) {
      case 'pass': return '✅';
      case 'fail': return '❌';
      default: return '⚪';
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
        🔍 Расширенная диагностика системы
      </h1>
      
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 16 }}>Базовые тесты</h2>
        
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
            marginBottom: 12
          }}
        >
          {loading ? 'Выполняется...' : '🏥 Полная диагностика'}
        </button>
      </div>

      {/* Тест поиска команды */}
      <div style={{ marginBottom: 24, padding: 16, border: '1px solid #e9ecef', borderRadius: 8 }}>
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>🔍 Тест поиска команды</h3>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
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
              padding: '8px 16px',
              background: loading || !teamName.trim() ? '#6c757d' : '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: loading || !teamName.trim() ? 'not-allowed' : 'pointer',
              fontSize: 14
            }}
          >
            Тестировать поиск
          </button>
        </div>
      </div>

      {/* Тест токена формы */}
      <div style={{ marginBottom: 24, padding: 16, border: '1px solid #e9ecef', borderRadius: 8 }}>
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>🎯 Тест токена формы</h3>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={testToken}
            onChange={(e) => setTestToken(e.target.value)}
            placeholder="Введите токен для тестирования"
            style={{
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: 4,
              fontSize: 14,
              width: 300,
              fontFamily: 'monospace',
              fontSize: 12
            }}
          />
          <button
            onClick={testFormToken}
            disabled={loading || !testToken.trim()}
            style={{
              padding: '8px 16px',
              background: loading || !testToken.trim() ? '#6c757d' : '#17a2b8',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: loading || !testToken.trim() ? 'not-allowed' : 'pointer',
              fontSize: 14
            }}
          >
            Тестировать токен
          </button>
        </div>
      </div>

      {/* Тест загрузки навыка */}
      <div style={{ marginBottom: 32, padding: 16, border: '1px solid #e9ecef', borderRadius: 8 }}>
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>📋 Тест загрузки навыка</h3>
        <button
          onClick={testSkillLoad}
          disabled={loading}
          style={{
            padding: '8px 16px',
            background: loading ? '#6c757d' : '#ffc107',
            color: loading ? 'white' : '#212529',
            border: 'none',
            borderRadius: 4,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 14
          }}
        >
          Тестировать навык
        </button>
      </div>

      {results && (
        <div style={{
          background: '#f8f9fa',
          border: '1px solid #e9ecef',
          borderRadius: 8,
          padding: 20
        }}>
          <h3 style={{ margin: 0, marginBottom: 20, fontSize: 18 }}>
            📊 Результаты диагностики
          </h3>

          {results.error && (
            <div style={{
              background: '#f8d7da',
              color: '#721c24',
              padding: 12,
              borderRadius: 4,
              marginBottom: 16,
              border: '1px solid #f5c6cb'
            }}>
              <strong>Общая ошибка:</strong> {results.error}
            </div>
          )}

          {/* Базовые тесты */}
          {results.tests && results.tests.map((test, index) => (
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
                <span style={{ marginRight: 8, fontSize: 18 }}>
                  {getStatusIcon(test.status)}
                </span>
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
                    lineHeight: 1.4,
                    maxHeight: 300
                  }}>
                    {JSON.stringify(test.data, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ))}

          {/* Тест поиска команды */}
          {results.teamSearch && (
            <div style={{
              background: 'white',
              border: '1px solid #dee2e6',
              borderRadius: 6,
              padding: 16,
              marginBottom: 12
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: 8
              }}>
                <span style={{ marginRight: 8, fontSize: 18 }}>
                  {getStatusIcon(results.teamSearch.status)}
                </span>
                <strong>Поиск команды "{results.teamSearch.teamName}"</strong>
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
                    Результат поиска
                  </summary>
                  <pre style={{
                    background: '#f1f3f4',
                    padding: 8,
                    borderRadius: 4,
                    overflow: 'auto',
                    fontSize: 11,
                    lineHeight: 1.4,
                    maxHeight: 300
                  }}>
                    {JSON.stringify(results.teamSearch.data, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}

          {/* Тест токена формы */}
          {results.formTest && (
            <div style={{
              background: 'white',
              border: '1px solid #dee2e6',
              borderRadius: 6,
              padding: 16,
              marginBottom: 12
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: 8
              }}>
                <span style={{ marginRight: 8, fontSize: 18 }}>
                  {getStatusIcon(results.formTest.status)}
                </span>
                <strong>Тест токена формы ({results.formTest.token})</strong>
                <span style={{
                  marginLeft: 'auto',
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  background: results.formTest.status === 'pass' ? '#d4edda' : '#f8d7da',
                  color: results.formTest.status === 'pass' ? '#155724' : '#721c24'
                }}>
                  {results.formTest.status === 'pass' ? 'РАБОТАЕТ' : 'ОШИБКА'}
                </span>
              </div>
              
              {results.formTest.error && (
                <div style={{
                  background: '#fff3cd',
                  border: '1px solid #ffeaa7',
                  padding: 8,
                  borderRadius: 4,
                  fontSize: 12,
                  color: '#856404',
                  marginBottom: 8
                }}>
                  Ошибка: {results.formTest.error}
                </div>
              )}
              
              {results.formTest.data && (
                <details style={{ fontSize: 12 }}>
                  <summary style={{ cursor: 'pointer', marginBottom: 8 }}>
                    Диагностика токена
                  </summary>
                  <pre style={{
                    background: '#f1f3f4',
                    padding: 8,
                    borderRadius: 4,
                    overflow: 'auto',
                    fontSize: 11,
                    lineHeight: 1.4,
                    maxHeight: 400
                  }}>
                    {JSON.stringify(results.formTest.data, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}

          {/* Тест навыка */}
          {results.skillTest && (
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
                <span style={{ marginRight: 8, fontSize: 18 }}>
                  {getStatusIcon(results.skillTest.status)}
                </span>
                <strong>Тест навыка ({results.skillTest.skillId})</strong>
                <span style={{
                  marginLeft: 'auto',
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  background: results.skillTest.status === 'pass' ? '#d4edda' : '#f8d7da',
                  color: results.skillTest.status === 'pass' ? '#155724' : '#721c24'
                }}>
                  {results.skillTest.status === 'pass' ? 'ЗАГРУЖЕН' : 'ОШИБКА'}
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
                    Данные навыка
                  </summary>
                  <pre style={{
                    background: '#f1f3f4',
                    padding: 8,
                    borderRadius: 4,
                    overflow: 'auto',
                    fontSize: 11,
                    lineHeight: 1.4,
                    maxHeight: 400
                  }}>
                    {JSON.stringify(results.skillTest.data, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}

          <div style={{
            marginTop: 16,
            padding: 12,
            background: '#e9ecef',
            borderRadius: 4,
            fontSize: 12,
            color: '#495057'
          }}>
            Время выполнения: {new Date(results.timestamp).toLocaleString()}
          </div>
        </div>
      )}

      <div style={{ marginTop: 32, padding: 16, background: '#d1ecf1', borderRadius: 8 }}>
        <h4 style={{ margin: 0, marginBottom: 12, color: '#0c5460' }}>
          💡 Советы по диагностике
        </h4>
        <ul style={{ margin: 0, paddingLeft: 20, color: '#0c5460', fontSize: 14 }}>
          <li>Убедитесь, что все переменные окружения настроены в Cloudflare Pages</li>
          <li>Проверьте права доступа к базам данных Notion</li>
          <li>Для тестирования токена используйте реальную ссылку из админ-панели</li>
          <li>ID навыка можно найти в URL страницы навыка в Notion</li>
          <li>При ошибках проверьте логи в Cloudflare Pages Functions</li>
        </ul>
      </div>

      <div style={{ marginTop: 24, textAlign: 'center' }}>
        <a 
          href="/admin" 
          style={{
            color: '#007bff',
            textDecoration: 'none',
            fontSize: 14,
            marginRight: 24
          }}
        >
          ← Вернуться к админ-панели
        </a>
        <a 
          href="/" 
          style={{
            color: '#007bff',
            textDecoration: 'none',
            fontSize: 14
          }}
        >
          🏠 На главную
        </a>
      </div>
    </main>
  );
}