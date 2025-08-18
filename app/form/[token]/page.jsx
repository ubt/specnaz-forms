'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import ScoreRow from '@/components/ScoreRow';

// Компонент загрузки
const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-screen bg-gray-50">
    <div className="text-center">
      <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto"></div>
      <p className="mt-6 text-gray-700 text-lg">Загружаем данные для оценки...</p>
      <p className="mt-2 text-gray-500 text-sm">Это может занять несколько секунд</p>
    </div>
  </div>
);

// Компонент ошибки
const ErrorDisplay = ({ error, onRetry }) => (
  <div className="flex items-center justify-center min-h-screen bg-gray-50">
    <div className="text-center max-w-lg p-8">
      <div className="text-red-500 text-6xl mb-6">⚠️</div>
      <h3 className="text-2xl font-semibold text-gray-800 mb-4">
        Ошибка загрузки данных
      </h3>
      <p className="text-gray-600 mb-6 leading-relaxed">{error}</p>
      <button
        onClick={onRetry}
        className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-3 rounded-lg transition-colors duration-200 shadow-md"
      >
        Попробовать снова
      </button>
      <p className="mt-4 text-sm text-gray-500">
        Если проблема повторяется, обратитесь к администратору
      </p>
    </div>
  </div>
);

// Компонент пустого состояния
const EmptyState = ({ reviewerInfo }) => (
  <div className="flex items-center justify-center min-h-screen bg-gray-50">
    <div className="text-center max-w-lg p-8">
      <div className="text-gray-400 text-6xl mb-6">📋</div>
      <h3 className="text-2xl font-semibold text-gray-800 mb-4">
        Навыки для оценки не найдены
      </h3>
      <p className="text-gray-600 mb-4">
        Здравствуйте, <strong>{reviewerInfo?.name || 'Ревьюер'}</strong>!
      </p>
      <p className="text-gray-600 leading-relaxed">
        В данный момент нет навыков, которые вам необходимо оценить. 
        Возможно, все оценки уже завершены или данные ещё не настроены в системе.
      </p>
      <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
        <p className="text-sm text-blue-800">
          💡 Если вы ожидали увидеть навыки для оценки, обратитесь к администратору для проверки настроек матрицы компетенций.
        </p>
      </div>
    </div>
  </div>
);

// Хук для работы с данными формы
function useFormData(token) {
  const [state, setState] = useState({
    data: null,
    loading: true,
    error: null,
    scores: new Map(),
    saving: false
  });

  const loadData = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      console.log('🔄 Загружаем данные для токена:', token?.substring(0, 10) + '...');
      
      const response = await fetch(`/api/form/${token}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Неизвестная ошибка сервера' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ Данные получены:', result);

      if (!result.success) {
        throw new Error(result.error || 'Не удалось получить данные');
      }

      setState(prev => ({
        ...prev,
        data: result.data,
        loading: false,
        error: null
      }));

    } catch (error) {
      console.error('❌ Ошибка загрузки:', error);
      setState(prev => ({
        ...prev,
        error: error.message,
        loading: false,
        data: null
      }));
    }
  }, [token]);

  const updateScore = useCallback((pageId, data) => {
    setState(prev => {
      const newScores = new Map(prev.scores);
      newScores.set(pageId, data);
      return { ...prev, scores: newScores };
    });
  }, []);

  const saveScores = useCallback(async () => {
    if (state.scores.size === 0) {
      alert('Необходимо оценить хотя бы один навык');
      return;
    }

    setState(prev => ({ ...prev, saving: true }));

    try {
      const items = Array.from(state.scores.entries()).map(([pageId, data]) => ({
        pageId,
        value: data.value
      }));

      console.log('💾 Сохраняем оценки:', items.length, 'элементов');

      const response = await fetch(`/api/form/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, mode: 'final' })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Ошибка сохранения');
      }

      const result = await response.json();
      console.log('✅ Сохранение завершено:', result);

      if (result.success) {
        alert(`✅ Успешно сохранено ${result.updated} оценок!`);
        // Очищаем оценки после успешного сохранения
        setState(prev => ({ ...prev, scores: new Map() }));
      } else {
        throw new Error('Сервер вернул неуспешный статус');
      }

    } catch (error) {
      console.error('❌ Ошибка сохранения:', error);
      alert(`❌ Ошибка сохранения: ${error.message}`);
    } finally {
      setState(prev => ({ ...prev, saving: false }));
    }
  }, [state.scores, token]);

  useEffect(() => {
    if (token) {
      loadData();
    }
  }, [token, loadData]);

  return {
    ...state,
    updateScore,
    saveScores,
    retryLoad: loadData
  };
}

// Главный компонент
export default function OptimizedSkillAssessmentForm({ params }) {
  const { token } = params;
  const { data, loading, error, scores, saving, updateScore, saveScores, retryLoad } = useFormData(token);

  // Группировка навыков по сотрудникам
  const groupedSkills = useMemo(() => {
    if (!data?.rows) return {};
    
    const groups = {};
    for (const row of data.rows) {
      const key = `${row.employeeId}_${row.employeeName}`;
      if (!groups[key]) {
        groups[key] = {
          employeeName: row.employeeName,
          employeeId: row.employeeId,
          role: row.role,
          skills: []
        };
      }
      groups[key].skills.push(row);
    }
    
    return groups;
  }, [data?.rows]);

  // Обработчики состояний
  if (loading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return <ErrorDisplay error={error} onRetry={retryLoad} />;
  }

  if (!data?.rows?.length) {
    return <EmptyState reviewerInfo={data?.reviewerInfo} />;
  }

  const reviewerInfo = data.reviewerInfo;
  const stats = data.stats;
  const groupEntries = Object.entries(groupedSkills);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Заголовок с информацией о ревьюере */}
        <div className="bg-white rounded-xl shadow-lg p-8 mb-8 border border-gray-200">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                📋 Форма оценки компетенций
              </h1>
              <p className="text-lg text-gray-600 mb-4">
                Здравствуйте, <span className="font-semibold text-blue-600">{reviewerInfo?.name || 'Ревьюер'}</span>!
              </p>
              <p className="text-gray-600">
                Оцените навыки коллег по шкале от 0 до 5, где 5 — экспертный уровень
              </p>
            </div>
            
            <div className="mt-6 lg:mt-0 lg:text-right">
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
                <div className="text-sm text-gray-600 space-y-1">
                  <div><strong>Всего навыков:</strong> {stats?.totalSkills || 0}</div>
                  <div><strong>Сотрудников:</strong> {stats?.totalEmployees || 0}</div>
                  <div><strong>Оценено:</strong> {scores.size}</div>
                  <div><strong>Ваша роль:</strong> {reviewerInfo?.role || 'peer'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Прогресс-бар */}
          <div className="mt-6">
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span>Прогресс оценки</span>
              <span>{scores.size} из {stats?.totalSkills || 0}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div 
                className="bg-gradient-to-r from-blue-500 to-indigo-600 h-3 rounded-full transition-all duration-300"
                style={{ 
                  width: `${stats?.totalSkills ? (scores.size / stats.totalSkills) * 100 : 0}%` 
                }}
              />
            </div>
          </div>
        </div>

        {/* Информация о сотрудниках */}
        {stats?.employees && stats.employees.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-8 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">
              👥 Сотрудники для оценки ({stats.employees.length})
            </h3>
            <div className="flex flex-wrap gap-3">
              {stats.employees.map((emp, index) => (
                <div key={index} className="bg-gray-100 px-3 py-2 rounded-lg text-sm">
                  <strong>{emp.name}</strong> 
                  <span className="text-gray-600 ml-2">({emp.role})</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Список навыков по сотрудникам */}
        <div className="space-y-8">
          {groupEntries.map(([key, group]) => (
            <div key={key} className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
              <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-800">
                  👤 {group.employeeName}
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  Роль: {group.role} • Навыков: {group.skills.length}
                </p>
              </div>
              
              <div className="divide-y divide-gray-200">
                {group.skills.map((skill) => (
                  <ScoreRow
                    key={skill.pageId}
                    item={{
                      pageId: skill.pageId,
                      name: skill.name,
                      description: skill.description,
                      current: skill.current
                    }}
                    onChange={(data) => updateScore(skill.pageId, data)}
                    hideComment={true}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Кнопка сохранения */}
        <div className="mt-8 bg-white rounded-xl shadow-lg p-6 border border-gray-200">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-gray-700 font-medium">
                Готовы отправить оценки?
              </p>
              <p className="text-sm text-gray-600 mt-1">
                Оценено {scores.size} из {stats?.totalSkills || 0} навыков
              </p>
            </div>
            
            <button
              onClick={saveScores}
              disabled={saving || scores.size === 0}
              className={`px-8 py-3 rounded-lg font-semibold text-white transition-all duration-200 shadow-md ${
                saving || scores.size === 0
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transform hover:scale-105'
              }`}
            >
              {saving ? (
                <span className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Сохраняем...
                </span>
              ) : (
                `💾 Сохранить оценки (${scores.size})`
              )}
            </button>
          </div>
          
          {scores.size === 0 && (
            <p className="text-amber-600 text-sm mt-3 bg-amber-50 p-3 rounded-lg border border-amber-200">
              ⚠️ Необходимо оценить хотя бы один навык перед сохранением
            </p>
          )}
        </div>

        {/* Дополнительная информация */}
        {stats?.loadTimeMs && (
          <div className="mt-6 text-center text-xs text-gray-500">
            Данные загружены за {stats.loadTimeMs} мс
          </div>
        )}
      </div>
    </div>
  );
}