"use client";
import { memo, useCallback, useEffect, useRef, useState } from "react";

const clamp = (n) => Math.max(0, Math.min(5, Number.isFinite(n) ? Math.round(n) : 0));

// Оптимизированный debounce hook
function useDebounce(callback, delay = 200) {
  const timeoutRef = useRef();
  const callbackRef = useRef(callback);
  
  useEffect(() => {
    callbackRef.current = callback;
  });
  
  return useCallback((...args) => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args);
    }, delay);
  }, [delay]);
}

// Компонент оценочной шкалы
const ScoreScale = memo(({ value, onChange, skillName }) => {
  const levels = [
    { value: 0, label: 'Нет опыта', color: '#e9ecef', textColor: '#6c757d' },
    { value: 1, label: 'Базовый', color: '#fff3cd', textColor: '#856404' },
    { value: 2, label: 'Средний', color: '#cce5ff', textColor: '#004085' },
    { value: 3, label: 'Продвинутый', color: '#d4edda', textColor: '#155724' },
    { value: 4, label: 'Экспертный', color: '#e2d5f1', textColor: '#432846' },
    { value: 5, label: 'Ментор', color: '#d1ecf1', textColor: '#0c5460' }
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(6, 1fr)',
      gap: 6,
      marginTop: 8
    }}>
      {levels.map((level) => (
        <label
          key={level.value}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '8px 4px',
            borderRadius: 6,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            backgroundColor: value === level.value ? level.color : '#f8f9fa',
            color: value === level.value ? level.textColor : '#6c757d',
            border: value === level.value ? `2px solid ${level.textColor}` : '2px solid transparent',
            fontSize: 12,
            fontWeight: value === level.value ? 600 : 400,
            textAlign: 'center'
          }}
          onMouseEnter={(e) => {
            if (value !== level.value) {
              e.target.style.backgroundColor = level.color;
              e.target.style.color = level.textColor;
            }
          }}
          onMouseLeave={(e) => {
            if (value !== level.value) {
              e.target.style.backgroundColor = '#f8f9fa';
              e.target.style.color = '#6c757d';
            }
          }}
        >
          <input
            type="radio"
            name={`skill_${skillName}`}
            value={level.value}
            checked={value === level.value}
            onChange={() => onChange(level.value)}
            style={{ display: 'none' }}
            aria-label={`Оценка ${level.value} - ${level.label} для навыка ${skillName}`}
          />
          <div style={{
            fontSize: 16,
            fontWeight: 700,
            marginBottom: 2
          }}>
            {level.value}
          </div>
          <div style={{
            fontSize: 10,
            lineHeight: 1.2
          }}>
            {level.label}
          </div>
        </label>
      ))}
    </div>
  );
});

ScoreScale.displayName = 'ScoreScale';

// Основной компонент строки оценки
const ScoreRow = memo(({ item, onChange, hideComment = false }) => {
  const [val, setVal] = useState(() => clamp(item.current ?? 0));
  const [isDirty, setIsDirty] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  
  const debouncedChange = useDebounce(
    useCallback((newValue) => {
      onChange({ value: newValue });
      setIsDirty(false);
    }, [onChange]),
    300
  );
  
  const handleValueChange = useCallback((newVal) => {
    const clampedVal = clamp(newVal);
    setVal(clampedVal);
    setIsDirty(true);
    debouncedChange(clampedVal);
  }, [debouncedChange]);
  
  // Уведомляем родителя о начальных значениях
  useEffect(() => {
    debouncedChange(val);
  }, []);
  
  // Проверяем, нужна ли кнопка "показать больше"
  const needsExpansion = item.description && item.description.length > 200;
  
  // Получаем информацию об уровне
  const getLevelInfo = (value) => {
    const levels = [
      { label: 'Нет опыта', description: 'Навык отсутствует или минимальный опыт' },
      { label: 'Базовый', description: 'Начальное понимание, требуется помощь' },
      { label: 'Средний', description: 'Самостоятельная работа с базовыми задачами' },
      { label: 'Продвинутый', description: 'Уверенное владение, сложные задачи' },
      { label: 'Экспертный', description: 'Глубокие знания, может обучать других' },
      { label: 'Ментор', description: 'Эксперт высшего уровня, ведет направление' }
    ];
    return levels[value] || levels[0];
  };

  const currentLevel = getLevelInfo(val);
  
  return (
    <div style={{
      padding: "16px 20px",
      borderBottom: "1px solid #f1f3f4",
      backgroundColor: isDirty ? "#f8f9fa" : "transparent",
      transition: "all 0.2s ease",
      position: 'relative'
    }}>
      {/* Индикатор изменений */}
      {isDirty && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          backgroundColor: '#007bff',
          borderRadius: '0 2px 2px 0'
        }} />
      )}

      {/* Информация о навыке */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ 
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 8
        }}>
          <h4 style={{ 
            fontWeight: 600, 
            lineHeight: 1.3,
            fontSize: "16px",
            margin: 0,
            color: "#2c3e50",
            flex: 1
          }}>
            {item.name}
          </h4>
          
          {/* Текущая оценка */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginLeft: 16
          }}>
            <div style={{
              backgroundColor: val > 0 ? '#e3f2fd' : '#f5f5f5',
              color: val > 0 ? '#1976d2' : '#757575',
              padding: '4px 12px',
              borderRadius: 16,
              fontSize: 14,
              fontWeight: 600,
              minWidth: 60,
              textAlign: 'center'
            }}>
              {val}/5
            </div>
          </div>
        </div>
        
        {/* Описание навыка */}
        {item.description && (
          <div>
            <div 
              style={{
                color: "#666", 
                fontSize: "14px", 
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordWrap: "break-word",
                overflow: "hidden",
                ...(needsExpansion && !isExpanded && {
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                })
              }}
              title={item.description}
            >
              {item.description}
            </div>
            {needsExpansion && (
              <button
                style={{
                  background: "none",
                  border: "none",
                  color: "#007bff",
                  cursor: "pointer",
                  fontSize: "12px",
                  marginTop: "4px",
                  padding: "2px 0",
                  textDecoration: "underline",
                  fontWeight: 500
                }}
                onClick={() => setIsExpanded(!isExpanded)}
                type="button"
              >
                {isExpanded ? "↑ Свернуть" : "↓ Показать полностью"}
              </button>
            )}
          </div>
        )}
      </div>
      
      {/* Описание текущего уровня */}
      <div style={{
        backgroundColor: '#f8f9fa',
        padding: '8px 12px',
        borderRadius: 6,
        fontSize: 13,
        color: '#495057',
        marginBottom: 12,
        border: '1px solid #e9ecef'
      }}>
        <strong>{currentLevel.label}:</strong> {currentLevel.description}
      </div>
      
      {/* Оценочная шкала */}
      <ScoreScale 
        value={val}
        onChange={handleValueChange}
        skillName={item.name}
      />
      
      {/* Дополнительная информация */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 12,
        fontSize: 12,
        color: '#6c757d'
      }}>
        <div>
          {item.employeeName && (
            <span>Сотрудник: <strong>{item.employeeName}</strong></span>
          )}
        </div>
        <div>
          {isDirty && (
            <span style={{ color: '#007bff', fontWeight: 500 }}>
              ⏳ Сохранение...
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

ScoreRow.displayName = 'ScoreRow';

export default ScoreRow;