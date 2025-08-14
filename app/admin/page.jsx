
"use client";

async function parseResponse(res){
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) { try { return await res.json(); } catch { return null; } }
  try { const t = await res.text(); return t ? { error: t } : null; } catch { return null; }
}

import { useState } from "react";

export default function Admin() {
  const [teamName, setTeamName] = useState("");
  const [expDays, setExpDays] = useState(14);
  const [adminKey, setAdminKey] = useState("");
  const [links, setLinks] = useState([]);
  const [msg, setMsg] = useState("");
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setMsg(""); setLinks([]);
    setLoading(true); setProgress(0);
    let p = 0; const timer = setInterval(()=>{ p = Math.min(95, p + Math.random()*7); setProgress(p); }, 250);

    try {
      const res = await fetch("/api/admin/sign", {
        method: "POST",
        headers: { "Content-Type":"application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ teamName, expDays, adminKey })
      });
      const data = await parseResponse(res);
      if (!res.ok) { setMsg((data && (data.error||data.message)) || `HTTP ${res.status}`); setLoading(false); return; }
      setLinks(data.links || []);
      setMsg(`Команда: ${data.teamName}. Ссылок: ${data.count || (data.links||[]).length}.`);
    } catch (e) {
      setMsg(e.message || "Ошибка запроса");
    } finally {
      clearInterval(timer);
      setProgress(100);
      setTimeout(()=>{ setLoading(false); setProgress(0); }, 700);
    }
  }

  const label = { display:"block", margin:"8px 0 4px", fontWeight:600 };
  const input = { padding:"6px 8px", border:"1px solid #ddd", borderRadius:6 };

  return (
    <main style={{ padding: 24, maxWidth: 900 }}>
      <h1>Генерация ссылок для ревью</h1>

      <label style={label}>Команда</label>
      <input value={teamName} onChange={e=>setTeamName(e.target.value)} placeholder="Название команды" style={input} />

      <label style={label}>Срок действия (дней)</label>
      <input type="number" min={1} max={90} value={expDays} onChange={e=>setExpDays(Number(e.target.value))} style={input} />

      <label style={label}>Admin key</label>
      <input value={adminKey} onChange={e=>setAdminKey(e.target.value)} placeholder="ADMIN_KEY" style={input} />

      {loading ? (
        <div style={{ margin: "12px 0", height: 8, background: "#eee", borderRadius: 4, overflow: "hidden", maxWidth: 420 }}>
          <div style={{ width: `${progress}%`, height: "100%", background: "#4a90e2", transition: "width 200ms linear" }} />
        </div>
      ) : null}

      <div style={{ marginTop: 12 }}>
        <button onClick={generate} style={{ padding:"8px 12px", background:"#000", color:"#fff", borderRadius:6 }}>Сгенерировать ссылки</button>
      </div>

      {msg && <div style={{ marginTop: 12 }}>{msg}</div>}

      {!!links.length && (
        <div style={{ marginTop: 16 }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign:"left", padding:"6px 4px" }}>Ревьюер</th>
                <th style={{ textAlign:"left", padding:"6px 4px" }}>Ссылка</th>
              </tr>
            </thead>
            <tbody>
              {links.map((l, i) => (
                <tr key={i}>
                  <td style={{ padding:"6px 4px" }}>{l.name}</td>
                  <td style={{ padding:"6px 4px" }}>
                    <a href={l.url} target="_blank" rel="noreferrer">{l.url}</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
