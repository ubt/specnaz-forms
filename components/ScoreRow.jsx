"use client";
import { memo, useEffect, useMemo, useRef, useState } from "react";

const clamp = (n) => Math.max(0, Math.min(5, Number.isFinite(n) ? Math.round(n) : 0));

function useDebouncedCallback(cb, delay=200) {
  const t = useRef();
  return (v) => {
    clearTimeout(t.current);
    t.current = setTimeout(() => cb(v), delay);
  };
}

function ScoreRowInner({ item, onChange }) {
  const [val, setVal] = useState(clamp(item.current ?? 0));
  const [comment, setComment] = useState(item.comment ?? "");

  const debounced = useDebouncedCallback(onChange, 120);

  useEffect(() => {
    // notify parent on first mount to ensure defaults get captured
    debounced({ value: val, comment });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wrap = useMemo(() => ({
    display: "grid",
    gridTemplateColumns: "1fr 180px 90px 1fr",
    alignItems: "center",
    padding: "8px 0",
    borderBottom: "1px solid #eee"
  }), []);

  const num = { width: 70, padding: "6px 8px" };
  const input = { padding: "6px 8px" };
  const title = { fontWeight: 600, lineHeight: 1.2 };
  const desc = { color: "#666", fontSize: 12, marginTop: 4, whiteSpace: "pre-wrap" };

  return (
    <div style={wrap}>
      <div>
        <div style={title}>{item.name}</div>
        {item.description && <div style={desc}>{item.description}</div>}
      </div>
      <input
        type="range"
        min={0}
        max={5}
        step={1}
        value={val}
        onChange={(e) => { const v = clamp(Number(e.target.value)); setVal(v); debounced({ value: v, comment }); }}
        aria-label={`Оценка для ${item.name}`}
      />
      <input
        type="number"
        min={0}
        max={5}
        value={val}
        style={num}
        onChange={(e) => { const v = clamp(Number(e.target.value)); setVal(v); debounced({ value: v, comment }); }}
      />
      <input
        placeholder="Комментарий (опц.)"
        value={comment}
        style={input}
        onChange={(e) => { const c = e.target.value; setComment(c); debounced({ value: val, comment: c }); }}
      />
    </div>
  );
}

export default memo(ScoreRowInner);
