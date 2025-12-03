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

// КРИТИЧНО: Лимит операций для одного запроса (с запасом от 50 subrequests)
const MAX_OPERATIONS_PER_REQUEST = 35;
 
// Компонент состояния
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

// Компонент индикатора загрузки
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

// Компонент прогресса отправки
const SubmitProgress = ({ current, total, currentBatch, totalBatches }) => {
  const progress = total > 0 ? Math.round((current / total) * 100) : 0;
  
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2000
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: 32,
        borderRadius: 16,
        maxWidth: 400,
        width: '90%',
        textAlign: 'center'
      }}>
        <div style={{
          width: 64,
          height: 64,
          border: '4px solid #e9ecef',
          borderTop: '4px solid #28a745',
          borderRadius: '50%',
          margin: '0 auto 16px',
          animation: 'spin 1s linear infinite'
        }}></div>
        
        <h3 style={{ fontSize: 20, fontWeight: 600, color: '#2c3e50', marginBottom: 8 }}>
          Отправляем оценки...
        </h3>
        
        <p style={{ color: '#6c757d', fontSize: 14, marginBottom: 16 }}>
          Часть {currentBatch} из {totalBatches}
        </p>
        
        <div style={{
          width: '100%',
          height: 8,
          backgroundColor: '#e9ecef',
          borderRadius: 4,
          overflow: 'hidden',
          marginBottom: 8
        }}>
          <div style={{
            width: `${progress}%`,
            height: '100%',
            backgroundColor: '#28a745',
            borderRadius: 4,
            transition: 'width 0.3s ease'
          }}></div>
        </div>
        
        <p style={{ color: '#495057', fontSize: 14, fontWeight: 500 }}>
          {current} / {total} ({progress}%)
        </p>
      </div>
    </div>
  );
};

// Хук для загрузки данных с кэшированием
function useSkillsData(token) {
  const loadStartRef = useRef(null);
  const stateRef = useRef(null);
  
  const [state, setState] = useState(() => {
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
              scoreData: new Map(data.scores || []),
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
      scoreData: new Map(),
      stats: null,
      loadTime: 0,
      loadingStage: 0,
      fromCache: false
    };
  });

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const fetchSkills = useCallback(async (forceRefresh = false) => {
    const currentState = stateRef.current || state;

    if (!forceRefresh && currentState.fromCache && currentState.skillGroups.length > 0) {
      return;
    }
    
    loadStartRef.current = performance.now();
    
    setState(prev => ({ ...prev, loading: true, error: null, loadingStage: 0 }));
    
    try {
      setState(prev => ({ ...prev, loadingStage: 1 }));
      
      const response = await fetch(`/api/form/${token}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      setState(prev => ({ ...prev, loadingStage: 2 }));
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: Ошибка сервера`);
      }

      const result = await response.json();

      if (!result.rows || !Array.isArray(result.rows)) {
        throw new Error('API вернул некорректный формат данных');
      }

      setState(prev => ({ ...prev, loadingStage: 3 }));

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

      const initialScoreData = new Map();
      skillGroups.forEach(group => {
        group.items?.forEach(item => {
          if (item.current !== null && item.current !== undefined) {
            initialScoreData.set(item.pageId, { value: item.current, role: group.role });
          }
        });
      });

      const loadTime = loadStartRef.current 
        ? (performance.now() - loadStartRef.current) / 1000 
        : 0;

      if (typeof window !== 'undefined') {
        try {
          const cacheData = {
            data: {
              skillGroups,
              scores: Array.from(initialScoreData.entries()),
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
        scoreData: initialScoreData,
        fromCache: false,
        loadingStage: 3
      });
      
    } catch (error) {
      console.error('[SKILLS] Error:', error);
      
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
      newScoreData.set(pageId, { value, role });
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
    refetch: () => fetchSkills(true)
  };
}

// Функция разбиения массива на части
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Функция задержки
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default function SkillsAssessmentForm({ params }) {
  const { token } = params;
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [submitProgress, setSubmitProgress] = useState({ current: 0, total: 0, currentBatch: 0, totalBatches: 0 });
  
  const {
    skillGroups,
    loading,
    error,
    scoreData,
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

  const ratedSkills = scoreData.size;

  const toggleGroup = useCallback((key) => {
    setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ИСПРАВЛЕННАЯ обработка отправки с разбиением на батчи
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    
    if (scoreData.size === 0) {
      setSubmitMessage('❌ Необходимо оценить хотя бы один навык');
      return;
    }

    setSubmitting(true);
    setSubmitMessage('');
    
    try {
      // Подготовка операций
      const allOperations = Array.from(scoreData.entries()).map(([pageId, scoreInfo]) => {
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

      console.log(`[SUBMIT] Total operations: ${allOperations.length}`);
      
      // КРИТИЧНО: Разбиваем на батчи для соблюдения лимита subrequests
      const batches = chunkArray(allOperations, MAX_OPERATIONS_PER_REQUEST);
      console.log(`[SUBMIT] Split into ${batches.length} batches of max ${MAX_OPERATIONS_PER_REQUEST} operations`);
      
      setSubmitProgress({
        current: 0,
        total: allOperations.length,
        currentBatch: 0,
        totalBatches: batches.length
      });
      
      let totalSuccessful = 0;
      let totalFailed = 0;
      const allResults = [];
      const errors = [];
      
      // Обрабатываем батчи последовательно
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNumber = i + 1;
        
        console.log(`[SUBMIT] Processing batch ${batchNumber}/${batches.length} (${batch.length} operations)`);
        
        setSubmitProgress(prev => ({
          ...prev,
          currentBatch: batchNumber
        }));
        
        try {
          const batchOptions = {
            batchSize: Math.min(batch.length, 35),
            concurrency: 1, // Последовательная обработка
            rateLimitDelay: 3000,
            maxRetries: 3,
            forceKV: false
          };
          
          const response = await fetch('/api/batch/submit', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ operations: batch, options: batchOptions })
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}`);
          }

          const result = await response.json();
          
          // Собираем результаты
          if (result.results) {
            allResults.push(...result.results);
          }
          
          const batchSuccessful = result.stats?.successful || 0;
          const batchFailed = result.stats?.failed || 0;
          
          totalSuccessful += batchSuccessful;
          totalFailed += batchFailed;
          
          // Обновляем прогресс
          setSubmitProgress(prev => ({
            ...prev,
            current: prev.current + batch.length
          }));
          
          console.log(`[SUBMIT] Batch ${batchNumber} completed: ${batchSuccessful} success, ${batchFailed} failed`);
          
          // Задержка между батчами для rate limiting
          if (i < batches.length - 1) {
            console.log(`[SUBMIT] Waiting 3 seconds before next batch...`);
            await delay(3000);
          }
          
        } catch (batchError) {
          console.error(`[SUBMIT] Batch ${batchNumber} error:`, batchError);
          errors.push(`Батч ${batchNumber}: ${batchError.message}`);
          totalFailed += batch.length;
          
          // Если rate limit - делаем дополнительную паузу
          if (batchError.message?.includes('429') || batchError.message?.includes('rate')) {
            console.log('[SUBMIT] Rate limit hit, waiting 10 seconds...');
            await delay(10000);
          }
        }
      }

      // Финальное сообщение
      const totalOps = allOperations.length;
      const successRate = totalOps > 0 ? Math.round((totalSuccessful / totalOps) * 100) : 0;
      
      if (errors.length === 0) {
        setSubmitMessage(`✅ ${totalSuccessful}/${totalOps} оценок отправлено (${successRate}%). Спасибо!`);
        
        // Очищаем кэш после успешной отправки
        if (typeof window !== 'undefined') {
          localStorage.removeItem(`skills_${token}`);
        }
      } else {
        setSubmitMessage(`⚠️ Отправлено ${totalSuccessful}/${totalOps} (${successRate}%). Ошибки: ${errors.join('; ')}`);
      }

    } catch (error) {
      console.error('[SUBMIT] Error:', error);
      
      let errorMessage = `❌ Ошибка: ${error.message}`;
      
      if (error.message.includes('rate limit') || error.message.includes('429')) {
        errorMessage = '❌ Превышен лимит запросов. Подождите минуту и попробуйте снова.';
      } else if (error.message.includes('timeout')) {
        errorMessage = '❌ Тайм-аут. Попробуйте отправить меньше оценок за раз.';
      } else if (error.message.includes('subrequest')) {
        errorMessage = '❌ Слишком много операций. Попробуйте отправить меньше оценок за раз.';
      }
      
      setSubmitMessage(errorMessage);
    } finally {
      setSubmitting(false);
      setSubmitProgress({ current: 0, total: 0, currentBatch: 0, totalBatches: 0 });
    }
  }, [scoreData, token]);

  const getRoleLabel = (role) => {
    const labels = {
      'self': 'Самооценка',
      'manager': 'Оценка менеджера',
      'p1_peer': 'Peer-оценка',
      'p2_peer': 'Peer-оценка'
    };
    return labels[role] || 'Peer оценка';
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      backgroundColor: '#f8f9fa',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {loading && <LoadingIndicator stage={loadingStage} />}
      
      {submitting && submitProgress.total > 0 && (
        <SubmitProgress 
          current={submitProgress.current}
          total={submitProgress.total}
          currentBatch={submitProgress.currentBatch}
          totalBatches={submitProgress.totalBatches}
        />
      )}
      
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
                      {(group.items || []).map((item) => (
                        <ScoreRow
                          key={item.pageId}
                          item={item}
                          currentScore={scoreData.get(item.pageId)?.value}
                          onChange={({ value }) => updateSkillScore(item.pageId, group.role, value)}
                        />
                      ))}
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
                  ) : 'Отправить оценку'}
                </button>
              </div>

              {submitMessage && (
                <div style={{
                  marginTop: 16,
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: submitMessage.includes('❌') ? '#f8d7da' : 
                                   submitMessage.includes('⚠️') ? '#fff3cd' : '#d4edda',
                  color: submitMessage.includes('❌') ? '#721c24' : 
                         submitMessage.includes('⚠️') ? '#856404' : '#155724',
                  fontSize: 14
                }}>
                  {submitMessage}
                </div>
              )}
            </div>
          </form>
        </div>
      </StateHandler>

      {/* Время загрузки */}
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