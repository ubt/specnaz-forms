
"use client";
import { useEffect, useState } from "react";

export default function FormPage({ params }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let aborted = false;
    async function loadAll() {
      try {
        setLoading(true); setProgress(0);
        const main = await fetch(`/api/form/${params.token}`, { cache: "no-store" });
        const base = await main.json();
        const evaluatees = base.evaluatees || [];
        if (!evaluatees.length) { setRows([]); setLoading(false); return; }

        const out = [];
        const pairs = evaluatees.map(e => [e.employeeId, e]);
        let done = 0;
        const limit = 4;
        let i = 0;
        async function worker() {
          while (i < pairs.length) {
            const idx = i++;
            const [employeeId, meta] = pairs[idx];
            const res = await fetch(`/api/form/${params.token}?employeeId=${encodeURIComponent(employeeId)}`, { cache: "no-store" });
            const data = await res.json();
            const role = data.role;
            const items = data.items || [];
            for (const it of items) {
              out.push({
                employeeId, employeeName: meta.employeeName, role,
                pageId: it.pageId, skillName: it.skillName, description: it.description || "",
                current: it.current ?? null, value: it.current ?? 0, comment: ""
              });
            }
            done++; setProgress(Math.round(done / pairs.length * 100));
          }
        }
        await Promise.all(Array.from({ length: Math.min(limit, pairs.length) }, worker));
        if (!aborted) {
          out.sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.skillName.localeCompare(b.skillName));
          setRows(out);
        }
      } catch (e) {
        if (!aborted) setMsg(e.message || "Ошибка загрузки");
      } finally {
        if (!aborted) setLoading(false);
      }
    }
    loadAll();
    return () => { aborted = true; };
  }, [params.token]);

  function updateRow(pageId, patch) {
    setRows(r => r.map(x => x.pageId === pageId ? { ...x, ...patch } : x));
  }

  async function submitAll() {
    setMsg("");
    const byEmp = new Map();
    for (const r of rows) {
      const it = { pageId: r.pageId, value: Number(r.value) || 0, comment: r.comment || "" };
      if (!byEmp.has(r.employeeId)) byEmp.set(r.employeeId, []);
      byEmp.get(r.employeeId).push(it);
    }

    let ok = 0, total = byEmp.size;
    for (const [employeeId, items] of byEmp.entries()) {
      const resp = await fetch(`/api/form/${params.token}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, items, mode: "final" })
      });
      const data = await resp.json();
      if (!resp.ok) {
        setMsg(`Ошибка сохранения для сотрудника ${employeeId}: ${data?.error || resp.status}`);
        return;
      }
      ok++; setMsg(`Сохранено ${ok}/${total} сотрудников...`);
    }
    setMsg("Готово! Все оценки сохранены.");
  }

  const th = { padding: "8px", textAlign: "left", borderBottom: "1px solid #eee", fontWeight: 600 };
  const td = { padding: "6px 8px", verticalAlign: "middle", borderBottom: "1px solid #f4f4f4" };
  const numInput = { width: 64, padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6 };
  const commentInput = { width: "100%", maxWidth: 360, padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6 };

  return (
    <main style={{ padding: 24 }}>
      <h2 style={{ margin: "0 0 8px" }}>Оценки компетенций</h2>
      {loading ? (
        <div>
          <div style={{ margin: "8px 0", height: 8, background: "#eee", borderRadius: 4, overflow: "hidden", maxWidth: 420 }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "#4a90e2", transition: "width 200ms linear" }} />
          </div>
          <div style={{ color: "#666" }}>Загружаем список сотрудников…</div>
        </div>
      ) : rows.length ? (
        <>
          <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 1000 }}>
            <thead>
              <tr>
                <th style={th}>Оцениваемый сотрудник</th>
                <th style={th}>Навык</th>
                <th style={th}>Описание навыка</th>
                <th style={th}>Оценка (0–5)</th>
                <th style={th}>Комментарий (опц.)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.pageId}>
                  <td style={td}>{r.employeeName}</td>
                  <td style={td}>{r.skillName}</td>
                  <td style={{ ...td, color: "#666" }}>{r.description}</td>
                  <td style={td}>
                    <input
                      type="range" min={0} max={5} step={1} value={r.value}
                      onChange={e => updateRow(r.pageId, { value: Number(e.target.value) })}
                    />
                    <input
                      type="number" min={0} max={5} value={r.value} style={{ ...numInput, marginLeft: 8 }}
                      onChange={e => updateRow(r.pageId, { value: Number(e.target.value) })}
                    />
                  </td>
                  <td style={td}>
                    <input
                      placeholder="Комментарий" value={r.comment} style={commentInput}
                      onChange={e => updateRow(r.pageId, { comment: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button onClick={submitAll} style={{ padding: "8px 12px", background:"#000", color:"#fff", borderRadius: 6 }}>
              Отправить все
            </button>
          </div>
        </>
      ) : (
        <div>Нет сотрудников для оценки.</div>
      )}
      {msg && <div style={{ marginTop: 12, fontSize: 14 }}>{msg}</div>}
    </main>
  );
}
