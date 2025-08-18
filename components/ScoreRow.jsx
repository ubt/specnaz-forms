"use client";
import { memo, useCallback, useEffect, useRef, useState } from "react";

const clamp = (n) => Math.max(0, Math.min(5, Number.isFinite(n) ? Math.round(n) : 0));

// Мемоизированный debounce hook с улучшенной производительностью
function useOptimizedDebounce(callback, delay = 150) {
  const timeoutRef = useRef();
  const callbackRef = useRef(callback);
  
  // Обновляем коллбэк без пересоздания функции
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

// Оптимизированный компонент строки оценки
const OptimizedScoreRow = memo(({ item, onChange, hideComment = true }) => {
  const [val, setVal] = useState(() => clamp(item.current ?? 0));
  const [isDirty, setIsDirty] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  
  const debouncedChange = useOptimizedDebounce(
    useCallback((newValue) => {
      onChange({ value: newValue });
      setIsDirty(false);
    }, [onChange]),
    100 // Уменьшена задержка для более отзывчивого UX
  );
  
  const handleValueChange = useCallback((newVal) => {
    const clampedVal = clamp(newVal);
    setVal(clampedVal);
    setIsDirty(true);
    debouncedChange(clampedVal);
  }, [debouncedChange]);
  
  // Инициализация значения только один раз
  useEffect(() => {
    if (item.current !== undefined && item.current !== null) {
      const initialValue = clamp(item.current);
      setVal(initialValue);
      debouncedChange(initialValue);
    }
  }, []); // Пустой массив зависимостей для выполнения только при монтировании
  
  // Мемоизированная проверка необходимости кнопки "показать больше"
  const needsExpansion = item.description && item.description.length > 200;
  
  // Мемоизированные стили для предотвращения пересоздания объектов
  const containerStyle = {
    display: "grid",
    gridTemplateColumns: "1fr auto auto",
    alignItems: "start",
    padding: "16px 20px",
    borderBottom: "1px solid #e5e7eb",
    backgroundColor: isDirty ? "#f8fafc" : "transparent",
    transition: "background-color 0.2s ease",
    gap: "16px",
    minHeight: "80px"
  };

  const titleStyle = {
    fontWeight: 600,
    lineHeight: 1.4,
    fontSize: "15px",
    marginBottom: "8px",
    color: "#1f2937",
    wordBreak: "break-word"
  };

  const descriptionStyle = {
    color: "#6b7280",
    fontSize: "13px",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    wordWrap: "break-word",
    ...(needsExpansion && !isExpanded && {
      display: "-webkit-box",
      WebkitLineClamp: 3,
      WebkitBoxOrient: "vertical",
      overflow: "hidden"
    })
  };

  const sliderStyle = {
    width: "140px",
    height: "6px",
    background: `linear-gradient(to right, 
      #ef4444 0%, #f97316 20%, #eab308 40%, #22c55e 60%, #3b82f6 80%, #8b5cf6 100%)`,
    borderRadius: "3px",
    outline: "none",
    cursor: "pointer",
    alignSelf: "center",
    appearance: "none",
    WebkitAppearance: "none"
  };

  const numberInputStyle = {
    width: "60px",
    padding: "8px 10px",
    border: "2px solid #e5e7eb",
    borderRadius: "6px",
    fontSize: "14px",
    textAlign: "center",
    fontWeight: "600",
    color: "#374151",
    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
    alignSelf: "center"
  };

  // Цветовая индикация уровня
  const getLevelColor = (value) => {
    const colors = [
      "#9ca3af", // 0 - серый
      "#ef4444", // 1 - красный  
      "#f97316", // 2 - оранжевый
      "#eab308", // 3 - желтый
      "#22c55e", // 4 - зеленый
      "#8b5cf6"  // 5 - фиолетовый
    ];
    return colors[value] || colors[0];
  };

  const getLevelText = (value) => {
    const levels = [
      "Нет опыта",
      "Начальный",
      "Базовый", 
      "Средний",
      "Продвинутый",
      "Экспертный"
    ];
    return levels[value] || levels[0];
  };

  return (
    <div style={containerStyle}>
      {/* Информация о навыке */}
      <div style={{ minWidth: 0 }}>
        <div style={titleStyle}>
          {item.name}
        </div>
        
        {/* Текущий уровень с цветовой индикацией */}
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          backgroundColor: getLevelColor(val),
          color: "white",
          padding: "4px 10px",
          borderRadius: "12px",
          fontSize: "12px",
          fontWeight: "600",
          marginBottom: item.description ? "8px" : "0"
        }}>
          <span style={{ marginRight: "6px" }}>{val}</span>
          <span>{getLevelText(val)}</span>
        </div>
        
        {item.description && (
          <div>
            <div style={descriptionStyle} title={item.description}>
              {item.description}
            </div>
            {needsExpansion && (
              <button
                style={{
                  background: "none",
                  border: "none",
                  color: "#3b82f6",
                  cursor: "pointer",
                  fontSize: "12px",
                  marginTop: "4px",
                  padding: "2px 0",
                  textDecoration: "none",
                  transition: "color 0.2s ease"
                }}
                onClick={() => setIsExpanded(!isExpanded)}
                type="button"
                onMouseEnter={(e) => e.target.style.textDecoration = "underline"}
                onMouseLeave={(e) => e.target.style.textDecoration = "none"}
              >
                {isExpanded ? "↑ Свернуть" : "↓ Показать полностью"}
              </button>
            )}
          </div>
        )}
      </div>
      
      {/* Слайдер с улучшенным стилем */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
        <input
          type="range"
          min={0}
          max={5}
          step={1}
          value={val}
          style={sliderStyle}
          onChange={(e) => handleValueChange(Number(e.target.value))}
          aria-label={`Оценка для ${item.name}`}
        />
        <div style={{ fontSize: "11px", color: "#6b7280", fontWeight: "500" }}>
          0 — 5
        </div>
      </div>
      
      {/* Числовое поле с улучшенным стилем */}
      <input
        type="number"
        min={0}
        max={5}
        value={val}
        style={{
          ...numberInputStyle,
          borderColor: isDirty ? "#3b82f6" : "#e5e7eb",
          boxShadow: isDirty ? "0 0 0 3px rgba(59, 130, 246, 0.1)" : "none"
        }}
        onChange={(e) => handleValueChange(Number(e.target.value))}
        onFocus={(e) => {
          e.target.style.borderColor = "#3b82f6";
          e.target.style.boxShadow = "0 0 0 3px rgba(59, 130, 246, 0.1)";
        }}
        onBlur={(e) => {
          if (!isDirty) {
            e.target.style.borderColor = "#e5e7eb";
            e.target.style.boxShadow = "none";
          }
        }}
        aria-label={`Числовая оценка для ${item.name}`}
      />
    </div>
  );
});

OptimizedScoreRow.displayName = 'OptimizedScoreRow';

export default OptimizedScoreRow;