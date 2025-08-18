"use client";

import { useState } from "react";

export default function EnhancedDiagnosticPage() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [teamName, setTeamName] = useState("");
  const [testToken, setTestToken] = useState("");

  const runFullDiagnostic = async () => {
    setLoading(true);
    setResults(null);

    try {
      const tests = [];
      
      console.log('[DIAGNOSTIC] Запуск полной диагностики системы...');

      // Test 1: Basic API health
      try {
        console.log('[DIAGNOSTIC] Тест 1: Проверка базового API...');
        const healthRes = await fetch('/api/test');
        const healthData = await healthRes.json();
        tests.push({
          name: 'Базовое API',
          status: healthRes.ok ? 'pass' : 'fail',
          data: healthData,
          description: 'Проверка работоспособности базового API'
        });
      } catch (error) {
        tests.push({
          name: 'Базовое API',
          status: 'fail',
          error: error.message,
          description: 'Базовое API недоступно'
        });
      }

      // Test 2: Environment check
      try {
        console.log('[DIAGNOSTIC] Тест 2: Проверка переменных окружения...');
        const envRes = await fetch('/api/debug');
        const envData = await envRes.json();
        tests.push({
          name: 'Переменные окружения',
          status: envRes.ok ? 'pass' : 'fail',
          data: envData,
          description: 'Проверка настройки переменных окружения'
        });
      } catch (error) {
        tests.push({
          name: 'Переменные окружения',
          status: 'fail',
          error: error.message,
          description: 'Ошибка проверки переменных окружения'
        });
      }

      // Test 3: Admin health check
      try {
        console.log('[DIAGNOSTIC] Тест 3: Проверка конфигурации администратора...');
        const adminRes = await fetch('/api/admin/health');
        const adminData = await adminRes.json();
        tests.push({
          name: 'Конфигурация админа',
          status: adminRes.ok && adminData.allConfigured ? 'pass' : 'fail',
          data: adminData,
          description: 'Проверка настроек административных функций'
        });
      } catch (error) {
        tests.push({
          name: 'Конфигурация админа',
          status: 'fail',
          error: error.message,
          description: 'Ошибка проверки админ-конфигурации'
        });
      }

      // Test 4: Database structure check
      try {
        console.log('[DIAGNOSTIC] Тест 4: Проверка структуры баз данных...');
        const structureRes = await fetch('/api/debug/check-structure');
        const structureData = await structureRes.json();
        tests.push({
          name: 'Структура БД',
          status: structureRes.ok && structureData.summary?.matrixOk && structureData.summary?.employeesOk ? 'pass' : 'fail',
          data: structureData,
          description: 'Проверка структуры баз данных Notion'
        });
      } catch (error) {
        tests.push({
          name: 'Структура БД',
          status: 'fail',
          error: error.message,
          description: 'Ошибка проверки структуры базы данных'
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

      console.log('[DIAGNOSTIC] Тестирование поиска команды:', teamName);

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
          teamName: teamName.trim(),
          description: res.ok ? 'Команда найдена в базе данных' : 'Команда не найдена'
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      setResults({
        teamSearch: {
          status: 'fail',
          error: error.message,
          teamName: teamName.trim(),
          description: 'Ошибка поиска команды'
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
      console.log('[DIAGNOSTIC] Тестирование токена формы:', testToken.substring(0, 10) + '...');

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
          token: testToken.substring(0, 10) + '...',
          description: res.ok ? 'Токен валиден и система готова к работе' : 'Проблемы с токеном или настройками'
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      setResults({
        formTest: {
          status: 'fail',
          error: error.message,
          token: testToken.substring(0, 10) + '...',
          description: 'Ошибка тестирования токена'
        },
        timestamp: new Date().toISOString()
      });
    } finally {
      setLoading(false);
    }
  };

  const testActualFormLoad = async () => {
    if (!testToken.trim()) {
      alert('Сначала введите токен в поле выше');
      return;
    }

    setLoading(true);
    
    try {
      console.log('[DIAGNOSTIC] Тестирование реальной загрузки формы...');

      // Тестируем реальный API endpoint формы
      const res = await fetch(`/api/form/${testToken.trim()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await res.json();
      
      setResults({
        realFormTest: {
          status: res.ok ? 'pass' : 'fail',
          data,
          token: testToken.substring(0, 10) + '...',
          description: res.ok ? `Форма загрузилась успешно. Найдено ${data.rows?.length || 0} навыков для оценки` : 'Ошибка загрузки формы'
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      setResults({
        realFormTest: {
          status: 'fail',
          error: error.message,
          token: testToken.substring(0, 10) + '...',
          description: 'Критическая ошибка загрузки формы'
        },
        timestamp: new Date().toISOString()
      });
    } finally {
      setLoading(false);
    }
  };

  const generateTestLink = async () => {
    if (!teamName.trim()) {
      alert('Сначала введите название команды');
      return;
    }

    setLoading(true);

    try {
      const adminKey = prompt('Введите admin key для генерации тестовой ссылки:');
      if (!adminKey) return;

      console.log('[DIAGNOSTIC] Генерация тестовых ссылок для команды:', teamName);

      const res = await fetch('/api/admin/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          teamName: teamName.trim(), 
          adminKey,
          expDays: 1 // Короткий срок для тестирования
        })
      });

      const data = await res.json();
      
      if (res.ok && data.links?.length > 0) {
        // Берем первую ссылку для тестирования
        const testLink = data.links[0];
        const tokenMatch = testLink.url.match(/\/form\/(.+)$/);
        if (tokenMatch) {
          setTestToken(tokenMatch[1]);
        }
        
        setResults({
          linkGeneration: {
            status: 'pass',
            data: {
              ...data,
              testLink: testLink.url,
              testToken: tokenMatch ? tokenMatch[1].substring(0, 20) + '...' : 'не найден'
            },
            description: `Сгенерировано ${data.links.length} ссылок. Первая ссылка скопирована в поле токена для тестирования.`
          },
          timestamp: new Date().toISOString()
        });
      } else {
        setResults({
          linkGeneration: {
            status: 'fail',
            data,
            description: 'Не удалось сгенерировать ссылки'
          },
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      setResults({
        linkGeneration: {
          status: 'fail',
          error: error.message,
          description: 'Ошибка генерации ссылок'
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
      fontFamily: 'system-ui, sans-serif',
      minHeight: '100vh',
      backgroundColor: '#f8f9fa'
    }}>
      <div style={{
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 32,
        marginBottom: 24,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        border: '1px solid #e1e5e9'
      }}>
        <h1 style={{ 
          marginBottom: 16, 
          color: '#2c3e50',
          fontSize: 28,
          fontWeight: 700,
          margin: 0
        }}>
          🔍 Расширенная диагностика системы
        </h1>
        <p style={{
          color: '#6c757d',
          fontSize: 16,
          lineHeight: 1.6,
          margin: '12px 0 0 0'
        }}>
          Комплексная проверка всех компонентов системы оценки компетенций
        </p>
      </div>
      
      {/* Секция базовой диагностики */}
      <div style={{
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 24,
        marginBottom: 24,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        border: '1px solid #e1e5e9'
      }}>
        <h2 style={{ fontSize: 20, marginBottom: 16, color: '#2c3e50', fontWeight: 600 }}>
          🏥 Базовая диагностика
        </h2>
        
        <button
          onClick={runFullDiagnostic}
          disabled={loading}
          style={{
            padding: '12px 24px',
            background: loading ? '#6c757d' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 14,
            fontWeight: 600,
            transition: 'background-color 0.2s ease'
          }}
          onMouseEnter={(e) => !loading && (e.target.style.backgroundColor = '#0056b3')}
          onMouseLeave={(e) => !loading && (e.target.style.backgroundColor = '#007bff')}
        >
          {loading ? '⏳ Выполняется диагностика...' : '🔄 Запустить полную диагностику'}
        </button>
        
        <p style={{
          fontSize: 14,
          color: '#6c757d',
          marginTop: 8,
          margin: '8px 0 0 0'
        }}>
          Проверяет API, переменные окружения, конфигурацию и структуру баз данных
        </p>
      </div>

      {/* Секция тестирования команды */}
      <div style={{
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 24,
        marginBottom: 24,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        border: '1px solid #e1e5e9'
      }}>
        <h3 style={{ marginBottom: 16, fontSize: 18, color: '#2c3e50', fontWeight: 600 }}>
          🔍 Тест поиска команды и генерация ссылок
        </h3>
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Введите название команды"
              style={{
                padding: '10px 12px',
                border: '1px solid #ddd',
                borderRadius: 6,
                fontSize: 14,
                width: 250,
                fontFamily: 'inherit'
              }}
            />
            <button
              onClick={testTeamSearch}
              disabled={loading || !teamName.trim()}
              style={{
                padding: '10px 16px',
                background: loading || !teamName.trim() ? '#6c757d' : '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: loading || !teamName.trim() ? 'not-allowed' : 'pointer',
                fontSize: 14,
                fontWeight: 500
              }}
            >
              🔍 Найти команду
            </button>
            <button
              onClick={generateTestLink}
              disabled={loading || !teamName.trim()}
              style={{
                padding: '10px 16px',
                background: loading || !teamName.trim() ? '#6c757d' : '#ffc107',
                color: loading || !teamName.trim() ? 'white' : '#212529',
                border: 'none',
                borderRadius: 6,
                cursor: loading || !teamName.trim() ? 'not-allowed' : 'pointer',
                fontSize: 14,
                fontWeight: 500
              }}
            >
              🔗 Сгенерировать ссылки
            </button>
          </div>
          <p style={{ fontSize: 12, color: '#6c757d', margin: 0 }}>
            Сначала найдите команду, затем сгенерируйте тестовые ссылки для проверки работы формы
          </p>
        </div>
      </div>

      {/* Секция тестирования токена */}
      <div style={{
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 24,
        marginBottom: 24,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        border: '1px solid #e1e5e9'
      }}>
        <h3 style={{ marginBottom: 16, fontSize: 18, color: '#2c3e50', fontWeight: 600 }}>
          🎯 Тестирование формы оценки
        </h3>
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={testToken}
              onChange={(e) => setTestToken(e.target.value)}
              placeholder="Введите токен для тестирования или сгенерируйте выше"
              style={{
                padding: '10px 12px',
                border: '1px solid #ddd',
                borderRadius: 6,
                fontSize: 12,
                width: 400,
                fontFamily: 'monospace'
              }}
            />
            <button
              onClick={testFormToken}
              disabled={loading || !testToken.trim()}
              style={{
                padding: '10px 16px',
                background: loading || !testToken.trim() ? '#6c757d' : '#17a2b8',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: loading || !testToken.trim() ? 'not-allowed' : 'pointer',
                fontSize: 14,
                fontWeight: 500
              }}
            >
              🔍 Проверить токен
            </button>
            <button
              onClick={testActualFormLoad}
              disabled={loading || !testToken.trim()}
              style={{
                padding: '10px 16px',
                background: loading || !testToken.trim() ? '#6c757d' : '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: loading || !testToken.trim() ? 'not-allowed' : 'pointer',
                fontSize: 14,
                fontWeight: 500
              }}
            >
              🚀 Тест загрузки формы
            </button>
          </div>
          <p style={{ fontSize: 12, color: '#6c757d', margin: 0 }}>
            Первая кнопка проверяет диагностические функции, вторая - реальную загрузку формы
          </p>
        </div>
      </div>

      {/* Результаты */}
      {results && (
        <div style={{
          backgroundColor: '#fff',
          borderRadius: 12,
          padding: 24,
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          border: '1px solid #e1e5e9'
        }}>
          <h3 style={{ margin: 0, marginBottom: 20, fontSize: 20, color: '#2c3e50', fontWeight: 600 }}>
            📊 Результаты диагностики
          </h3>

          {results.error && (
            <div style={{
              background: '#f8d7da',
              color: '#721c24',
              padding: 16,
              borderRadius: 8,
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
                background: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: 8,
                padding: 20,
                marginBottom: 16
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: 12
              }}>
                <span style={{ marginRight: 12, fontSize: 20 }}>
                  {getStatusIcon(test.status)}
                </span>
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: 16, color: '#2c3e50' }}>{test.name}</strong>
                  <p style={{ 
                    margin: '4px 0 0 0', 
                    fontSize: 14, 
                    color: '#6c757d',
                    lineHeight: 1.4
                  }}>
                    {test.description}
                  </p>
                </div>
                <span style={{
                  padding: '4px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  background: test.status === 'pass' ? '#d4edda' : '#f8d7da',
                  color: test.status === 'pass' ? '#155724' : '#721c24',
                  border: `1px solid ${test.status === 'pass' ? '#c3e6cb' : '#f5c6cb'}`
                }}>
                  {test.status === 'pass' ? 'УСПЕШНО' : 'ОШИБКА'}
                </span>
              </div>
              
              {test.error && (
                <div style={{
                  background: '#fff3cd',
                  border: '1px solid #ffeaa7',
                  padding: 12,
                  borderRadius: 6,
                  fontSize: 13,
                  color: '#856404',
                  marginBottom: 12
                }}>
                  <strong>Ошибка:</strong> {test.error}
                </div>
              )}
              
              {test.data && (
                <details style={{ fontSize: 13 }}>
                  <summary style={{ 
                    cursor: 'pointer', 
                    marginBottom: 8,
                    fontWeight: 500,
                    color: '#495057'
                  }}>
                    📋 Показать детали
                  </summary>
                  <pre style={{
                    background: '#ffffff',
                    border: '1px solid #e9ecef',
                    padding: 12,
                    borderRadius: 6,
                    overflow: 'auto',
                    fontSize: 11,
                    lineHeight: 1.4,
                    maxHeight: 300,
                    color: '#495057'
                  }}>
                    {JSON.stringify(test.data, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ))}

          {/* Специальные тесты */}
          {(results.teamSearch || results.formTest || results.realFormTest || results.linkGeneration) && (
            <div style={{ marginTop: 24 }}>
              <h4 style={{ 
                marginBottom: 16, 
                fontSize: 18, 
                color: '#2c3e50',
                fontWeight: 600,
                borderBottom: '2px solid #e9ecef',
                paddingBottom: 8
              }}>
                🔧 Специализированные тесты
              </h4>

              {[results.teamSearch, results.formTest, results.realFormTest, results.linkGeneration].map((test, index) => {
                if (!test) return null;
                
                const testNames = ['Поиск команды', 'Диагностика токена', 'Загрузка формы', 'Генерация ссылок'];
                const testName = testNames[index];
                
                return (
                  <div
                    key={index}
                    style={{
                      background: '#f8f9fa',
                      border: '1px solid #dee2e6',
                      borderRadius: 8,
                      padding: 20,
                      marginBottom: 16
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      marginBottom: 12
                    }}>
                      <span style={{ marginRight: 12, fontSize: 20 }}>
                        {getStatusIcon(test.status)}
                      </span>
                      <div style={{ flex: 1 }}>
                        <strong style={{ fontSize: 16, color: '#2c3e50' }}>{testName}</strong>
                        <p style={{ 
                          margin: '4px 0 0 0', 
                          fontSize: 14, 
                          color: '#6c757d',
                          lineHeight: 1.4
                        }}>
                          {test.description}
                        </p>
                      </div>
                      <span style={{
                        padding: '4px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        background: test.status === 'pass' ? '#d4edda' : '#f8d7da',
                        color: test.status === 'pass' ? '#155724' : '#721c24',
                        border: `1px solid ${test.status === 'pass' ? '#c3e6cb' : '#f5c6cb'}`
                      }}>
                        {test.status === 'pass' ? 'УСПЕШНО' : 'ОШИБКА'}
                      </span>
                    </div>
                    
                    {test.error && (
                      <div style={{
                        background: '#fff3cd',
                        border: '1px solid #ffeaa7',
                        padding: 12,
                        borderRadius: 6,
                        fontSize: 13,
                        color: '#856404',
                        marginBottom: 12
                      }}>
                        <strong>Ошибка:</strong> {test.error}
                      </div>
                    )}

                    {/* Специальная обработка для генерации ссылок */}
                    {test.data?.testLink && (
                      <div style={{
                        background: '#d1ecf1',
                        border: '1px solid #bee5eb',
                        padding: 12,
                        borderRadius: 6,
                        fontSize: 13,
                        color: '#0c5460',
                        marginBottom: 12
                      }}>
                        <strong>Тестовая ссылка:</strong><br/>
                        <a 
                          href={test.data.testLink} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          style={{ 
                            color: '#0c5460',
                            wordBreak: 'break-all',
                            textDecoration: 'underline'
                          }}
                        >
                          {test.data.testLink}
                        </a>
                      </div>
                    )}

                    {/* Специальная обработка для результатов формы */}
                    {test.data?.rows && (
                      <div style={{
                        background: '#d4edda',
                        border: '1px solid #c3e6cb',
                        padding: 12,
                        borderRadius: 6,
                        fontSize: 13,
                        color: '#155724',
                        marginBottom: 12
                      }}>
                        <strong>Результат загрузки формы:</strong><br/>
                        Найдено {test.data.rows.length} навыков для оценки<br/>
                        Сотрудников: {test.data.stats?.totalEmployees || 'неизвестно'}<br/>
                        Роль: {test.data.stats?.reviewerRole || 'неизвестно'}
                      </div>
                    )}
                    
                    {test.data && (
                      <details style={{ fontSize: 13 }}>
                        <summary style={{ 
                          cursor: 'pointer', 
                          marginBottom: 8,
                          fontWeight: 500,
                          color: '#495057'
                        }}>
                          📋 Показать технические детали
                        </summary>
                        <pre style={{
                          background: '#ffffff',
                          border: '1px solid #e9ecef',
                          padding: 12,
                          borderRadius: 6,
                          overflow: 'auto',
                          fontSize: 11,
                          lineHeight: 1.4,
                          maxHeight: 400,
                          color: '#495057'
                        }}>
                          {JSON.stringify(test.data, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{
            marginTop: 24,
            padding: 16,
            background: '#e9ecef',
            borderRadius: 8,
            fontSize: 13,
            color: '#495057'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                <strong>Время выполнения:</strong> {new Date(results.timestamp).toLocaleString()}
              </span>
              <button
                onClick={() => setResults(null)}
                style={{
                  background: '#6c757d',
                  color: 'white',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: 4,
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                Очистить результаты
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Справочная информация */}
      <div style={{ marginTop: 32, display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div style={{
          backgroundColor: '#fff',
          borderRadius: 12,
          padding: 20,
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          border: '1px solid #e1e5e9'
        }}>
          <h4 style={{ margin: '0 0 12px', color: '#2c3e50', fontSize: 16, fontWeight: 600 }}>
            💡 Советы по диагностике
          </h4>
          <ul style={{ margin: 0, paddingLeft: 20, color: '#495057', fontSize: 14, lineHeight: 1.6 }}>
            <li>Всегда начинайте с полной диагностики</li>
            <li>Проверьте переменные окружения в Cloudflare Pages</li>
            <li>Убедитесь что база данных Notion настроена правильно</li>
            <li>Используйте реальные команды для тестирования</li>
          </ul>
        </div>

        <div style={{
          backgroundColor: '#fff',
          borderRadius: 12,
          padding: 20,
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          border: '1px solid #e1e5e9'
        }}>
          <h4 style={{ margin: '0 0 12px', color: '#2c3e50', fontSize: 16, fontWeight: 600 }}>
            🔗 Быстрые ссылки
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <a 
              href="/admin" 
              style={{
                color: '#007bff',
                textDecoration: 'none',
                fontSize: 14,
                padding: '4px 0'
              }}
            >
              🛠️ Админ-панель
            </a>
            <a 
              href="/" 
              style={{
                color: '#007bff',
                textDecoration: 'none',
                fontSize: 14,
                padding: '4px 0'
              }}
            >
              🏠 Главная страница
            </a>
            <a 
              href="/api/debug" 
              target="_blank"
              style={{
                color: '#007bff',
                textDecoration: 'none',
                fontSize: 14,
                padding: '4px 0'
              }}
            >
              🔍 API отладки
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}