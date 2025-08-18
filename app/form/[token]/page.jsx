'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

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
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Загрузка навыков для оценки...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center max-w-md">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h3 className="text-xl font-semibold text-gray-800 mb-2">
            Ошибка загрузки данных
          </h3>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={onRetry}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
          >
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center max-w-md">
          <div className="text-gray-400 text-6xl mb-4">📋</div>
          <h3 className="text-xl font-semibold text-gray-800 mb-2">
            Навыки не найдены
          </h3>
          <p className="text-gray-600">
            Проверьте конфигурацию оценки или обратитесь к администратору
          </p>
        </div>
      </div>
    );
  }

  return children;
};

/**
 * Компонент отдельного навыка
 */
const SkillItem = ({ skill, selectedLevel, onLevelChange }) => {
  const levels = [
    { value: 0, label: 'Нет опыта', color: 'bg-gray-200' },
    { value: 1, label: 'Базовый', color: 'bg-yellow-200' },
    { value: 2, label: 'Средний', color: 'bg-blue-200' },
    { value: 3, label: 'Продвинутый', color: 'bg-green-200' },
    { value: 4, label: 'Экспертный', color: 'bg-purple-200' }
  ];

  return (
    <div className="border rounded-lg p-4 bg-white shadow-sm">
      <h4 className="font-medium text-gray-800 mb-2">
        {skill.Название || skill.name || 'Название не указано'}
      </h4>
      
      {skill.Описание && (
        <p className="text-sm text-gray-600 mb-3">
          {skill.Описание}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {levels.map((level) => (
          <label
            key={level.value}
            className={`flex items-center cursor-pointer p-2 rounded border transition-all ${
              selectedLevel === level.value
                ? `${level.color} border-gray-400`
                : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
            }`}
          >
            <input
              type="radio"
              name={`skill_${skill.id}`}
              value={level.value}
              checked={selectedLevel === level.value}
              onChange={() => onLevelChange(level.value)}
              className="sr-only"
            />
            <span className="text-sm">{level.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
};

/**
 * Кастомный хук для управления данными навыков
 */
function useSkillsData(token) {
  const [state, setState] = useState({
    skills: [],
    loading: true,
    error: null,
    assessmentData: new Map() // Хранит оценки навыков
  });

  // Функция загрузки данных
  const fetchSkills = useCallback(async () => {
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
          errorData.error?.message || `HTTP ${response.status}: Ошибка сервера`
        );
      }

      const result = await response.json();
      console.log('Получен ответ от API:', result);

      if (!result.success) {
        throw new Error(result.error?.message || 'API вернул неуспешный статус');
      }

      if (!Array.isArray(result.data)) {
        throw new Error('API вернул некорректный формат данных');
      }

      console.log(`Загружено ${result.data.length} навыков`);
      
      setState(prev => ({ 
        ...prev, 
        skills: result.data, 
        loading: false,
        error: null
      }));
      
    } catch (error) {
      console.error('Ошибка загрузки навыков:', error);
      setState(prev => ({ 
        ...prev, 
        error: error.message, 
        loading: false,
        skills: []
      }));
    }
  }, [token]);

  // Функция изменения оценки навыка
  const updateSkillAssessment = useCallback((skillId, level) => {
    setState(prev => {
      const newAssessmentData = new Map(prev.assessmentData);
      newAssessmentData.set(skillId, level);
      return {
        ...prev,
        assessmentData: newAssessmentData
      };
    });
  }, []);

  // Загружаем данные при монтировании или изменении токена 
  useEffect(() => {
    if (token) {
      fetchSkills();
    }
  }, [token, fetchSkills]);

  // Предотвращаем утечки памяти при размонтировании 
  useEffect(() => {
    return () => {
      // Здесь можно добавить отмену активных запросов
      console.log('Компонент размонтирован, очищаем ресурсы');
    };
  }, []);

  return {
    ...state,
    updateSkillAssessment,
    refetch: fetchSkills
  };
}

/**
 * Главный компонент формы оценки навыков
 */
export default function SkillsAssessmentForm({ params }) {
  const { token } = params;
  
  // Используем кастомный хук для управления данными
  const {
    skills,
    loading,
    error,
    assessmentData,
    updateSkillAssessment,
    refetch
  } = useSkillsData(token);

  // Фильтрация и группировка навыков (мемоизированная для производительности) 
  const groupedSkills = useMemo(() => {
    if (!skills.length) return {};
    
    return skills.reduce((acc, skill) => {
      const category = skill.Категория || skill.category || 'Общие навыки';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(skill);
      return acc;
    }, {});
  }, [skills]);

  // Функция отправки формы
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    
    const assessmentResults = Array.from(assessmentData.entries()).map(([skillId, level]) => ({
      skillId,
      level,
      skill: skills.find(s => s.id === skillId)
    }));

    console.log('Отправка оценки:', assessmentResults);
    
    // Здесь можно добавить отправку данных на сервер
    try {
      // const response = await fetch('/api/submit-assessment', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ token, assessmentResults })
      // });
      
      alert(`Оценка завершена для ${assessmentResults.length} навыков!`);
    } catch (error) {
      console.error('Ошибка отправки:', error);
    }
  }, [assessmentData, skills, token]);

  return (
    <div className="min-h-screen bg-gray-50">
      <StateHandler 
        loading={loading} 
        error={error} 
        empty={skills.length === 0}
        onRetry={refetch}
      >
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <h1 className="text-2xl font-bold text-gray-800 mb-2">
              Форма оценки компетенций
            </h1>
            <p className="text-gray-600 mb-4">
              Оцените свой уровень владения следующими навыками
            </p>
            <div className="text-sm text-gray-500">
              Всего навыков: {skills.length} | 
              Оценено: {assessmentData.size} |
              Токен: {token}
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            {Object.entries(groupedSkills).map(([category, categorySkills]) => (
              <div key={category} className="mb-8">
                <h2 className="text-xl font-semibold text-gray-800 mb-4 border-b pb-2">
                  {category}
                </h2>
                <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
                  {categorySkills.map((skill) => (
                    <SkillItem
                      key={skill.id}
                      skill={skill}
                      selectedLevel={assessmentData.get(skill.id)}
                      onLevelChange={(level) => updateSkillAssessment(skill.id, level)}
                    />
                  ))}
                </div>
              </div>
            ))}

            <div className="bg-white rounded-lg shadow-lg p-6 mt-8">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-gray-600">
                    Прогресс: {assessmentData.size} из {skills.length} навыков оценено
                  </p>
                  <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{ 
                        width: `${skills.length > 0 ? (assessmentData.size / skills.length) * 100 : 0}%` 
                      }}
                    ></div>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={assessmentData.size === 0}
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  Отправить оценку
                </button>
              </div>
            </div>
          </form>
        </div>
      </StateHandler>
    </div>
  );
}