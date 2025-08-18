"use client";
import { memo, useCallback, useEffect, useRef, useState } from "react";

const clamp = (n) => Math.max(0, Math.min(5, Number.isFinite(n) ? Math.round(n) : 0));

// Оптимизированный debounce hook
function useOptimizedDebounce(callback, delay = 100) {
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

// Оптимизированный компонент строки оценки с широким описанием
const FixedScoreRow = memo(({ item, onChange, hideComment = true }) => {
  const [val, setVal] = useState(() => clamp(item.current ?? 0));
  const [isDirty, setIsDirty] = useState(false);
  
  const debouncedChange = useOptimizedDebounce(
    useCallback((newValue) => {
      onChange({ value: newValue });
      setIsDirty(false);
    }, [onChange]),
    100
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
  }, []); // Пустой массив зависимостей

  // Стили для компонента
  const containerStyle = {
    display: "grid",
    gridTemplateColumns: "1fr auto auto",
    alignItems: "start",
    padding: "20px 24px",
    borderBottom: "1px solid #e5e7eb",
    backgroundColor: isDirty ? "#f8fafc" : "transparent",
    transition: "background-color 0.2s ease",
    gap: "20px",
    minHeight: "100px"
  };

  const titleStyle = {
    fontWeight: 700,
    lineHeight: 1.4,
    fontSize: "16px",
    marginBottom: "12px",
    color: "#1f2937",
    wordBreak: "break-word"
  };

  // ШИРОКОЕ описание без кнопки "показать больше"
  const descriptionStyle = {
    color: "#4b5563",
    fontSize: "14px",
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordWrap: "break-word",
    maxWidth: "none", // Убираем ограничения ширины
    width: "100%",
    marginTop: "8px",
    padding: "12px",
    backgroundColor: "#f9fafb",
    borderRadius: "8px",
    border: "1px solid #e5e7eb"
  };

  const sliderStyle = {
    width: "160px",
    height: "8px",
    background: `linear-gradient(to right, 
      #ef4444 0%, #f97316 20%, #eab308 40%, #22c55e 60%, #3b82f6 80%, #8b5cf6 100%)`,
    borderRadius: "4px",
    outline: "none",
    cursor: "pointer",
    alignSelf: "center",
    appearance: "none",
    WebkitAppearance: "none"
  };

  const numberInputStyle = {
    width: "70px",
    padding: "10px 12px",
    border: "2px solid #e5e7eb",
    borderRadius: "8px",
    fontSize: "16px",
    textAlign: "center",
    fontWeight: "700",
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
      {/* Информация о навыке с ШИРОКИМ описанием */}
      <div style={{ minWidth: 0, width: "100%" }}>
        <div style={titleStyle}>
          {item.name}
        </div>
        
        {/* Текущий уровень с цветовой индикацией */}
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          backgroundColor: getLevelColor(val),
          color: "white",
          padding: "6px 14px",
          borderRadius: "16px",
          fontSize: "13px",
          fontWeight: "700",
          marginBottom: item.description ? "12px" : "0",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
        }}>
          <span style={{ marginRight: "8px", fontSize: "16px" }}>{val}</span>
          <span>{getLevelText(val)}</span>
        </div>
        
        {/* ШИРОКОЕ описание навыка БЕЗ кнопки "показать больше" */}
        {item.description && (
          <div style={descriptionStyle}>
            {item.description}
          </div>
        )}
      </div>
      
      {/* Слайдер с улучшенным стилем */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
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
        <div style={{ 
          fontSize: "12px", 
          color: "#6b7280", 
          fontWeight: "600",
          textAlign: "center"
        }}>
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

FixedScoreRow.displayName = 'FixedScoreRow';

export default FixedScoreRow;