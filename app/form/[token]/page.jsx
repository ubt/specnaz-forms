"use client";
import { useEffect, useState } from "react";
import ScoreRow from "@/components/ScoreRow";

export default function FormPage({ params }) {
  const [items, setItems] = useState([]);
  const [role, setRole] = useState("");
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/form/${params.token}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || "Ошибка загрузки"); return; }
      setItems(data.items);
      setRole(data.role);
      const initial = {};
      data.items.forEach((i)=> initial[i.pageId] = { value: i.current ?? 0, comment: "" });
      setDraft(initial);
      setLoading(false);
    })();
  }, [params.token]);

  async function submit(mode) {
    setMsg("");
    const payload = {
      items: Object.entries(draft).map(([pageId, v]) => ({ pageId, ...v })),
      mode,
    };
    const res = await fetch(`/api/form/${params.token}`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setMsg(res.ok ? (mode==="final" ? "Сохранено!" : "Черновик сохранён") : (data.error || "Ошибка"));
  }

  if (loading) return <div style={{ padding: 24 }}>Загрузка…</div>;

  return (
    <main style={{ padding: 24 }}>
      <h1>Оценка навыков</h1>
      <div style={{ color: "#666", marginBottom: 16 }}>Роль: {role}</div>

      {items.map((it) => (
        <ScoreRow key={it.pageId} item={it}
          onChange={(v)=> setDraft((d)=> ({...d, [it.pageId]: v}))} />
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={()=>submit("draft")} style={{ padding: "8px 12px" }}>Сохранить черновик</button>
        <button onClick={()=>submit("final")} style={{ padding: "8px 12px", background:"#000", color:"#fff" }}>Отправить</button>
      </div>
      {msg && <div style={{ marginTop: 12, fontSize: 14 }}>{msg}</div>}
    </main>
  );
}
