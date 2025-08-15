"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

const clamp = (n) => Math.max(0, Math.min(5, Number.isFinite(n) ? Math.round(n) : 0));

// Оптимизированный debounce hook
function useOptimizedDebounce(callback, delay = 200, deps = []) {
  const timeoutRef = useRef();
  const callbackRef = useRef(callback);
  
  // Обновляем callback без сброса таймера
  useEffect(() => {
    callbackRef.current = callback;
  });
  
  return useCallback((...args) => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args);
    }, delay);
  }, [delay, ...deps]);
}

// Мемоизированный компонент для одной строки оценки
const ScoreRowOptimized = memo(({ item, onChange, index, hideComment = false }) => {
  const [val, setVal] = useState(() => clamp(item.current ?? 0));
  const [isDirty, setIsDirty] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  
  const debouncedChange = useOptimizedDebounce(
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
  }, []); // Только при монтировании
  
  // Проверяем, нужна ли кнопка "показать больше"
  const needsExpansion = item.description && item.description.length > 150;
  
  const styles = useMemo(() => ({
    container: {
      display: "grid",
      gridTemplateColumns: hideComment ? "2fr 140px 80px" : "2fr 140px 80px 1fr",
      alignItems: "start", // Изменили на start для лучшего выравнивания
      padding: "16px 8px", // Увеличили padding
      borderBottom: "1px solid #eee",
      backgroundColor: isDirty ? "#f8f9fa" : "transparent",
      transition: "background-color 0.2s ease",
      gap: "16px", // Увеличили gap
      minHeight: "60px" // Минимальная высота для комфорта
    },
    skillInfo: {
      display: "flex",
      flexDirection: "column",
      minWidth: 0, // Важно для правильного wrapping текста
      maxWidth: "100%" // Обеспечиваем использование всего доступного пространства
    },
    title: { 
      fontWeight: 600, 
      lineHeight: 1.3,
      fontSize: "15px", // Чуть увеличили шрифт
      marginBottom: "8px",
      color: "#2c3e50"
    },
    description: { 
      color: "#666", 
      fontSize: "13px", 
      lineHeight: 1.5, // Улучшили межстрочный интервал
      whiteSpace: "pre-wrap",
      wordWrap: "break-word",
      wordBreak: "break-word", // Добавили для длинных слов
      overflow: "hidden",
      maxWidth: "100%"
    },
    descriptionCollapsed: {
      display: "-webkit-box",
      WebkitLineClamp: 3,
      WebkitBoxOrient: "vertical",
    },
    descriptionExpanded: {
      display: "block"
    },
    expandButton: {
      background: "none",
      border: "none",
      color: "#007bff",
      cursor: "pointer",
      fontSize: "12px",
      marginTop: "4px",
      padding: "2px 0",
      textDecoration: "underline",
      alignSelf: "flex-start"
    },
    controlsContainer: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "8px",
      paddingTop: "4px" // Небольшой отступ сверху для выравнивания
    },
    numberInput: { 
      width: 70, 
      padding: "8px 10px", // Увеличили padding
      border: "1px solid #ddd",
      borderRadius: "6px", // Скругли углы
      fontSize: "14px",
      textAlign: "center",
      fontWeight: "600"
    },
    slider: {
      width: "120px", // Увеличили ширину слайдера
      height: "6px", // Увеличили высоту
      margin: "8px 0",
      background: "#e9ecef",
      borderRadius: "3px",
      outline: "none",
      cursor: "pointer"
    }
  }), [isDirty, hideComment, isDescriptionExpanded]);
  
  return (
    <div style={styles.container}>
      <div style={styles.skillInfo}>
        <div style={styles.title}>{item.name}</div>
        {item.description && (
          <div>
            <div 
              style={{
                ...styles.description,
                ...(needsExpansion && !isDescriptionExpanded 
                  ? styles.descriptionCollapsed 
                  : styles.descriptionExpanded)
              }}
              title={item.description} // Показываем полное описание в tooltip
            >
              {item.description}
            </div>
            {needsExpansion && (
              <button
                style={styles.expandButton}
                onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                type="button"
              >
                {isDescriptionExpanded ? "↑ Свернуть" : "↓ Показать полностью"}
              </button>
            )}
          </div>
        )}
      </div>
      
      <div style={styles.controlsContainer}>
        <input
          type="range"
          min={0}
          max={5}
          step={1}
          value={val}
          style={styles.slider}
          onChange={(e) => handleValueChange(Number(e.target.value))}
          aria-label={`Оценка для ${item.name}`}
        />
        
        <input
          type="number"
          min={0}
          max={5}
          value={val}
          style={styles.numberInput}
          onChange={(e) => handleValueChange(Number(e.target.value))}
          aria-label={`Числовая оценка для ${item.name}`}
        />
      </div>
    </div>
  );
});

ScoreRowOptimized.displayName = 'ScoreRowOptimized';

// Виртуализированный список для больших объемов данных
const VirtualizedScoreList = memo(({ items, onChange, containerHeight = 600 }) => {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef();
  
  const ITEM_HEIGHT = 100; // Увеличили высоту элемента
  const BUFFER_SIZE = 5; // Количество элементов для предварительной загрузки
  
  const visibleRange = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_SIZE);
    const end = Math.min(
      items.length - 1,
      Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + BUFFER_SIZE
    );
    return { start, end };
  }, [scrollTop, containerHeight, items.length]);
  
  const handleScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop);
  }, []);
  
  const visibleItems = useMemo(() => {
    const result = [];
    for (let i = visibleRange.start; i <= visibleRange.end; i++) {
      if (items[i]) {
        result.push({ ...items[i], index: i });
      }
    }
    return result;
  }, [items, visibleRange]);
  
  if (items.length <= 50) {
    // Для небольших списков виртуализация не нужна
    return (
      <div style={{ display: "grid", gap: 0 }}>
        {items.map((item, index) => (
          <ScoreRowOptimized
            key={item.pageId}
            item={item}
            index={index}
            onChange={onChange(item.pageId)}
          />
        ))}
      </div>
    );
  }
  
  return (
    <div
      ref={containerRef}
      style={{
        height: containerHeight,
        overflow: "auto",
        border: "1px solid #ddd",
        borderRadius: "6px"
      }}
      onScroll={handleScroll}
    >
      {/* Spacer для правильного отображения скроллбара */}
      <div style={{ height: visibleRange.start * ITEM_HEIGHT }} />
      
      {/* Видимые элементы */}
      <div>
        {visibleItems.map((item) => (
          <ScoreRowOptimized
            key={item.pageId}
            item={item}
            index={item.index}
            onChange={onChange(item.pageId)}
          />
        ))}
      </div>
      
      {/* Spacer для правильного отображения скроллбара */}
      <div 
        style={{ 
          height: (items.length - visibleRange.end - 1) * ITEM_HEIGHT 
        }} 
      />
    </div>
  );
});

VirtualizedScoreList.displayName = 'VirtualizedScoreList';

// Экспортируем оптимизированный компонент
export default ScoreRowOptimized;
export { VirtualizedScoreList };