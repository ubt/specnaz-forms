"use client";
import { useState } from "react";

export default function ScoreRow({ item, onChange }) {
  const [val, setVal] = useState(item.current ?? 0);
  const [comment, setComment] = useState(item.comment ?? "");

  const wrap = { display: "grid", gridTemplateColumns: "1fr 180px 80px 1fr", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #eee" };
  const num = { width: 70, padding: "6px 8px" };
  const input = { padding: "6px 8px" };

  return (
    <div style={wrap}>
      <div style={{ fontWeight: 600 }}>{item.skillName}</div>
      <input type="range" min={0} max={5} step={1} value={val}
        onChange={(e)=>{ const v=Number(e.target.value); setVal(v); onChange({ value:v, comment }); }} />
      <input type="number" min={0} max={5} value={val} style={num}
        onChange={(e)=>{ const v=Number(e.target.value); setVal(v); onChange({ value:v, comment }); }} />
      <input placeholder="Комментарий (опц.)" value={comment} style={input}
        onChange={(e)=>{ const c=e.target.value; setComment(c); onChange({ value:val, comment:c }); }} />
    </div>
  );
}
