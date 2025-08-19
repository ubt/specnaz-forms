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

// Компонент кнопки оценки
const ScoreButton = memo(({ value, currentValue, onSelect, label }) => {
  const isSelected = currentValue === value;
  
  const getButtonStyle = () => {
    const baseStyle = {
      width: 44,
      height: 44,
      borderRadius: 8,
      border: '2px solid',
      backgroundColor: 'white',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      fontSize: 16,
      fontWeight: 600,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative'
    };

    if (isSelected) {
      const colors = {
        0: { bg: '#f8d7da', border: '#dc3545', color: '#721c24' },
        1: { bg: '#fff3cd', border: '#ffc107', color: '#856404' },
        2: { bg: '#cce7ff', border: '#007bff', color: '#004085' },
        3: { bg: '#d4edda', border: '#28a745', color: '#155724' },
        4: { bg: '#e2e3ff', border: '#6f42c1', color: '#4a154b' },
        5: { bg: '#f8e8ff', border: '#e83e8c', color: '#83104e' }
      };
      const colorScheme = colors[value] || colors[0];
      return {
        ...baseStyle,
        backgroundColor: colorScheme.bg,
        borderColor: colorScheme.border,
        color: colorScheme.color,
        boxShadow: `0 0 0 3px ${colorScheme.border}20`
      };
    } else {
      return {
        ...baseStyle,
        borderColor: '#dee2e6',
        color: '#6c757d'
      };
    }
  };

  return (
    <button
      type="button"
      className="score-button"
      style={getButtonStyle()}
      onClick={() => onSelect(value)}
      title={label}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.target.style.borderColor = '#adb5bd';
          e.target.style.backgroundColor = '#f8f9fa';
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.target.style.borderColor = '#dee2e6';
          e.target.style.backgroundColor = 'white';
        }
      }}
    >
      {value}
    </button>
  );
});

ScoreButton.displayName = 'ScoreButton';

// Основной компонент строки оценки с улучшенным дизайном
const ScoreRow = memo(({ item, onChange, hideComment = false }) => {
  const [val, setVal] = useState(() => clamp(item.current ?? 0));
  const [isDirty, setIsDirty] = useState(false);
  
  const debouncedChange = useDebounce(
    useCallback((newValue) => {
      onChange({ value: newValue });
      setIsDirty(false);
    }, [onChange]),
    150
  );
  
  const handleValueChange = useCallback((newVal) => {
    const clampedVal = clamp(newVal);
    setVal(clampedVal);
    setIsDirty(true);
    debouncedChange(clampedVal);
  }, [debouncedChange]);
  
  // Уведомление о начальных значениях убрано, чтобы прогресс оценок
  // начинался с нуля и учитывал только измененные пользователем навыки
  
  
  const scoreLabels = {
    0: "Нет опыта",
    1: "Начальный",
    2: "Базовый", 
    3: "Средний",
    4: "Продвинутый",
    5: "Экспертный"
  };

  return (
    <div style={{
      padding: '5px 24px',
      borderBottom: '1px solid #f1f3f4',
      backgroundColor: isDirty ? '#f8f9fa' : 'white',
      transition: 'background-color 0.2s ease'
    }}>
      {/* Название навыка */}
      <h4 style={{
        fontSize: 16,
        fontWeight: 600,
        lineHeight: 1.3,
        marginBottom: 8,
        color: '#2c3e50'
      }}>
        {item.name}
      </h4>

      {/* Контент: описание и шкала */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 24
      }}>
        {/* Описание навыка */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {item.description && (
            <div style={{
              marginBottom: 12,
              color: '#495057',
              fontSize: 14,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word'
            }}>
              {item.description}
            </div>
          )}

          {/* Текущее значение */}
          {val !== null && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              backgroundColor: '#e7f3ff',
              borderRadius: 16,
              fontSize: 13,
              fontWeight: 500,
              color: '#0066cc'
            }}>
              <span>Текущая оценка:</span>
              <span style={{ fontWeight: 600 }}>{val} - {scoreLabels[val]}</span>
            </div>
          )}
        </div>

        {/* Шкала оценки */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 12,
          width: 360
        }}>
          {/* Кнопки оценки */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 12,
            justifyItems: 'center',
            width: '100%'
          }}>
            {[0, 1, 2, 3, 4, 5].map((score) => (
              <ScoreButton
                key={score}
                value={score}
                currentValue={val}
                onSelect={handleValueChange}
                label={`${score} - ${scoreLabels[score]}`}
              />
            ))}
          </div>

          {/* Подписи для уровней */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 12,
            fontSize: 11,
            color: '#6c757d',
            textAlign: 'center',
            width: '100%'
          }}>
            {Object.values(scoreLabels).map((label, index) => (
              <div key={index} style={{
                fontWeight: val === index ? 600 : 400,
                color: val === index ? '#495057' : '#6c757d'
              }}>
                {label}
              </div>
            ))}
          </div>

        </div>
      </div>

      {/* Индикатор изменений */}
      {isDirty && (
        <div style={{
          marginTop: 12,
          padding: '6px 12px',
          backgroundColor: '#fff3cd',
          border: '1px solid #ffeaa7',
          borderRadius: 6,
          fontSize: 12,
          color: '#856404',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6
        }}>
          <span>⏳</span>
          <span>Сохранение изменений...</span>
        </div>
      )}
    </div>
  );
});

ScoreRow.displayName = 'ScoreRow';

export default ScoreRow;