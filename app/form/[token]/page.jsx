'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ScoreRow from '@/components/ScoreRow';
import './form-styles.css';

// Константы
const CACHE_TTL = 10 * 60 * 1000; // 10 минут
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
      <div className="state-container">
        <div className="state-content">
          <div className="state-icon">⚠️</div>
          <h3 className="state-title state-title-error">
            Ошибка загрузки данных
          </h3>
          <p className="state-text state-text-error">
            {error}
          </p>
          <button onClick={onRetry} className="retry-button">
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  if (!loading && empty) {
    return (
      <div className="state-container">
        <div className="state-content">
          <div className="state-icon">📋</div>
          <h3 className="state-title state-title-empty">
            Навыки не найдены
          </h3>
          <p className="state-text">
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
    <div className="loading-container">
      <div className="loading-content">
        <div className="loading-spinner"></div>
        <p className="loading-text">
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

      const batchOptions = {
        batchSize: operations.length <= 20 ? 20 : 50,
        concurrency: 2,
        rateLimitDelay: operations.length > 30 ? 3000 : 2500,
        maxRetries: 3
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
    <div className="form-container">
      {loading && <LoadingIndicator stage={loadingStage} />}

      <StateHandler
        loading={loading}
        error={error}
        empty={skillGroups.length === 0}
        onRetry={refetch}
      >
        <div className="content-wrapper">
          {/* Заголовок */}
          <div className="form-header">
            <h1 className="form-title">
              📊 Форма оценки компетенций
            </h1>
            {stats?.reviewerName && (
              <div className="reviewer-name">
                Оценивающий: {stats.reviewerName}
              </div>
            )}
            <div className="form-description">
              Оцените уровень владения навыками по шкале от 0 до 5
              {fromCache && (
                <span className="cache-indicator">
                  (данные из кэша)
                </span>
              )}
              <br/>
              Форма работает в тестовом режиме. При возникновении проблем, ошибок, а также с предложениями по улучшению можно писать в <a href="https://t.me/hanbeio">telegram</a>
            </div>
          </div>

          {/* Прогресс */}
          <div className="progress-container">
            <div className="progress-header">
              <span className="progress-title">Прогресс оценки</span>
              <span className="progress-stats">
                {ratedSkills} из {totalSkills} навыков
              </span>
            </div>
            <div className="progress-bar-wrapper">
              <div
                className={`progress-bar-fill ${ratedSkills === totalSkills ? 'progress-bar-fill-complete' : 'progress-bar-fill-incomplete'}`}
                style={{ width: `${totalSkills > 0 ? (ratedSkills / totalSkills) * 100 : 0}%` }}
              ></div>
            </div>
          </div>

          {/* Форма */}
          <form onSubmit={handleSubmit}>
            {skillGroups.map((group) => {
              const key = `${group.employeeId}_${group.role}`;
              const isCollapsed = collapsedGroups[key];
              
              return (
                <div key={key} className="skill-group">
                  {/* Заголовок группы */}
                  <div
                    onClick={() => toggleGroup(key)}
                    className="skill-group-header"
                  >
                    <div className="skill-group-info">
                      <h2>
                        👤 {group.employeeName}
                      </h2>
                      <div className="skill-group-meta">
                        <span className="role-badge">
                          {getRoleLabel(group.role)}
                        </span>
                        <span className="skills-count">
                          {group.items?.length || 0} навыков
                        </span>
                      </div>
                    </div>
                    <span className="collapse-icon">
                      {isCollapsed ? '▶' : '▼'}
                    </span>
                  </div>

                  {/* Навыки */}
                  {!isCollapsed && (
                    <div className="skill-group-content">
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
            <div className="submit-panel">
              <div className="submit-panel-content">
                <div>
                  <div className="submit-info-title">
                    Готовность: {Math.round((ratedSkills / totalSkills) * 100) || 0}%
                  </div>
                  <div className="submit-info-text">
                    {ratedSkills === totalSkills ?
                      '✅ Все навыки оценены' :
                      `${totalSkills - ratedSkills} навыков осталось`
                    }
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || scoreData.size === 0}
                  className={`submit-button ${submitting || scoreData.size === 0 ? 'submit-button-disabled' : 'submit-button-active'}`}
                >
                  {submitting ? (
                    <>
                      <div className="submit-spinner" />
                      Отправляем...
                    </>
                  ) : scoreData.size > 0 ? `Отправить изменения (${scoreData.size})` : 'Отправить оценку'}
                </button>
              </div>

              {submitMessage && (
                <div className={`submit-message ${submitMessage.includes('❌') ? 'submit-message-error' : 'submit-message-success'}`}>
                  {submitMessage}
                </div>
              )}
            </div>
          </form>
        </div>
      </StateHandler>

      {/* Время загрузки - показываем только если есть данные и время > 0 */}
      {!loading && loadTime > 0 && (
        <div className="load-time">
          Загружено за {loadTime.toFixed(2)} сек.
          {fromCache && ' (из кэша)'}
        </div>
      )}
    </div>
  );
}