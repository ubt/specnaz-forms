"use client";
import { useEffect, useMemo, useState } from "react";
import ScoreRow from "../../../components/ScoreRow";

export default function FormPage({ params }) {
  const [mode, setMode] = useState("choose"); // "choose" | "fill"
  const [evaluatees, setEvaluatees] = useState([]); // [{employeeId, employeeName, role}]
  const [employeeId, setEmployeeId] = useState("");
  const [role, setRole] = useState("");
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  // 1) Сначала получаем список "кого я могу оценить"
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/form/${params.token}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) {
          setMsg(data.error || "Ошибка загрузки");
          setEvaluatees([]);
          return;
        }
        setEvaluatees(data.evaluatees || []);
        if ((data.evaluatees || []).length === 1) {
          // если один — сразу выберем
          const only = data.evaluatees[0];
          setEmployeeId(only.employeeId);
          await loadEmployee(only.employeeId);
        } else {
          setMode("choose");
        }
      } catch {
        setMsg("Сетевая ошибка");
      } finally {
        setLoading(false);
      }
    })();
  }, [params.token]);

  async function loadEmployee(empId) {
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch(`/api/form/${params.token}?employeeId=${encodeURIComponent(empId)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "Ошибка загрузки");
        return;
      }
      setRole(data.role || "");
      setItems(data.items || []);
      const initial = {};
      (data.items || []).forEach(i => initial[i.pageId] = { value: i.current ?? 0, comment: "" });
      setDraft(initial);
      setMode("fill");
    } catch {
      setMsg("Сетевая ошибка");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    setMsg("");
    const payload = {
      employeeId,
      items: Object.entries(draft).map(([pageId, v]) => ({ pageId, ...v })),
    };
    const res = await fetch(`/api/form/${params.token}`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setMsg(res.ok ? "Сохранено!" : (data.error || "Ошибка"));
  }

  const chosen = useMemo(() => evaluatees.find(e => e.employeeId === employeeId), [evaluatees, employeeId]);

  if (loading) return <div style={{ padding: 24 }}>Загрузка…</div>;
  if (msg) return <div style={{ padding: 24, color: "#b00" }}>Ошибка: {msg}</div>;

  if (mode === "choose") {
    return (
      <main style={{ padding: 24 }}>
        <h1>Выбор сотрудника для оценки</h1>
        {evaluatees.length === 0 && <p>Для вашего токена не назначены сотрудники. Обратитесь к администратору.</p>}
        {evaluatees.length > 0 && (
          <>
            <label>Сотрудник:&nbsp;
              <select value={employeeId} onChange={(e)=> setEmployeeId(e.target.value)}>
                <option value="" disabled>— выберите —</option>
                {evaluatees.map(e => (
                  <option key={e.employeeId} value={e.employeeId}>
                    {e.employeeName || e.employeeId} ({e.role})
                  </option>
                ))}
              </select>
            </label>
            <div style={{ marginTop: 12 }}>
              <button
                disabled={!employeeId}
                onClick={()=> loadEmployee(employeeId)}
                style={{ padding: "8px 12px" }}
              >
                Открыть навыки
              </button>
            </div>
          </>
        )}
      </main>
    );
  }

  // режим "fill"
  return (
    <main style={{ padding: 24 }}>
      <h1>Оценка навыков</h1>
      <div style={{ color: "#666", marginBottom: 16 }}>
        Сотрудник: <b>{chosen?.employeeName || employeeId}</b> • Ваша роль: <b>{role}</b>
      </div>

      {items.map((it) => (
        <ScoreRow key={it.pageId} item={it}
          onChange={(v)=> setDraft((d)=> ({...d, [it.pageId]: v}))} />
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={submit} style={{ padding: "8px 12px", background:"#000", color:"#fff" }}>Отправить</button>
        <button onClick={()=> setMode("choose")} style={{ padding: "8px 12px" }}>← Назад к выбору</button>
      </div>
      {msg && <div style={{ marginTop: 12, fontSize: 14 }}>{msg}</div>}
    </main>
  );
}
