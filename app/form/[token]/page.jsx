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

// Компонент для отображения прогресса KV batch операции
const KVBatchProgressModal = ({ isOpen, progress, onClose, onCancel }) => {
  if (!isOpen) return null;

  const getStatusIcon = (mode) => {
    switch (mode) {
      case 'kv_queue': return '🔄';
      case 'direct': return '⚡';
      default: return '📊';
    }
  };

  const getStatusColor = (mode) => {
    switch (mode) {
      case 'kv_queue': return '#28a745';
      case 'direct': return '#007bff';
      default: return '#6c757d';
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: 16,
        padding: 32,
        maxWidth: 600,
        width: '90%',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.15)',
        border: '1px solid #e9ecef'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ 
            fontSize: 48, 
            marginBottom: 12,
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))'
          }}>
            {getStatusIcon(progress.mode)}
          </div>
          <h3 style={{ 
            fontSize: 22, 
            fontWeight: 700,
            color: '#2c3e50',
            margin: 0,
            marginBottom: 8
          }}>
            Обработка оценок
          </h3>
          <p style={{
            color: '#6c757d',
            fontSize: 14,
            margin: 0
          }}>
            {progress.mode === 'kv_queue' ? 
              'Cloudflare KV обрабатывает ваши операции' : 
              'Прямая обработка операций'
            }
          </p>
        </div>
        
        {/* Основной прогресс-бар */}
        <div style={{ marginBottom: 24 }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8
          }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#495057' }}>
              Общий прогресс
            </span>
            <span style={{ fontSize: 14, color: '#6c757d' }}>
              {progress.processed || 0} из {progress.total || 0}
            </span>
          </div>
          <div style={{
            width: '100%',
            height: 14,
            backgroundColor: '#e9ecef',
            borderRadius: 7,
            overflow: 'hidden',
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <div style={{
              width: `${Math.min(progress.progress || 0, 100)}%`,
              height: '100%',
              background: `linear-gradient(90deg, ${getStatusColor(progress.mode)}, ${getStatusColor(progress.mode)}dd)`,
              borderRadius: 7,
              transition: 'width 0.3s ease-out',
              position: 'relative'
            }}>
              {/* Анимация для активного прогресса */}
              {progress.progress > 0 && progress.progress < 100 && (
                <div style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: '20px',
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3))',
                  animation: 'shimmer 2s infinite linear'
                }} />
              )}
            </div>
          </div>
          <div style={{ 
            textAlign: 'center', 
            marginTop: 10, 
            fontSize: 18, 
            fontWeight: 700,
            color: '#495057'
          }}>
            {(progress.progress || 0).toFixed(1)}%
          </div>
        </div>

        {/* Информация о режиме обработки */}
        <div style={{
          backgroundColor: progress.mode === 'kv_queue' ? '#d4edda' : '#e7f3ff',
          padding: 16,
          borderRadius: 10,
          marginBottom: 20,
          border: `1px solid ${progress.mode === 'kv_queue' ? '#c3e6cb' : '#b8daff'}`
        }}>
          <div style={{
            fontSize: 14,
            color: progress.mode === 'kv_queue' ? '#155724' : '#004085',
            fontWeight: 500,
            lineHeight: 1.4
          }}>
            {progress.mode === 'kv_queue' ? (
              <>
                <strong>🚀 Cloudflare KV очереди</strong>
                <div style={{ marginTop: 6 }}>
                  {progress.completedJobs !== undefined && progress.totalJobs !== undefined ? (
                    <span>Завершено задач: {progress.completedJobs}/{progress.totalJobs}</span>
                  ) : (
                    <span>Операции обрабатываются в фоновом режиме</span>
                  )}
                </div>
              </>
            ) : (
              <>
                <strong>⚡ Прямая обработка</strong>
                <div style={{ marginTop: 6 }}>
                  {progress.currentChunk && progress.totalChunks ? (
                    <span>Пакет: {progress.currentChunk}/{progress.totalChunks}</span>
                  ) : (
                    <span>Операции выполняются последовательно</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Детальная статистика */}
        {(progress.estimatedTimeRemaining || progress.averageTimePerOperation || progress.throughput) && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 12,
            marginBottom: 20,
            fontSize: 13
          }}>
            {progress.estimatedTimeRemaining && (
              <div style={{
                backgroundColor: '#f8f9fa',
                padding: 12,
                borderRadius: 8,
                textAlign: 'center'
              }}>
                <div style={{ fontWeight: 600, color: '#495057', marginBottom: 4 }}>
                  Осталось
                </div>
                <div style={{ color: '#6c757d' }}>
                  ~{Math.ceil(progress.estimatedTimeRemaining / 60)} мин
                </div>
              </div>
            )}
            {progress.averageTimePerOperation && (
              <div style={{
                backgroundColor: '#f8f9fa',
                padding: 12,
                borderRadius: 8,
                textAlign: 'center'
              }}>
                <div style={{ fontWeight: 600, color: '#495057', marginBottom: 4 }}>
                  Среднее время
                </div>
                <div style={{ color: '#6c757d' }}>
                  {(progress.averageTimePerOperation / 1000).toFixed(1)}с
                </div>
              </div>
            )}
            {progress.throughput && (
              <div style={{
                backgroundColor: '#f8f9fa',
                padding: 12,
                borderRadius: 8,
                textAlign: 'center'
              }}>
                <div style={{ fontWeight: 600, color: '#495057', marginBottom: 4 }}>
                  Скорость
                </div>
                <div style={{ color: '#6c757d' }}>
                  {progress.throughput} оп/с
                </div>
              </div>
            )}
          </div>
        )}

        {/* Статус сообщение */}
        {progress.message && (
          <div style={{
            padding: 14,
            backgroundColor: '#f1f3f4',
            borderRadius: 8,
            fontSize: 14,
            color: '#495057',
            marginBottom: 20,
            textAlign: 'center',
            border: '1px solid #e9ecef'
          }}>
            {progress.message}
          </div>
        )}

        {/* Детали задач для KV режима */}
        {progress.mode === 'kv_queue' && (progress.activeJobs > 0 || progress.failedJobs > 0) && (
          <div style={{
            backgroundColor: '#fff3cd',
            padding: 12,
            borderRadius: 8,
            marginBottom: 20,
            fontSize: 13,
            border: '1px solid #ffeaa7'
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: '#856404' }}>
              Статус задач:
            </div>
            <div style={{ color: '#856404' }}>
              {progress.activeJobs > 0 && <span>🔄 Активных: {progress.activeJobs} </span>}
              {progress.failedJobs > 0 && <span>❌ Неудачных: {progress.failedJobs} </span>}
              {progress.completedJobs > 0 && <span>✅ Завершенных: {progress.completedJobs}</span>}
            </div>
          </div>
        )}

        {/* Кнопки управления */}
        <div style={{
          display: 'flex',
          gap: 12,
          justifyContent: 'center'
        }}>
          {progress.canCancel && (
            <button
              onClick={onCancel}
              style={{
                padding: '12px 20px',
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background-color 0.2s ease'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#c82333'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#dc3545'}
            >
              Отменить
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '12px 20px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background-color 0.2s ease'
            }}
            onMouseEnter={(e) => e.target.style.backgroundColor = '#545b62'}
            onMouseLeave={(e) => e.target.style.backgroundColor = '#6c757d'}
          >
            Скрыть
          </button>
        </div>
      </div>
    </div>
  );
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
      console.log(`[SKILLS] Загружено ${skillGroups.length} групп навыков`);
      
      setState(prev => ({
        ...prev,
        skillGroups,
        loading: false,
        error: null,
        stats: result.stats,
        loadTime: (performance.now() - start) / 1000
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
  const [batchProgress, setBatchProgress] = useState(null);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [batchJobIds, setBatchJobIds] = useState(null);
  const [completedResults, setCompletedResults] = useState(null);
  
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

  // Функция для отслеживания прогресса KV batch операций
  const trackKVBatchProgress = useCallback(async (jobIds, mode) => {
    if (!jobIds || jobIds.length === 0) return;
    
    console.log(`[PROGRESS] Начинаем отслеживание ${jobIds.length} задач в режиме ${mode}`);
    setBatchJobIds(jobIds);
    setShowProgressModal(true);
    
    const startTime = Date.now();
    let lastProgress = 0;
    
    const trackingInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/batch/status?jobIds=${jobIds.join(',')}&detailed=true`);
        const statusData = await response.json();
        
        if (response.ok && statusData.success) {
          const currentProgress = statusData.overallProgress || statusData.averageProgress || 0;
          const processed = Math.round((currentProgress / 100) * totalSkills);
          
          // Рассчитываем приблизительную скорость обработки
          const elapsedTime = (Date.now() - startTime) / 1000;
          const throughput = processed > 0 && elapsedTime > 0 ? (processed / elapsedTime).toFixed(1) : null;
          
          // Оценка оставшегося времени
          let estimatedTimeRemaining = null;
          if (currentProgress > lastProgress && currentProgress < 100) {
            const progressRate = (currentProgress - lastProgress) / 10; // Прогресс за 10 секунд
            if (progressRate > 0) {
              const remainingProgress = 100 - currentProgress;
              estimatedTimeRemaining = (remainingProgress / progressRate) * 10; // В секундах
            }
          }
          
          lastProgress = currentProgress;
          
          setBatchProgress({
            mode: mode,
            processed: processed,
            total: totalSkills,
            progress: currentProgress,
            completedJobs: statusData.completedJobs || 0,
            totalJobs: statusData.totalJobs || jobIds.length,
            activeJobs: statusData.processingJobs || statusData.activeJobs || 0,
            failedJobs: statusData.failedJobs || 0,
            estimatedTimeRemaining: estimatedTimeRemaining,
            throughput: throughput,
            message: statusData.isCompleted ? 
              `Обработка завершена! Успешно: ${statusData.completedJobs}/${statusData.totalJobs}` :
              statusData.processingJobs > 0 ? 
                `Обрабатывается ${statusData.processingJobs} задач...` :
                `Ожидание обработки...`,
            canCancel: false, // KV операции нельзя отменить
            timestamp: Date.now()
          });
          
          // Проверяем завершение
          if (statusData.isCompleted || statusData.completedJobs === statusData.totalJobs) {
            console.log('[PROGRESS] Все задачи завершены, загружаем результаты');
            clearInterval(trackingInterval);
            
            // Загружаем финальные результаты
            setTimeout(async () => {
              try {
                const resultsResponse = await fetch(`/api/batch/results?jobIds=${jobIds.join(',')}&format=summary`);
                if (resultsResponse.ok) {
                  const resultsData = await resultsResponse.json();
                  setCompletedResults(resultsData);
                  
                  setBatchProgress(prev => ({
                    ...prev,
                    message: `Завершено! Успешно: ${resultsData.summary?.successful || 0}/${resultsData.summary?.totalResults || 0}`,
                    progress: 100,
                    showResults: true
                  }));
                }
              } catch (resultsError) {
                console.error('[PROGRESS] Ошибка загрузки результатов:', resultsError.message);
              }
            }, 1000);
          }
        } else {
          console.error('[PROGRESS] Ошибка получения статуса:', statusData.error);
          
          // Если KV недоступно, останавливаем отслеживание
          if (statusData.error?.includes('KV')) {
            clearInterval(trackingInterval);
            setBatchProgress(prev => ({
              ...prev,
              message: 'Статус недоступен (KV отключено)',
              canCancel: false
            }));
          }
        }
      } catch (error) {
        console.error('[PROGRESS] Ошибка отслеживания:', error.message);
      }
    }, 10000); // Проверяем каждые 10 секунд (реже чем Redis версия)

    // Автоматическая остановка через 15 минут
    setTimeout(() => {
      clearInterval(trackingInterval);
      console.log('[PROGRESS] Отслеживание остановлено по таймауту');
    }, 15 * 60 * 1000);
  }, [totalSkills]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    
    if (scoreData.size === 0) {
      setSubmitMessage('❌ Необходимо оценить хотя бы один навык');
      return;
    }

    setSubmitting(true);
    setSubmitMessage('');
    setCompletedResults(null);
    
    try {
      // Преобразуем scoreData в формат операций для batch API
      const operations = Array.from(scoreData.entries()).map(([pageId, scoreInfo]) => {
        // Определяем поле для сохранения на основе роли
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

      console.log(`[SUBMIT] Отправляем ${operations.length} операций через новый KV batch API`);
      
      // Определяем оптимальные настройки на основе количества операций
      let batchOptions = {
        batchSize: 50,
        concurrency: 3,
        rateLimitDelay: 2000,
        maxRetries: 3
      };
      
      if (operations.length > 15) {
        // Для больших batch операций используем более консервативные настройки
        batchOptions = {
          batchSize: 75,
          concurrency: 2,
          rateLimitDelay: 2500,
          maxRetries: 4
        };
      } else if (operations.length < 5) {
        // Для маленьких batch операций используем более агрессивные настройки
        batchOptions = {
          batchSize: 25,
          concurrency: 4,
          rateLimitDelay: 1500,
          maxRetries: 3
        };
      }

        // Для больших пакетов принудительно используем Cloudflare KV
        if (operations.length > 5) {
          batchOptions.forceKV = true;
        }
      
      // Отправляем через новый batch API
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
        // Если используются KV очереди, показываем прогресс и начинаем отслеживание
        setSubmitMessage(`🔄 Операции добавлены в Cloudflare KV очередь. Создано ${result.totalJobs} задач для обработки ${result.totalOperations} операций.`);
        
        // Запускаем отслеживание прогресса
        trackKVBatchProgress(result.jobIds, result.mode);
        
      } else if (result.mode === 'direct_processing') {
        // Прямая обработка завершена немедленно
        const successRate = result.stats.totalOperations > 0 ? 
          (result.stats.successful / result.stats.totalOperations * 100).toFixed(1) : 0;
        
        setSubmitMessage(
          `✅ Прямая обработка завершена! ` +
          `Успешно: ${result.stats.successful}/${result.stats.totalOperations} (${successRate}%). ` +
          `Время: ${(result.stats.duration / 1000).toFixed(1)}с.`
        );
        
        // Показываем детали если есть ошибки
        if (result.stats.failed > 0) {
          const errorDetails = result.results
            .filter(r => r.status === 'error')
            .slice(0, 3)
            .map(r => r.error)
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
        errorMessage += ' (Попробуйте уменьшить количество операций для прямой обработки)';
      } else if (error.message.includes('rate limit') || error.message.includes('429')) {
        errorMessage = '❌ Превышен лимит запросов. Подождите и попробуйте снова.';
      } else if (error.message.includes('timeout')) {
        errorMessage = '❌ Тайм-аут операции. Попробуйте уменьшить размер пакета.';
      }
      
      setSubmitMessage(errorMessage);
    } finally {
      setSubmitting(false);
    }
  }, [scoreData, token, trackKVBatchProgress]);

  const handleCloseProgressModal = useCallback(() => {
    setShowProgressModal(false);
    setBatchProgress(null);
  }, []);

  const handleCancelBatch = useCallback(() => {
    // KV операции нельзя отменить, но можем скрыть модал
    setShowProgressModal(false);
    setSubmitMessage('⚠️ Операции продолжают обрабатываться в фоне');
  }, []);

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
                Оценивающий: {stats.reviewerName}
              </div>
            )}
            
            {/* Индикатор KV поддержки */}
            <div style={{
              marginTop: 12,
              fontSize: 13,
              color: '#6c757d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8
            }}>
              <span>🚀</span>
              <span>Поддержка Cloudflare KV для больших объемов</span>
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
            
            {/* Подсказка по размеру batch */}
            {ratedSkills > 0 && (
              <div style={{
                marginTop: 8,
                fontSize: 12,
                color: '#6c757d',
                textAlign: 'center'
              }}>
                {ratedSkills > 100 ? 
                  '🔄 Большой объем - будет использовано KV для оптимальной обработки' :
                  ratedSkills > 25 ?
                  '⚡ Средний объем - автоматический выбор режима обработки' :
                  '🚀 Небольшой объем - будет использована прямая обработка'
                }
              </div>
            )}
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

      {/* Модал прогресса KV batch операций */}
      <KVBatchProgressModal
        isOpen={showProgressModal}
        progress={batchProgress || {}}
        onClose={handleCloseProgressModal}
        onCancel={handleCancelBatch}
      />

      {!loading && (
        <div style={{
          textAlign: 'center',
          color: '#6c757d',
          fontSize: 12,
          paddingBottom: 24
        }}>
          Страница загрузилась за {loadTime.toFixed(2)} сек. | Поддержка Cloudflare KV
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