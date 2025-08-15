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
    150
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
  const needsExpansion = item.description && item.description.length > 150;
  
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "2fr 120px 60px",
      alignItems: "start",
      padding: "12px 8px",
      borderBottom: "1px solid #eee",
      backgroundColor: isDirty ? "#f8f9fa" : "transparent",
      transition: "background-color 0.2s ease",
      gap: "12px",
      minHeight: "60px"
    }}>
      {/* Информация о навыке */}
      <div style={{ minWidth: 0 }}>
        <div style={{ 
          fontWeight: 600, 
          lineHeight: 1.3,
          fontSize: "14px",
          marginBottom: "6px",
          color: "#2c3e50"
        }}>
          {item.name}
        </div>
        
        {item.description && (
          <div>
            <div 
              style={{
                color: "#666", 
                fontSize: "12px", 
                lineHeight: 1.4,
                whiteSpace: "pre-wrap",
                wordWrap: "break-word",
                overflow: "hidden",
                ...(needsExpansion && !isExpanded && {
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
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
                  fontSize: "11px",
                  marginTop: "2px",
                  padding: "1px 0",
                  textDecoration: "underline"
                }}
                onClick={() => setIsExpanded(!isExpanded)}
                type="button"
              >
                {isExpanded ? "↑ Свернуть" : "↓ Еще"}
              </button>
            )}
          </div>
        )}
      </div>
      
      {/* Слайдер */}
      <input
        type="range"
        min={0}
        max={5}
        step={1}
        value={val}
        style={{
          width: "100%",
          height: "4px",
          background: "#e9ecef",
          borderRadius: "2px",
          outline: "none",
          cursor: "pointer",
          alignSelf: "center"
        }}
        onChange={(e) => handleValueChange(Number(e.target.value))}
        aria-label={`Оценка для ${item.name}`}
      />
      
      {/* Числовое поле */}
      <input
        type="number"
        min={0}
        max={5}
        value={val}
        style={{ 
          width: 50, 
          padding: "6px 8px",
          border: "1px solid #ddd",
          borderRadius: "4px",
          fontSize: "13px",
          textAlign: "center",
          fontWeight: "600"
        }}
        onChange={(e) => handleValueChange(Number(e.target.value))}
        aria-label={`Числовая оценка для ${item.name}`}
      />
    </div>
  );
});

ScoreRow.displayName = 'ScoreRow';

export default ScoreRow;