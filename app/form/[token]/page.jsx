"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import ScoreRow from "@/components/ScoreRow";

export default function FormPage({ params }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState("");
  const [pending, startTransition] = useTransition();
  const token = params.token;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setMsg("");
      try {
        const res = await fetch(`/api/form/${token}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Не удалось загрузить данные");
        if (!cancelled) setRows(data?.rows || []);
      } catch (e) {
        if (!cancelled) setMsg(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [token]);

  const [draft, setDraft] = useState({}); // pageId -> { value, comment }
  const onRowChange = (pageId) => (p) => {
    setDraft(prev => ({ ...prev, [pageId]: p }));
  };

  const submitAll = async () => {
    setMsg("");
    startTransition(async () => {
      const items = Object.entries(draft).map(([pageId, v]) => ({ pageId, ...v }));
      if (!items.length) { setMsg("Нечего отправлять"); return; }
      setProgress(0);
      try {
        const res = await fetch(`/api/form/${token}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items, mode: "final" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Ошибка отправки");
        setProgress(100);
        setMsg("Готово!");
      } catch (e) {
        setMsg(e.message);
      }
    });
  };

  return (
    <main style={{ padding: 16 }}>
      {loading ? <div>Загрузка…</div> : rows.length ? (
        <>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            Всего пунктов: {rows.length}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {rows.map((r) => (
              <ScoreRow key={r.pageId} item={r} onChange={onRowChange(r.pageId)} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              onClick={submitAll}
              disabled={pending}
              style={{ padding: "8px 12px", background: pending ? "#777" : "#000", color: "#fff", borderRadius: 6 }}
            >
              {pending ? "Отправка…" : "Отправить все"}
            </button>
            {progress > 0 && <div>Прогресс: {progress}%</div>}
          </div>
        </>
      ) : (
        <div>Нет сотрудников для оценки.</div>
      )}
      {msg && <div style={{ marginTop: 12, fontSize: 14 }}>{msg}</div>}
    </main>
  );
}
