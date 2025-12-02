'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import ScoreRow from '@/components/ScoreRow';

const StateHandler = ({ loading, error, empty, onRetry, children }) => {
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#f8f9fa'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div className="loading-spinner" style={{
            width: 48,
            height: 48,
            border: '4px solid #e9ecef',
            borderTop: '4px solid #007bff',
            borderRadius: '50%',
            margin: '0 auto 16px'
          }}></div>
          <p style={{ color: '#6c757d', fontSize: 16 }}>Загрузка навыков для оценки...</p>
        </div>
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
        backgroundColor: '#f8f9fa',
        padding: 24
      }}>
        <div style={{ textAlign: 'center', maxWidth: 600 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h3 style={{ 
            fontSize: 24, 
            fontWeight: 600, 
            color: '#dc3545', 
            marginBottom: 16 
          }}>
            Ошибка загрузки данных
          </h3>
          <p style={{ 
            color: '#6c757d', 
            marginBottom: 24,
            lineHeight: 1.5,
            fontSize: 16
          }}>
            {error}
          </p>
          <button
            onClick={onRetry}
            style={{
              backgroundColor: '#007bff',
              color: 'white',
              padding: '12px 24px',
              border: 'none',
              borderRadius: 8,
              fontSize: 16,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background-color 0.2s ease'
            }}
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
        backgroundColor: '#f8f9fa',
        padding: 24
      }}>
        <div style={{ textAlign: 'center', maxWidth: 600 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
          <h3 style={{ 
            fontSize: 24, 
            fontWeight: 600, 
            color: '#6c757d', 
            marginBottom: 16 
          }}>
            Навыки не найдены
          </h3>
          <p style={{ 
            color: '#6c757d',
            lineHeight: 1.5,
            fontSize: 16
          }}>
            Возможно, вам не назначены задачи по оценке или данные ещё не настроены в системе. 
            Обратитесь к администратору для проверки настроек матрицы компетенций.
          </p>
        </div>
      </div>
    );
  }

  return children;
};

function useSkillsData(token) {
  const [state, setState] = useState({
    skillGroups: [],
    loading: true,
    error: null,
    scoreData: new Map(),
    stats: null,
    loadTime: 0
  });

  const fetchSkills = useCallback(async () => {
    const start = performance.now();
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      console.log('[SKILLS] Начинаем загрузку навыков для токена:', token);
      
      const response = await fetch(`/api/form/${token}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log('[SKILLS] Статус ответа:', response.status);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `HTTP ${response.status}: Ошибка сервера`
        );
      }

      const result = await response.json();
      console.log('[SKILLS] Получен ответ от API:', result);

      if (!result.rows || !Array.isArray(result.rows)) {
        throw new Error('API вернул некорректный формат данных');
      }

      const grouped = {};
      for (const row of result.rows) {
        const key = `${row.employeeId}_${row.role}`;
        if (!grouped[key]) {
          grouped[key] = {
            employeeId: row.employeeId,
            employeeName: row.employeeName,
            role: row.role,
            items: []
          };
        }
        grouped[key].items.push({
          pageId: row.pageId,
          name: row.name,
          description: row.description,
          current: row.current,
          role: row.role
        });
      }

      const skillGroups = Object.values(grouped);

      // Заполняем карту оценок существующими значениями из Notion
      const initialScoreData = new Map();
      skillGroups.forEach(group => {
        group.items?.forEach(item => {
          if (item.current !== null && item.current !== undefined) {
            initialScoreData.set(item.pageId, {
              value: item.current,
              role: group.role
            });
          }
        });
      });
      console.log(`[SKILLS] Загружено ${skillGroups.length} групп навыков`);

      setState(prev => ({
        ...prev,
        skillGroups,
        loading: false,
        error: null,
        stats: result.stats,
        loadTime: (performance.now() - start) / 1000,
        scoreData: initialScoreData
      }));
      
    } catch (error) {
      console.error('[SKILLS] Ошибка загрузки навыков:', error);
      setState(prev => ({ 
        ...prev, 
        error: error.message, 
        loading: false,
        skillGroups: []
      }));
    }
  }, [token]);

  const updateSkillScore = useCallback((pageId, role, value) => {
    setState(prev => {
      const newScoreData = new Map(prev.scoreData);
      newScoreData.set(pageId, { value, role });
      return {
        ...prev,
        scoreData: newScoreData
      };
    });
  }, []);

  useEffect(() => {
    if (token) {
      fetchSkills();
    }
  }, [token, fetchSkills]);

  return {
    ...state,
    updateSkillScore,
    refetch: fetchSkills
  };
}

export default function SkillsAssessmentForm({ params }) {
  const { token } = params;
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');
  
  const {
    skillGroups,
    loading,
    error,
    scoreData,
    stats,
    loadTime,
    updateSkillScore,
    refetch
  } = useSkillsData(token);

  const totalSkills = useMemo(() => {
    return skillGroups.reduce((sum, group) => sum + (group.items?.length || 0), 0);
  }, [skillGroups]);

  const ratedSkills = scoreData.size;

  const [collapsedGroups, setCollapsedGroups] = useState({});
  const toggleGroup = useCallback((key) => {
    setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

// ИСПРАВЛЕННАЯ функция для обработки отправки формы с лучшей обработкой KV
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    
    if (scoreData.size === 0) {
      setSubmitMessage('❌ Необходимо оценить хотя бы один навык');
      return;
    }

    setSubmitting(true);
    setSubmitMessage('');
    
    try {
      // Преобразуем scoreData в формат операций для batch API
      const operations = Array.from(scoreData.entries()).map(([pageId, scoreInfo]) => {
        const fieldMapping = {
          'self': 'Self_score',
          'p1_peer': 'P1_score', 
          'p2_peer': 'P2_score',
          'manager': 'Manager_score',
          'peer': 'P1_score' // fallback
        };
        
        const field = fieldMapping[scoreInfo.role] || fieldMapping.peer;
        
        return {
          pageId: pageId,
          properties: {
            [field]: { number: scoreInfo.value }
          }
        };
      });

      console.log(`[SUBMIT] Отправляем ${operations.length} операций через batch API`);
      
      // ИСПРАВЛЕНИЕ: Более консервативные настройки для стабильности
      let batchOptions = {
        batchSize: Math.min(operations.length <= 20 ? 20 : 40, 50),
        concurrency: 2,  // Уменьшено для избежания rate limits
        rateLimitDelay: operations.length > 30 ? 3000 : 2500,  // Увеличено
        maxRetries: 3,
        forceKV: false  // Не принуждаем KV, позволяем системе выбрать
      };
      
      // Для больших объемов предлагаем KV, но не принуждаем
      if (operations.length > 15) {
        batchOptions.forceKV = false; // Позволяем системе решить
        batchOptions.batchSize = 50;
        batchOptions.concurrency = 2;
        batchOptions.rateLimitDelay = 3000;
      }
      
      console.log(`[SUBMIT] Настройки batch:`, batchOptions);
      
      // Отправляем через batch API
      const response = await fetch('/api/batch/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          operations,
          options: batchOptions
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: Ошибка отправки`);
      }

      const result = await response.json();
      console.log('[SUBMIT] Ответ от batch API:', result);
      
      if (result.mode === 'kv_queue') {
        // KV очереди используются
        setSubmitMessage(`${result.totalOperations} оценок отправлено. Спасибо!`);

      } else if (result.mode === 'direct_processing' || result.mode === 'direct') {
        // Прямая обработка завершена
        const successRate = result.stats.totalOperations > 0 ?
          (result.stats.successful / result.stats.totalOperations * 100).toFixed(1) : 0;

			setSubmitMessage(`${result.totalOperations} оценок отправлено. Спасибо!`);

        // Показываем детали если есть ошибки
        if (result.stats.failed > 0) {
          const errorDetails = result.results
            .filter(r => r.status === 'error')
            .slice(0, 3)
            .map(r => r.error || 'Неизвестная ошибка')
            .join('; ');

          setTimeout(() => {
            setSubmitMessage(prev =>
              prev + ` Ошибки: ${errorDetails}${result.stats.failed > 3 ? '...' : ''}`
            );
          }, 2000);
        }
      } else {
        // Неизвестный режим
        setSubmitMessage(`✅ Операции отправлены в режиме: ${result.mode}. Проверьте результаты.`);
      }
      
    } catch (error) {
      console.error('[SUBMIT] Ошибка отправки:', error);
      
      let errorMessage = `❌ Ошибка отправки: ${error.message}`;
      
      // Специальная обработка для известных ошибок
      if (error.message.includes('KV')) {
        errorMessage += ' (Система автоматически переключилась на прямую обработку)';
      } else if (error.message.includes('rate limit') || error.message.includes('429')) {
        errorMessage = '❌ Превышен лимит запросов. Подождите и попробуйте снова.';
      } else if (error.message.includes('timeout')) {
        errorMessage = '❌ Тайм-аут операции. Попробуйте уменьшить количество одновременно оцениваемых навыков.';
      } else if (error.message.includes('503')) {
        errorMessage = '❌ Сервис временно недоступен. Попробуйте позже или уменьшите объем операций.';
      }
      
      setSubmitMessage(errorMessage);
    } finally {
      setSubmitting(false);
    }
  }, [scoreData, token]);

  return (
    <div style={{ 
      minHeight: '100vh', 
      backgroundColor: '#f8f9fa',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <StateHandler 
        loading={loading} 
        error={error} 
        empty={skillGroups.length === 0}
        onRetry={refetch}
      >
        <div style={{ 
          maxWidth: 1200, 
          margin: '0 auto', 
          padding: 24 
        }}>
          {/* Заголовок */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: 12,
            padding: 32,
            marginBottom: 24,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            textAlign: 'center'
          }}>
            <h1 style={{ 
              fontSize: 28, 
              fontWeight: 700, 
              color: '#2c3e50', 
              marginBottom: 16 
            }}>
              📊 Форма оценки компетенций
            </h1>
			 {stats?.reviewerName && (
              <div style={{
                color: '#495057',
                fontSize: 16,
                fontWeight: 600
              }}>
                Оценивающий: {stats.reviewerName}
              </div>
            )}
            <div style={{
              color: '#6c757d',
              marginBottom: 16,
              fontSize: 16,
              lineHeight: 1.5
            }}>
              Оцените уровень владения навыками по шкале от 0 до 5.
          <br/>
              Форма работает в тестовом режиме. При возникновении проблем, ошибок, а также с предложениями по улучшению можно писать в <a href ="https://t.me/hanbeio">telegram</a> 
            </div>
          </div>

          {/* Прогресс-бар */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: 12,
            padding: 20,
            marginBottom: 24,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12
            }}>
              <span style={{ fontWeight: 600, color: '#495057' }}>
                Прогресс оценки
              </span>
              <span style={{ color: '#6c757d', fontSize: 14 }}>
                {ratedSkills} из {totalSkills} навыков
              </span>
            </div>
            <div style={{
              width: '100%',
              height: 8,
              backgroundColor: '#e9ecef',
              borderRadius: 4,
              overflow: 'hidden'
            }}>
              <div className="progress-bar" style={{
                width: `${totalSkills > 0 ? (ratedSkills / totalSkills) * 100 : 0}%`,
                height: '100%',
                backgroundColor: ratedSkills === totalSkills ? '#28a745' : '#007bff',
                borderRadius: 4,
                transition: 'all 0.3s ease'
              }}></div>
            </div>        
          </div>

          {/* Форма оценки */}
          <form onSubmit={handleSubmit}>
            {skillGroups.map((group) => {
              const key = `${group.employeeId}_${group.role}`;
              const isCollapsed = collapsedGroups[key];
              return (
                <div
                  key={key}
                  style={{
                    backgroundColor: 'white',
                    borderRadius: 12,
                    marginBottom: 24,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    overflow: 'hidden'
                  }}
                >
                  {/* Заголовок группы */}
                  <div
                    onClick={() => toggleGroup(key)}
                    style={{
                      backgroundColor: '#f8f9fa',
                      padding: 20,
                      borderBottom: '1px solid #dee2e6',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <h2 style={{
                        fontSize: 20,
                        fontWeight: 600,
                        color: '#495057',
                        margin: 0,
                        marginBottom: 8
                      }}>
                        👤 {group.employeeName}
                      </h2>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 16
                      }}>
                        <span style={{
                          backgroundColor: '#007bff',
                          color: 'white',
                          padding: '4px 12px',
                          borderRadius: 16,
                          fontSize: 12,
                          fontWeight: 600,
                          textTransform: 'uppercase'
                        }}>
                          {group.role === 'self' ? 'Самооценка' :
                           group.role === 'manager' ? 'Оценка менеджера' :
                           group.role === 'p1_peer' ? 'Peer-оценка' :
                           group.role === 'p2_peer' ? 'Peer-оценка' :
                           'Peer оценка'}
                        </span>
                        <span style={{ color: '#6c757d', fontSize: 14 }}>
                          {group.items?.length || 0} навыков
                        </span>
                      </div>
                    </div>
                    <span style={{ fontSize: 20, color: '#6c757d' }}>
                      {isCollapsed ? '▶' : '▼'}
                    </span>
                  </div>

                  {/* Список навыков */}
					{!isCollapsed && (
					  <div style={{ padding: '20px 0' }}>
						{(group.items || []).map((item) => (
						  <ScoreRow
							key={item.pageId}
							item={item}
							currentScore={scoreData.get(item.pageId)?.value} // ИСПРАВЛЕНИЕ: передаем текущую оценку
							onChange={({ value }) => updateSkillScore(item.pageId, group.role, value)}
							hideComment={true}
						  />
						))}
					  </div>
					)}
                </div>
              );
            })}

            {/* Панель действий */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: 12,
              padding: 24,
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
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
                  <div style={{ 
                    fontWeight: 600, 
                    color: '#495057',
                    marginBottom: 4
                  }}>
                    Готовность к отправке: {Math.round((ratedSkills / totalSkills) * 100) || 0}%
                  </div>
                  <div style={{ color: '#6c757d', fontSize: 14 }}>
                    {ratedSkills === totalSkills ? 
                      '✅ Все навыки оценены' : 
                      `${totalSkills - ratedSkills} навыков осталось`
                    }
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    type="submit"
                    disabled={submitting || ratedSkills === 0}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: submitting ? '#6c757d' : '#28a745',
                      color: 'white',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 16,
                      fontWeight: 600,
                      cursor: submitting || ratedSkills === 0 ? 'not-allowed' : 'pointer',
                      transition: 'background-color 0.2s ease',
                      boxShadow: '0 2px 4px rgba(40,167,69,0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8
                    }}
                  >
                    {submitting ? (
                      <>
                        <div style={{
                          width: 16,
                          height: 16,
                          border: '2px solid rgba(255,255,255,0.3)',
                          borderTop: '2px solid white',
                          borderRadius: '50%',
                          animation: 'spin 1s linear infinite'
                        }} />
                        Отправляем...
                      </>
                    ) : (
                      <>
                        🚀 Отправить оценку
                      </>
                    )}
                  </button>
                </div>
              </div>

              {submitMessage && (
                <div style={{
                  marginTop: 16,
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: submitMessage.includes('❌') ? '#f8d7da' : 
                                  submitMessage.includes('🔄') ? '#d1ecf1' : '#d4edda',
                  color: submitMessage.includes('❌') ? '#721c24' : 
                         submitMessage.includes('🔄') ? '#0c5460' : '#155724',
                  fontSize: 14,
                  lineHeight: 1.4,
                  border: `1px solid ${submitMessage.includes('❌') ? '#f5c6cb' : 
                                      submitMessage.includes('🔄') ? '#bee5eb' : '#c3e6cb'}`
                }}>
                  {submitMessage}
                </div>
              )}
            </div>
          </form>
        </div>
      </StateHandler>

      {!loading && (
        <div style={{
          textAlign: 'center',
          color: '#6c757d',
          fontSize: 12,
          paddingBottom: 24
        }}>
          Страница загрузилась за {loadTime.toFixed(2)} сек.
        </div>
      )}

      {/* CSS анимации */}
      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        @keyframes shimmer {
          0% { transform: translateX(-20px); opacity: 0; }
          50% { opacity: 1; }
          100% { transform: translateX(20px); opacity: 0; }
        }
      `}</style>
    </div>
  );
}