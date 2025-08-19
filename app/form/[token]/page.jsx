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
      console.log('Начинаем загрузку навыков для токена:', token);
      
      const response = await fetch(`/api/form/${token}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log('Статус ответа:', response.status);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `HTTP ${response.status}: Ошибка сервера`
        );
      }

      const result = await response.json();
      console.log('Получен ответ от API:', result);

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
      console.log(`Загружено ${skillGroups.length} групп навыков`);
      
      setState(prev => ({
        ...prev,
        skillGroups,
        loading: false,
        error: null,
        stats: result.stats,
        loadTime: (performance.now() - start) / 1000
      }));
      
    } catch (error) {
      console.error('Ошибка загрузки навыков:', error);
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

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    
    if (scoreData.size === 0) {
      setSubmitMessage('❌ Необходимо оценить хотя бы один навык');
      return;
    }

    setSubmitting(true);
    setSubmitMessage('');
    
    try {
      const items = Array.from(scoreData.entries()).map(([pageId, scoreInfo]) => ({
        pageId,
        value: scoreInfo.value,
        role: scoreInfo.role
      }));

      console.log('Отправка оценки:', items);
      
      const response = await fetch(`/api/form/${token}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          items,
          mode: 'final'
        })
      });

      const raw = await response.text();
      let result = {};

      try {
        result = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error('сервер вернул некорректный ответ');
      }

      if (!response.ok) {
        throw new Error(result.error || 'Ошибка отправки данных');
      }

      if (result.ok) {
        setSubmitMessage(`✅ Успешно сохранено ${result.queued} оценок!`);
      } else {
        throw new Error(result.error || 'Неизвестная ошибка');
      }
      
    } catch (error) {
      console.error('Ошибка отправки:', error);
      const msg = error.message === 'Failed to fetch'
        ? 'не удалось связаться с сервером'
        : error.message;
      setSubmitMessage(`❌ Ошибка отправки: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }, [scoreData, token]);

  const handleSaveDraft = useCallback(async () => {
    if (scoreData.size === 0) {
      setSubmitMessage('❌ Нет данных для сохранения');
      return;
    }

    setSubmitting(true);
    setSubmitMessage('');
    
    try {
      const items = Array.from(scoreData.entries()).map(([pageId, scoreInfo]) => ({
        pageId,
        value: scoreInfo.value,
        role: scoreInfo.role
      }));

      const response = await fetch(`/api/form/${token}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          items,
          mode: 'draft'
        })
      });

      const raw = await response.text();
      let result = {};

      try {
        result = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error('сервер вернул некорректный ответ');
      }

      if (!response.ok) {
        throw new Error(result.error || 'Ошибка сохранения черновика');
      }

      if (result.ok) {
        setSubmitMessage(`💾 Черновик сохранен (${result.queued} оценок)`);
      }
      
    } catch (error) {
      console.error('Ошибка сохранения черновика:', error);
      const msg = error.message === 'Failed to fetch'
        ? 'не удалось связаться с сервером'
        : error.message;
      setSubmitMessage(`❌ Ошибка сохранения: ${msg}`);
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
            <div style={{
              color: '#6c757d',
              marginBottom: 16,
              fontSize: 16,
              lineHeight: 1.5
            }}>
              Оцените уровень владения навыками по шкале от 0 до 5
            </div>
            {stats?.reviewerName && (
              <div style={{
                color: '#495057',
                fontSize: 16,
                fontWeight: 600
              }}>
                Ревьювер: {stats.reviewerName}
              </div>
            )}

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
                backgroundColor: '#007bff',
                borderRadius: 4
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
                    type="button"
                    onClick={handleSaveDraft}
                    disabled={submitting || ratedSkills === 0}
                    style={{
                      padding: '12px 20px',
                      backgroundColor: submitting ? '#6c757d' : '#6f42c1',
                      color: 'white',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: submitting || ratedSkills === 0 ? 'not-allowed' : 'pointer',
                      transition: 'background-color 0.2s ease'
                    }}
                  >
                    💾 Сохранить черновик
                  </button>

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
                      boxShadow: '0 2px 4px rgba(40,167,69,0.2)'
                    }}
                  >
                    {submitting ? '⏳ Отправляем...' : '🚀 Отправить оценку'}
                  </button>
                </div>
              </div>

              {submitMessage && (
                <div style={{
                  marginTop: 16,
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: submitMessage.includes('❌') ? '#f8d7da' : 
                                  submitMessage.includes('💾') ? '#d1ecf1' : '#d4edda',
                  color: submitMessage.includes('❌') ? '#721c24' : 
                         submitMessage.includes('💾') ? '#0c5460' : '#155724',
                  fontSize: 14,
                  textAlign: 'center'
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
    </div>
  );
}