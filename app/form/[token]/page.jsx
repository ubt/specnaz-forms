'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import ScoreRow from '@/components/ScoreRow';

/**
 * Компонент отображения состояний загрузки, ошибок и пустых данных 
 */
const StateHandler = ({ 
  loading = false, 
  error = null, 
  empty = false, 
  onRetry = () => {},
  children 
}) => {
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        fontFamily: 'system-ui, sans-serif'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 48,
            height: 48,
            border: '4px solid #f3f3f3',
            borderTop: '4px solid #007bff',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px'
          }}></div>
          <p style={{ color: '#666', margin: 0 }}>Загрузка навыков для оценки...</p>
        </div>
        <style jsx>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        fontFamily: 'system-ui, sans-serif',
        padding: 20
      }}>
        <div style={{ 
          textAlign: 'center', 
          maxWidth: 500,
          background: '#fff',
          padding: 32,
          borderRadius: 12,
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          border: '1px solid #e1e5e9'
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h3 style={{ 
            fontSize: 20, 
            fontWeight: 600, 
            color: '#2c3e50', 
            marginBottom: 12,
            margin: 0
          }}>
            Ошибка загрузки данных
          </h3>
          <p style={{ 
            color: '#666', 
            marginBottom: 20,
            lineHeight: 1.5,
            margin: '12px 0 20px 0'
          }}>
            {error}
          </p>
          <button
            onClick={onRetry}
            style={{
              background: '#007bff',
              color: 'white',
              padding: '12px 24px',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              transition: 'background-color 0.2s ease'
            }}
            onMouseEnter={(e) => e.target.style.backgroundColor = '#0056b3'}
            onMouseLeave={(e) => e.target.style.backgroundColor = '#007bff'}
          >
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  if (empty) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        fontFamily: 'system-ui, sans-serif',
        padding: 20
      }}>
        <div style={{ 
          textAlign: 'center', 
          maxWidth: 500,
          background: '#fff',
          padding: 32,
          borderRadius: 12,
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          border: '1px solid #e1e5e9'
        }}>
          <div style={{ fontSize: 48, marginBottom: 16, color: '#6c757d' }}>📋</div>
          <h3 style={{ 
            fontSize: 20, 
            fontWeight: 600, 
            color: '#2c3e50', 
            marginBottom: 12,
            margin: 0
          }}>
            Навыки не найдены
          </h3>
          <p style={{ 
            color: '#666', 
            margin: '12px 0 0 0',
            lineHeight: 1.5
          }}>
            Проверьте конфигурацию оценки или обратитесь к администратору
          </p>
        </div>
      </div>
    );
  }

  return children;
};

/**
 * Кастомный хук для управления данными навыков
 */
function useSkillsData(token) {
  const [state, setState] = useState({
    rows: [],
    loading: true,
    error: null,
    stats: null
  });

  // Функция загрузки данных
  const fetchSkills = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      console.log('[FORM] Начинаем загрузку данных для токена:', token?.substring(0, 10) + '...');
      
      const response = await fetch(`/api/form/${token}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log('[FORM] Статус ответа:', response.status);
      
      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = { error: `HTTP ${response.status}: Ошибка сервера` };
        }
        
        throw new Error(
          errorData.error || `HTTP ${response.status}: Ошибка сервера`
        );
      }

      const result = await response.json();
      console.log('[FORM] Получен ответ от API:', {
        rowsCount: result.rows?.length,
        stats: result.stats,
        hasWarning: !!result.warning
      });

      if (!result.rows || !Array.isArray(result.rows)) {
        throw new Error('API вернул некорректный формат данных: отсутствует массив rows');
      }

      console.log(`[FORM] Загружено ${result.rows.length} навыков`);
      
      setState(prev => ({ 
        ...prev, 
        rows: result.rows,
        stats: result.stats,
        loading: false,
        error: null
      }));
      
    } catch (error) {
      console.error('[FORM] Ошибка загрузки навыков:', error);
      setState(prev => ({ 
        ...prev, 
        error: error.message, 
        loading: false,
        rows: []
      }));
    }
  }, [token]);

  // Загружаем данные при монтировании или изменении токена 
  useEffect(() => {
    if (token) {
      fetchSkills();
    }
  }, [token, fetchSkills]);

  return {
    ...state,
    refetch: fetchSkills
  };
}

/**
 * Главный компонент формы оценки навыков
 */
export default function SkillsAssessmentForm({ params }) {
  const { token } = params;
  const [scores, setScores] = useState(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');
  
  // Используем кастомный хук для управления данными
  const {
    rows,
    loading,
    error,
    stats,
    refetch
  } = useSkillsData(token);

  // Группировка навыков по сотрудникам
  const groupedSkills = useMemo(() => {
    if (!rows.length) return {};
    
    return rows.reduce((acc, row) => {
      const key = `${row.employeeId}_${row.employeeName}`;
      if (!acc[key]) {
        acc[key] = {
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          role: row.role,
          items: []
        };
      }
      acc[key].items.push(row);
      return acc;
    }, {});
  }, [rows]);

  // Обработчик изменения оценки
  const handleScoreChange = useCallback((pageId, scoreData) => {
    setScores(prev => {
      const newScores = new Map(prev);
      newScores.set(pageId, scoreData);
      return newScores;
    });
  }, []);

  // Функция отправки формы
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    
    if (scores.size === 0) {
      setSubmitMessage('❌ Необходимо оценить хотя бы один навык');
      return;
    }

    setSubmitting(true);
    setSubmitMessage('');
    
    try {
      const items = Array.from(scores.entries()).map(([pageId, scoreData]) => ({
        pageId,
        value: scoreData.value
      }));

      console.log('[FORM] Отправка оценок:', { count: items.length, token: token?.substring(0, 10) + '...' });
      
      const response = await fetch(`/api/form/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          items,
          mode: 'final'
        })
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Ошибка отправки данных');
      }
      
      if (result.ok) {
        setSubmitMessage(`✅ Успешно обновлено ${result.updated} оценок!`);
        
        if (result.failed > 0) {
          setSubmitMessage(prev => prev + ` (${result.failed} ошибок)`);
        }
      } else {
        throw new Error(result.message || 'Неизвестная ошибка');
      }
      
    } catch (error) {
      console.error('[FORM] Ошибка отправки:', error);
      setSubmitMessage(`❌ Ошибка отправки: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  }, [scores, token]);

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#f8f9fa',
      fontFamily: 'system-ui, sans-serif'
    }}>
      <StateHandler 
        loading={loading} 
        error={error} 
        empty={rows.length === 0}
        onRetry={refetch}
      >
        <div style={{ 
          maxWidth: 1000, 
          margin: '0 auto', 
          padding: 24 
        }}>
          {/* Заголовок */}
          <div style={{
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            padding: 24,
            marginBottom: 24,
            border: '1px solid #e1e5e9'
          }}>
            <h1 style={{ 
              fontSize: 28, 
              fontWeight: 700, 
              color: '#2c3e50', 
              marginBottom: 12,
              margin: 0
            }}>
              📊 Форма оценки компетенций
            </h1>
            <p style={{ 
              color: '#6c757d', 
              marginBottom: 16,
              fontSize: 16,
              margin: '12px 0 16px 0'
            }}>
              Оцените навыки сотрудников по шкале от 0 до 5
            </p>
            
            {stats && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 16,
                padding: 16,
                background: '#f8f9fa',
                borderRadius: 8,
                fontSize: 14,
                color: '#495057'
              }}>
                <div>
                  <strong>Сотрудников:</strong> {stats.totalEmployees}
                </div>
                <div>
                  <strong>Навыков:</strong> {stats.totalSkills}
                </div>
                <div>
                  <strong>Роль:</strong> {stats.reviewerRole}
                </div>
                <div>
                  <strong>Оценено:</strong> {scores.size} из {rows.length}
                </div>
              </div>
            )}
          </div>

          {/* Форма */}
          <form onSubmit={handleSubmit}>
            {Object.values(groupedSkills).map((group) => (
              <div 
                key={`${group.employeeId}_${group.employeeName}`}
                style={{
                  background: '#fff',
                  borderRadius: 12,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  marginBottom: 24,
                  overflow: 'hidden',
                  border: '1px solid #e1e5e9'
                }}
              >
                {/* Заголовок сотрудника */}
                <div style={{
                  background: '#f8f9fa',
                  padding: '16px 24px',
                  borderBottom: '1px solid #e1e5e9'
                }}>
                  <h2 style={{ 
                    fontSize: 18, 
                    fontWeight: 600, 
                    color: '#2c3e50',
                    margin: 0
                  }}>
                    👤 {group.employeeName}
                    <span style={{
                      marginLeft: 12,
                      fontSize: 14,
                      fontWeight: 400,
                      color: '#6c757d',
                      background: '#e9ecef',
                      padding: '2px 8px',
                      borderRadius: 4
                    }}>
                      {group.role}
                    </span>
                  </h2>
                </div>

                {/* Навыки */}
                <div style={{ padding: '8px 0' }}>
                  {group.items.map((item) => (
                    <ScoreRow
                      key={item.pageId}
                      item={item}
                      onChange={(scoreData) => handleScoreChange(item.pageId, scoreData)}
                      hideComment={true}
                    />
                  ))}
                </div>
              </div>
            ))}

            {/* Панель отправки */}
            <div style={{
              background: '#fff',
              borderRadius: 12,
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              padding: 24,
              border: '1px solid #e1e5e9',
              position: 'sticky',
              bottom: 24
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 16
              }}>
                <div>
                  <div style={{ marginBottom: 8, color: '#495057' }}>
                    Прогресс: {scores.size} из {rows.length} навыков оценено
                  </div>
                  <div style={{
                    width: 200,
                    height: 8,
                    background: '#e9ecef',
                    borderRadius: 4,
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${rows.length > 0 ? (scores.size / rows.length) * 100 : 0}%`,
                      height: '100%',
                      background: scores.size === rows.length ? '#28a745' : '#007bff',
                      transition: 'width 0.3s ease'
                    }}></div>
                  </div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  {submitMessage && (
                    <div style={{
                      padding: '8px 12px',
                      borderRadius: 6,
                      fontSize: 14,
                      fontWeight: 500,
                      background: submitMessage.includes('✅') ? '#d4edda' : '#f8d7da',
                      color: submitMessage.includes('✅') ? '#155724' : '#721c24',
                      border: `1px solid ${submitMessage.includes('✅') ? '#c3e6cb' : '#f5c6cb'}`
                    }}>
                      {submitMessage}
                    </div>
                  )}
                  
                  <button
                    type="submit"
                    disabled={submitting || scores.size === 0}
                    style={{
                      background: submitting || scores.size === 0 ? '#6c757d' : '#007bff',
                      color: 'white',
                      padding: '12px 24px',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 16,
                      fontWeight: 600,
                      cursor: submitting || scores.size === 0 ? 'not-allowed' : 'pointer',
                      transition: 'background-color 0.2s ease',
                      minWidth: 140
                    }}
                  >
                    {submitting ? 'Отправка...' : 'Отправить оценки'}
                  </button>
                </div>
              </div>
            </div>
          </form>

          {/* Дополнительная информация */}
          <div style={{
            marginTop: 32,
            padding: 16,
            background: '#e7f3ff',
            border: '1px solid #b8daff',
            borderRadius: 8,
            fontSize: 14,
            color: '#004085'
          }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>
              ℹ️ Инструкция
            </h4>
            <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
              <li>Используйте шкалу от 0 до 5 для оценки каждого навыка</li>
              <li>0 - навык отсутствует, 5 - экспертный уровень</li>
              <li>Все изменения сохраняются автоматически при отправке формы</li>
              <li>Для завершения оценки нажмите кнопку "Отправить оценки"</li>
            </ul>
          </div>
        </div>
      </StateHandler>
    </div>
  );
}