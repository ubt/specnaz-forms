'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ScoreRow from '@/components/ScoreRow';

// Константы
const CACHE_TTL = 60 * 60 * 1000; // 60 минут
const LOADING_STAGES = [
  'Проверка токена...',
  'Загрузка списка сотрудников...',
  'Загрузка навыков...',
  'Подготовка формы...'
];
 
// Компонент состояния (БЕЗ индикатора загрузки - он теперь только в основном компоненте)
const StateHandler = ({ loading, error, empty, onRetry, children }) => {
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
          <h3 style={{ fontSize: 24, fontWeight: 600, color: '#dc3545', marginBottom: 16 }}>
            Ошибка загрузки данных
          </h3>
          <p style={{ color: '#6c757d', marginBottom: 24, lineHeight: 1.5, fontSize: 16 }}>
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
              cursor: 'pointer'
            }}
          >
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  if (!loading && empty) {
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
          <h3 style={{ fontSize: 24, fontWeight: 600, color: '#6c757d', marginBottom: 16 }}>
            Навыки не найдены
          </h3>
          <p style={{ color: '#6c757d', lineHeight: 1.5, fontSize: 16 }}>
            Возможно, вам не назначены задачи по оценке или данные ещё не настроены в системе. 
            Обратитесь к администратору для проверки настроек матрицы компетенций.
          </p>
        </div>
      </div>
    );
  }

  return children;
};

// Компонент индикатора загрузки - только спиннер
const LoadingIndicator = ({ stage }) => {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: '#f8f9fa',
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 1000
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 48,
          height: 48,
          border: '4px solid #e9ecef',
          borderTop: '4px solid #007bff',
          borderRadius: '50%',
          margin: '0 auto 16px',
          animation: 'spin 1s linear infinite'
        }}></div>
        <p style={{ 
          color: '#6c757d', 
          fontSize: 16,
          margin: 0,
          minHeight: 24
        }}>
          {LOADING_STAGES[stage] || 'Загрузка...'}
        </p>
      </div>
    </div>
  );
};

// Хук для загрузки данных с кэшированием
function useSkillsData(token) {
  // Ref для отслеживания времени начала загрузки
  const loadStartRef = useRef(null);
  // Ref для актуального состояния (чтобы избежать повторных загрузок)
  const stateRef = useRef(null);
  
  const [state, setState] = useState(() => {
    // Попытка загрузить из кэша при инициализации
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem(`skills_${token}`);
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_TTL) {
            console.log('[SKILLS] Using cached data');
            return {
              skillGroups: data.skillGroups || [],
              loading: false,
              error: null,
              scoreData: new Map(data.scores || []), // Изменённые оценки
              initialScoreData: new Map(data.initialScores || []), // Исходные оценки
              stats: data.stats,
              loadTime: 0,
              fromCache: true,
              loadingStage: 3
            };
          }
        }
      } catch {
        // Игнорируем ошибки кэша
      }
    }
    return {
      skillGroups: [],
      loading: true,
      error: null,
      scoreData: new Map(), // Только изменённые оценки
      initialScoreData: new Map(), // Исходные оценки из Notion
      stats: null,
      loadTime: 0,
      loadingStage: 0,
      fromCache: false
    };
  });

  // Всегда храним актуальное состояние в ref, чтобы callback не создавался заново
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const fetchSkills = useCallback(async (forceRefresh = false) => {
    const currentState = stateRef.current || state;

    // Если есть кэш и не принудительное обновление
    if (!forceRefresh && currentState.fromCache && currentState.skillGroups.length > 0) {
      return;
    }
    
    // Запоминаем время начала загрузки
    loadStartRef.current = performance.now();
    
    setState(prev => ({ ...prev, loading: true, error: null, loadingStage: 0 }));
    
    try {
      // Этап 1: начало запроса
      setState(prev => ({ ...prev, loadingStage: 1 }));
      
      const response = await fetch(`/api/form/${token}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      // Этап 2: получен ответ
      setState(prev => ({ ...prev, loadingStage: 2 }));
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: Ошибка сервера`);
      }

      const result = await response.json();

      if (!result.rows || !Array.isArray(result.rows)) {
        throw new Error('API вернул некорректный формат данных');
      }

      // Этап 3: обработка данных
      setState(prev => ({ ...prev, loadingStage: 3 }));

      // Группировка данных
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

      // Заполняем исходные оценки из Notion (для сравнения)
      const initialScoreData = new Map();
      skillGroups.forEach(group => {
        group.items?.forEach(item => {
          if (item.current !== null && item.current !== undefined) {
            initialScoreData.set(item.pageId, { value: item.current, role: group.role });
          }
        });
      });

      // scoreData начинается пустым - будет заполняться только при изменении пользователем
      const emptyScoreData = new Map();

      // Вычисляем время загрузки
      const loadTime = loadStartRef.current
        ? (performance.now() - loadStartRef.current) / 1000
        : 0;

      // Сохраняем в кэш
      if (typeof window !== 'undefined') {
        try {
          const cacheData = {
            data: {
              skillGroups,
              scores: Array.from(emptyScoreData.entries()), // Пустой при загрузке
              initialScores: Array.from(initialScoreData.entries()), // Исходные значения
              stats: result.stats
            },
            timestamp: Date.now()
          };
          localStorage.setItem(`skills_${token}`, JSON.stringify(cacheData));
        } catch {
          // Игнорируем ошибки кэша
        }
      }

      setState({
        skillGroups,
        loading: false,
        error: null,
        stats: result.stats,
        loadTime,
        scoreData: emptyScoreData, // Пустой - только изменённые оценки
        initialScoreData: initialScoreData, // Исходные оценки
        fromCache: false,
        loadingStage: 3
      });
      
    } catch (error) {
      console.error('[SKILLS] Error:', error);
      
      // Вычисляем время до ошибки
      const loadTime = loadStartRef.current 
        ? (performance.now() - loadStartRef.current) / 1000 
        : 0;
      
      setState(prev => ({ 
        ...prev, 
        error: error.message, 
        loading: false,
        loadTime,
        skillGroups: prev.fromCache ? prev.skillGroups : []
      }));
    }
  }, [token]);

  const updateSkillScore = useCallback((pageId, role, value) => {
    setState(prev => {
      const newScoreData = new Map(prev.scoreData);
      const initialScore = prev.initialScoreData.get(pageId);

      // Если значение отличается от исходного - добавляем в scoreData
      // Если совпадает с исходным - удаляем из scoreData (не нужно отправлять)
      if (initialScore && initialScore.value === value) {
        // Оценка вернулась к исходному значению - удаляем из изменений
        newScoreData.delete(pageId);
      } else {
        // Оценка изменилась - добавляем/обновляем
        newScoreData.set(pageId, { value, role });
      }

      return { ...prev, scoreData: newScoreData };
    });
  }, []);

  useEffect(() => {
    if (token && !state.fromCache) {
      fetchSkills();
    }
  }, [token, fetchSkills, state.fromCache]);

  return {
    ...state,
    updateSkillScore,
    refetch: () => fetchSkills(true),
    initialScoreData: state.initialScoreData // Возвращаем для использования в компоненте
  };
}

export default function SkillsAssessmentForm({ params }) {
  const { token } = params;
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState({});
  
  const {
    skillGroups,
    loading,
    error,
    scoreData,
    initialScoreData,
    stats,
    loadTime,
    loadingStage,
    fromCache,
    updateSkillScore,
    refetch
  } = useSkillsData(token);

  const totalSkills = useMemo(() => {
    return skillGroups.reduce((sum, group) => sum + (group.items?.length || 0), 0);
  }, [skillGroups]);

  // Подсчет оцененных навыков: исходные оценки + новые изменения (которых не было в исходных)
  const ratedSkills = useMemo(() => {
    const allRatedIds = new Set(initialScoreData.keys());
    // Добавляем новые оценки, которых не было в исходных
    scoreData.forEach((_, pageId) => {
      if (!initialScoreData.has(pageId)) {
        allRatedIds.add(pageId);
      }
    });
    return allRatedIds.size;
  }, [initialScoreData, scoreData]);

  const toggleGroup = useCallback((key) => {
    setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Обработка отправки формы
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();

    // scoreData теперь содержит только ИЗМЕНЁННЫЕ оценки
    if (scoreData.size === 0) {
      setSubmitMessage('❌ Нет изменений для отправки. Выберите или измените хотя бы одну оценку.');
      return;
    }

    setSubmitting(true);
    setSubmitMessage('');

    try {
      const operations = Array.from(scoreData.entries()).map(([pageId, scoreInfo]) => {
        const fieldMapping = {
          'self': 'Self_score',
          'p1_peer': 'P1_score',
          'p2_peer': 'P2_score',
          'manager': 'Manager_score',
          'peer': 'P1_score'
        };

        const field = fieldMapping[scoreInfo.role] || fieldMapping.peer;

        return {
          pageId,
          properties: { [field]: { number: scoreInfo.value } }
        };
      });

      console.log(`[SUBMIT] Sending ${operations.length} changed ratings (out of ${initialScoreData.size} total)`);

      const batchOptions = {
        batchSize: operations.length <= 20 ? 20 : 50,
        concurrency: 2,
        rateLimitDelay: operations.length > 30 ? 3000 : 2500,
        maxRetries: 3,
        forceKV: false
      };

      const response = await fetch('/api/batch/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ operations, options: batchOptions })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();

      const totalOps = result.totalOperations || operations.length;
      setSubmitMessage(`✅ ${totalOps} изменённых оценок отправлено. Спасибо!`);

      // Очищаем кэш после успешной отправки
      if (typeof window !== 'undefined') {
        localStorage.removeItem(`skills_${token}`);
      }

      if (result.stats?.failed > 0) {
        setTimeout(() => {
          setSubmitMessage(prev =>
            prev + ` ⚠️ ${result.stats.failed} ошибок при сохранении.`
          );
        }, 2000);
      }

    } catch (error) {
      console.error('[SUBMIT] Error:', error);

      let errorMessage = `❌ Ошибка: ${error.message}`;

      if (error.message.includes('rate limit') || error.message.includes('429')) {
        errorMessage = '❌ Превышен лимит запросов. Подождите и попробуйте снова.';
      } else if (error.message.includes('timeout')) {
        errorMessage = '❌ Тайм-аут. Попробуйте уменьшить количество оценок.';
      }

      setSubmitMessage(errorMessage);
    } finally {
      setSubmitting(false);
    }
  }, [scoreData, initialScoreData, token]);

  const getRoleLabel = (role) => {
    const labels = {
      'self': 'Самооценка',
      'manager': 'Оценка менеджера',
      'p1_peer': 'Peer-оценка',
      'p2_peer': 'Peer-оценка'
    };
    return labels[role] || 'Peer оценка';
  };

  // Показываем индикатор загрузки поверх всего
  return (
    <div style={{ 
      minHeight: '100vh', 
      backgroundColor: '#f8f9fa',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {loading && <LoadingIndicator stage={loadingStage} />}
      
      <StateHandler 
        loading={loading} 
        error={error} 
        empty={skillGroups.length === 0}
        onRetry={refetch}
      >
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
          {/* Заголовок */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: 12,
            padding: 32,
            marginBottom: 24,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            textAlign: 'center'
          }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#2c3e50', marginBottom: 16 }}>
              📊 Форма оценки компетенций
            </h1>
            {stats?.reviewerName && (
              <div style={{ color: '#495057', fontSize: 16, fontWeight: 600 }}>
                Оценивающий: {stats.reviewerName}
              </div>
            )}
            <div style={{ color: '#6c757d', marginTop: 8, fontSize: 14, lineHeight: 1.5 }}>
              Оцените уровень владения навыками по шкале от 0 до 5
              {fromCache && (
                <span style={{ color: '#28a745', marginLeft: 8 }}>
                  (данные из кэша)
                </span>
              )}
			  <br/>
              Форма работает в тестовом режиме. При возникновении проблем, ошибок, а также с предложениями по улучшению можно писать в <a href ="https://t.me/hanbeio">telegram</a> 
            </div>
          </div>

          {/* Прогресс */}
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
              <span style={{ fontWeight: 600, color: '#495057' }}>Прогресс оценки</span>
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
              <div style={{
                width: `${totalSkills > 0 ? (ratedSkills / totalSkills) * 100 : 0}%`,
                height: '100%',
                backgroundColor: ratedSkills === totalSkills ? '#28a745' : '#007bff',
                borderRadius: 4,
                transition: 'all 0.3s ease'
              }}></div>
            </div>        
          </div>

          {/* Форма */}
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
                      <h2 style={{ fontSize: 20, fontWeight: 600, color: '#495057', margin: 0, marginBottom: 8 }}>
                        👤 {group.employeeName}
                      </h2>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <span style={{
                          backgroundColor: '#007bff',
                          color: 'white',
                          padding: '4px 12px',
                          borderRadius: 16,
                          fontSize: 12,
                          fontWeight: 600,
                          textTransform: 'uppercase'
                        }}>
                          {getRoleLabel(group.role)}
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

                  {/* Навыки */}
                  {!isCollapsed && (
                    <div style={{ padding: '20px 0' }}>
                      {(group.items || []).map((item) => {
                        // Если есть измененное значение - используем его, иначе исходное
                        const changedScore = scoreData.get(item.pageId);
                        const displayScore = changedScore !== undefined
                          ? changedScore.value
                          : (initialScoreData.get(item.pageId)?.value ?? item.current);

                        return (
                          <ScoreRow
                            key={item.pageId}
                            item={item}
                            currentScore={displayScore}
                            onChange={({ value }) => updateSkillScore(item.pageId, group.role, value)}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Панель отправки */}
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
                  <div style={{ fontWeight: 600, color: '#495057', marginBottom: 4 }}>
                    Готовность: {Math.round((ratedSkills / totalSkills) * 100) || 0}%
                  </div>
                  <div style={{ color: '#6c757d', fontSize: 14 }}>
                    {ratedSkills === totalSkills ? 
                      '✅ Все навыки оценены' : 
                      `${totalSkills - ratedSkills} навыков осталось`
                    }
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || scoreData.size === 0}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: submitting ? '#6c757d' : '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: submitting || scoreData.size === 0 ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                  }}
                >
                  {submitting ? (
                    <>
                      <div style={{
                        width: 16, height: 16,
                        border: '2px solid rgba(255,255,255,0.3)',
                        borderTop: '2px solid white',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                      }} />
                      Отправляем...
                    </>
                  ) : scoreData.size > 0 ? `Отправить изменения (${scoreData.size})` : 'Отправить оценку'}
                </button>
              </div>

              {submitMessage && (
                <div style={{
                  marginTop: 16,
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: submitMessage.includes('❌') ? '#f8d7da' : '#d4edda',
                  color: submitMessage.includes('❌') ? '#721c24' : '#155724',
                  fontSize: 14
                }}>
                  {submitMessage}
                </div>
              )}
            </div>
          </form>
        </div>
      </StateHandler>

      {/* Время загрузки - показываем только если есть данные и время > 0 */}
      {!loading && loadTime > 0 && (
        <div style={{ textAlign: 'center', color: '#6c757d', fontSize: 12, paddingBottom: 24 }}>
          Загружено за {loadTime.toFixed(2)} сек.
          {fromCache && ' (из кэша)'}
        </div>
      )}

      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}