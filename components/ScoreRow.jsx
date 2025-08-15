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
const ScoreRowOptimized = memo(({ item, onChange, index }) => {
  const [val, setVal] = useState(() => clamp(item.current ?? 0));
  const [comment, setComment] = useState(() => item.comment ?? "");
  const [isDirty, setIsDirty] = useState(false);
  
  const debouncedChange = useOptimizedDebounce(
    useCallback((newValue, newComment) => {
      onChange({ value: newValue, comment: newComment });
      setIsDirty(false);
    }, [onChange]),
    150
  );
  
  const handleValueChange = useCallback((newVal) => {
    const clampedVal = clamp(newVal);
    setVal(clampedVal);
    setIsDirty(true);
    debouncedChange(clampedVal, comment);
  }, [comment, debouncedChange]);
  
  const handleCommentChange = useCallback((newComment) => {
    setComment(newComment);
    setIsDirty(true);
    debouncedChange(val, newComment);
  }, [val, debouncedChange]);
  
  // Уведомляем родителя о начальных значениях
  useEffect(() => {
    debouncedChange(val, comment);
  }, []); // Только при монтировании
  
  const styles = useMemo(() => ({
    container: {
      display: "grid",
      gridTemplateColumns: "1fr 180px 90px 1fr",
      alignItems: "center",
      padding: "12px 8px",
      borderBottom: "1px solid #eee",
      backgroundColor: isDirty ? "#f8f9fa" : "transparent",
      transition: "background-color 0.2s ease"
    },
    title: { 
      fontWeight: 600, 
      lineHeight: 1.3,
      fontSize: "14px"
    },
    description: { 
      color: "#666", 
      fontSize: "12px", 
      marginTop: 4, 
      whiteSpace: "pre-wrap",
      maxHeight: "60px",
      overflow: "hidden"
    },
    numberInput: { 
      width: 70, 
      padding: "6px 8px",
      border: "1px solid #ddd",
      borderRadius: "4px",
      fontSize: "14px"
    },
    textInput: { 
      padding: "6px 8px",
      border: "1px solid #ddd",
      borderRadius: "4px",
      fontSize: "13px"
    },
    slider: {
      width: "100%",
      margin: "0 8px"
    }
  }), [isDirty]);
  
  return (
    <div style={styles.container}>
      <div>
        <div style={styles.title}>{item.name}</div>
        {item.description && (
          <div style={styles.description}>{item.description}</div>
        )}
      </div>
      
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
      
      <input
        placeholder="Комментарий (опционально)"
        value={comment}
        style={styles.textInput}
        onChange={(e) => handleCommentChange(e.target.value)}
        maxLength={2000}
        aria-label={`Комментарий для ${item.name}`}
      />
    </div>
  );
});

ScoreRowOptimized.displayName = 'ScoreRowOptimized';

// Виртуализированный список для больших объемов данных
const VirtualizedScoreList = memo(({ items, onChange, containerHeight = 600 }) => {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef();
  
  const ITEM_HEIGHT = 80; // Примерная высота одного элемента
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