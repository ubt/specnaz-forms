"use client";
import { memo, useCallback } from "react";

const clamp = (n) => Math.max(0, Math.min(5, Number.isFinite(n) ? Math.round(n) : 0));

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

// Основной компонент строки оценки (упрощенный)
const ScoreRow = memo(({ item, onChange, hideComment = false, currentScore }) => {
  // Единственный источник истины - currentScore из родителя
  const value = currentScore !== undefined && currentScore !== null 
    ? clamp(currentScore) 
    : clamp(item.current ?? 0);
  
  const handleValueChange = useCallback((newVal) => {
    onChange({ value: clamp(newVal) });
  }, [onChange]);
  
  const scoreLabels = {
    0: "Нет опыта",
    1: "Начальный",
    2: "Базовый", 
    3: "Средний",
    4: "Продвинутый",
    5: "Эксперт"
  };

  return (
    <div style={{
      padding: '5px 24px',
      borderBottom: '1px solid #f1f3f4',
      backgroundColor: 'white',
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
                currentValue={value}
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
            fontSize: 10,
            color: '#6c757d',
            textAlign: 'center',
            width: '100%'
          }}>
            {Object.values(scoreLabels).map((label, index) => (
              <div key={index} style={{
                fontWeight: value === index ? 600 : 400,
                color: value === index ? '#495057' : '#6c757d'
              }}>
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

ScoreRow.displayName = 'ScoreRow';

export default ScoreRow;