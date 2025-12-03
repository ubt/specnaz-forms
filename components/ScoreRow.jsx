"use client";
import { memo, useCallback } from "react";

const clamp = (n) => Math.max(0, Math.min(5, Number.isFinite(n) ? Math.round(n) : 0));

// Кнопка оценки
const ScoreButton = memo(({ value, currentValue, onSelect, label }) => {
  const isSelected = currentValue === value;
  
  const colors = {
    0: { bg: '#f8d7da', border: '#dc3545', color: '#721c24' },
    1: { bg: '#fff3cd', border: '#ffc107', color: '#856404' },
    2: { bg: '#cce7ff', border: '#007bff', color: '#004085' },
    3: { bg: '#d4edda', border: '#28a745', color: '#155724' },
    4: { bg: '#e2e3ff', border: '#6f42c1', color: '#4a154b' },
    5: { bg: '#f8e8ff', border: '#e83e8c', color: '#83104e' }
  };
  
  const colorScheme = colors[value] || colors[0];

  return (
    <button
      type="button"
      className="score-button"
      style={{
        width: 44,
        height: 44,
        borderRadius: 8,
        border: '2px solid',
        backgroundColor: isSelected ? colorScheme.bg : 'white',
        borderColor: isSelected ? colorScheme.border : '#dee2e6',
        color: isSelected ? colorScheme.color : '#6c757d',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        fontSize: 16,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
      onClick={() => onSelect(value)}
      title={label}
    >
      {value}
    </button>
  );
});

ScoreButton.displayName = 'ScoreButton';

// Основной компонент
const ScoreRow = memo(({ item, onChange, currentScore }) => {
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
      padding: '12px 24px',
      borderBottom: '1px solid #f1f3f4',
      backgroundColor: 'white'
    }}>
      {/* Название */}
      <h4 style={{
        fontSize: 16,
        fontWeight: 600,
        lineHeight: 1.3,
        marginBottom: 8,
        color: '#2c3e50'
      }}>
        {item.name}
      </h4>

      {/* Контент */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 24,
        flexWrap: 'wrap'
      }}>
        {/* Описание */}
        <div style={{ flex: 1, minWidth: 200 }}>
          {item.description && (
            <div style={{
              color: '#495057',
              fontSize: 14,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap'
            }}>
              {item.description}
            </div>
          )}
        </div>

        {/* Шкала */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 8,
          minWidth: 320
        }}>
          {/* Кнопки */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 8,
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

          {/* Подписи */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 8,
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
