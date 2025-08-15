"use client";
import { memo, useEffect, useMemo, useRef, useState, useCallback } from "react";

const clamp = (n) => Math.max(0, Math.min(5, Number.isFinite(n) ? Math.round(n) : 0));

function useDebouncedCallback(callback, delay = 200) {
  const timeoutRef = useRef();
  
  return useCallback((value) => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => callback(value), delay);
  }, [callback, delay]);
}

function ScoreRowInner({ item, onChange, initialValue }) {
  // Инициализируем состояние из переданных данных или текущих значений
  const [val, setVal] = useState(() => {
    if (initialValue?.value !== undefined) return clamp(initialValue.value);
    return clamp(item.current ?? 0);
  });
  
  const [comment, setComment] = useState(() => {
    if (initialValue?.comment !== undefined) return initialValue.comment;
    return item.comment ?? "";
  });
  
  const [isModified, setIsModified] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const debounced = useDebouncedCallback(onChange, 150);

  // Обновляем состояние при изменении item (например, при перезагрузке)
  useEffect(() => {
    if (!isModified && !initialValue) {
      setVal(clamp(item.current ?? 0));
      setComment(item.comment ?? "");
    }
  }, [item.current, item.comment, isModified, initialValue]);

  // Уведомляем родителя об изменениях
  const notifyChange = useCallback((newVal, newComment) => {
    const data = { value: newVal, comment: newComment };
    debounced(data);
    setIsModified(true);
  }, [debounced]);

  // Обработчик изменения оценки
  const handleValueChange = useCallback((newValue) => {
    const clampedValue = clamp(newValue);
    setVal(clampedValue);
    notifyChange(clampedValue, comment);
  }, [comment, notifyChange]);

  // Обработчик изменения комментария
  const handleCommentChange = useCallback((newComment) => {
    setComment(newComment);
    notifyChange(val, newComment);
  }, [val, notifyChange]);

  // Уведомляем об initial state при первом рендере
  useEffect(() => {
    if (!isModified) {
      debounced({ value: val, comment });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Определяем цвета для оценок
  const getScoreColor = (score) => {
    if (score === 0) return '#6c757d'; // Серый
    if (score <= 2) return '#dc3545'; // Красный
    if (score === 3) return '#ffc107'; // Желтый
    if (score === 4) return '#17a2b8'; // Синий
    return '#28a745'; // Зеленый
  };

  // Эмодзи для оценок
  const getScoreEmoji = (score) => {
    const emojis = ['❌', '😞', '😐', '🙂', '😊', '🎉'];
    return emojis[score] || '❓';
  };

  // Мемоизированные стили
  const wrapperStyle = useMemo(() => ({
    display: "grid",
    gridTemplateColumns: "1fr 200px 100px 1fr",
    alignItems: "center",
    padding: "16px 0",
    borderBottom: "1px solid #e9ecef",
    gap: "16px",
    transition: "background-color 0.2s ease",
    backgroundColor: isFocused ? "#f8f9fa" : isModified ? "#fff3cd" : "transparent",
    borderRadius: isFocused ? "6px" : "0",
    marginLeft: isFocused ? "-8px" : "0",
    marginRight: isFocused ? "-8px" : "0",
    paddingLeft: isFocused ? "24px" : "16px",
    paddingRight: isFocused ? "24px" : "16px",
  }), [isFocused, isModified]);

  const titleStyle = useMemo(() => ({
    fontWeight: 600,
    lineHeight: 1.3,
    fontSize: "16px",
    color: "#212529"
  }), []);

  const descStyle = useMemo(() => ({
    color: "#6c757d",
    fontSize: "14px",
    marginTop: "6px",
    whiteSpace: "pre-wrap",
    lineHeight: 1.4
  }), []);

  const sliderStyle = useMemo(() => ({
    width: "100%",
    height: "8px",
    borderRadius: "4px",
    background: `linear-gradient(to right, 
      #dc3545 0%, #dc3545 20%, 
      #ffc107 20%, #ffc107 40%, 
      #17a2b8 40%, #17a2b8 60%, 
      #28a745 60%, #28a745 80%, 
      #198754 80%, #198754 100%)`,
    outline: "none",
    cursor: "pointer",
    transition: "all 0.2s ease"
  }), []);

  const numberInputStyle = useMemo(() => ({
    width: "70px",
    padding: "8px 12px",
    border: `2px solid ${getScoreColor(val)}`,
    borderRadius: "6px",
    fontSize: "16px",
    fontWeight: "600",
    textAlign: "center",
    color: getScoreColor(val),
    backgroundColor: "#fff",
    transition: "all 0.2s ease",
    outline: "none"
  }), [val]);

  const commentInputStyle = useMemo(() => ({
    padding: "8px 12px",
    border: `1px solid ${comment.trim() ? "#28a745" : "#dee2e6"}`,
    borderRadius: "6px",
    fontSize: "14px",
    backgroundColor: "#fff",
    outline: "none",
    transition: "border-color 0.2s ease",
    resize: "vertical",
    minHeight: "38px"
  }), [comment]);

  const scoreDisplayStyle = useMemo(() => ({
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "14px",
    color: getScoreColor(val),
    fontWeight: "500"
  }), [val]);

  const modifiedIndicatorStyle = useMemo(() => ({
    position: "absolute",
    top: "-2px",
    right: "-2px",
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    backgroundColor: "#ffc107",
    border: "2px solid #fff",
    display: isModified ? "block" : "none"
  }), [isModified]);

  return (
    <div 
      style={wrapperStyle}
      onMouseEnter={() => setIsFocused(true)}
      onMouseLeave={() => setIsFocused(false)}
    >
      {/* Название и описание навыка */}
      <div style={{ position: "relative" }}>
        <div style={titleStyle}>
          {item.name || item.skillName}
          <div style={modifiedIndicatorStyle} />
        </div>
        {(item.description || item.skillDesc) && (
          <div style={descStyle}>
            {item.description || item.skillDesc}
          </div>
        )}
        {item.employeeName && (
          <div style={{ 
            fontSize: "12px", 
            color: "#495057", 
            marginTop: "4px",
            fontStyle: "italic"
          }}>
            👤 {item.employeeName}
          </div>
        )}
      </div>

      {/* Слайдер оценки */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <input
          type="range"
          min={0}
          max={5}
          step={1}
          value={val}
          onChange={(e) => handleValueChange(Number(e.target.value))}
          style={sliderStyle}
          aria-label={`Оценка для ${item.name || item.skillName}`}
        />
        <div style={scoreDisplayStyle}>
          <span>{getScoreEmoji(val)}</span>
          <span>{val}/5</span>
          {val > 0 && (
            <span style={{ fontSize: "12px", opacity: 0.7 }}>
              {val === 1 ? "Низкий" : 
               val === 2 ? "Ниже среднего" :
               val === 3 ? "Средний" :
               val === 4 ? "Хороший" : "Отличный"}
            </span>
          )}
        </div>
      </div>

      {/* Числовой ввод */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
        <input
          type="number"
          min={0}
          max={5}
          value={val}
          style={numberInputStyle}
          onChange={(e) => handleValueChange(Number(e.target.value))}
          onFocus={(e) => e.target.select()}
        />
        <div style={{ fontSize: "10px", color: "#6c757d", textAlign: "center" }}>
          0-5
        </div>
      </div>

      {/* Комментарий */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <textarea
          placeholder="Комментарий (необязательно)"
          value={comment}
          style={commentInputStyle}
          onChange={(e) => handleCommentChange(e.target.value)}
          onFocus={(e) => {
            setIsFocused(true);
            e.target.style.borderColor = "#007bff";
          }}
          onBlur={(e) => {
            e.target.style.borderColor = comment.trim() ? "#28a745" : "#dee2e6";
          }}
          rows={1}
        />
        <div style={{ 
          fontSize: "10px", 
          color: comment.length > 100 ? "#ffc107" : "#6c757d",
          textAlign: "right"
        }}>
          {comment.length}/2000
          {comment.length > 100 && " ⚠️"}
        </div>
      </div>

      {/* Индикатор текущего значения из БД */}
      {item.current !== null && item.current !== undefined && item.current !== val && (
        <div style={{
          position: "absolute",
          top: "8px",
          right: "8px",
          fontSize: "11px",
          color: "#6c757d",
          background: "#f8f9fa",
          padding: "2px 6px",
          borderRadius: "10px",
          border: "1px solid #dee2e6"
        }}>
          Было: {item.current}
        </div>
      )}
    </div>
  );
}

// Мемоизация для предотвращения лишних ре-рендеров
export default memo(ScoreRowInner, (prevProps, nextProps) => {
  return (
    prevProps.item.pageId === nextProps.item.pageId &&
    prevProps.item.current === nextProps.item.current &&
    prevProps.item.comment === nextProps.item.comment &&
    prevProps.item.name === nextProps.item.name &&
    prevProps.item.description === nextProps.item.description &&
    JSON.stringify(prevProps.initialValue) === JSON.stringify(nextProps.initialValue)
  );
});