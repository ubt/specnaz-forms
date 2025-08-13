"use client";
import { useState } from "react";

export default function Admin() {
  const [teamName, setTeamName] = useState("");
  const [expDays, setExpDays] = useState(14);
  const [adminKey, setAdminKey] = useState("");
  const [links, setLinks] = useState([]);
  const [msg, setMsg] = useState("");

  async function generate() {
    setMsg(""); setLinks([]);
    const res = await fetch("/api/admin/sign", {
      method: "POST",
      headers: { "Content-Type":"application/json", "x-admin-key": adminKey },
      body: JSON.stringify({ teamName, expDays, adminKey })
    });
    const data = await res.json();
    if (!res.ok) { setMsg(data.error || "Ошибка"); return; }
    if (!data.links?.length) {
      setMsg(data.note === "no_employees_found"
        ? "В этой команде не найдены сотрудники."
        : "Не найдено назначенных оценивающих.");
      return;
    }
    setLinks(data.links);
  }

  const row = { display: "flex", gap: 12, alignItems: "center", margin: "8px 0" };
  const input = { padding: "6px 8px", width: 360 };

  return (
    <main style={{ padding: 24 }}>
      <h1>Ссылки на оценку по команде</h1>
      <div style={row}>
        <label style={{ width: 160 }}>Команда:</label>
        <input value={teamName} onChange={(e)=>setTeamName(e.target.value)} style={input} placeholder="например: Platform" />
      </div>
      <div style={row}>
        <label style={{ width: 160 }}>Срок (дней):</label>
        <input type="number" value={expDays} onChange={(e)=>setExpDays(e.target.value)} style={{ padding:"6px 8px", width:120 }} />
      </div>
      <div style={row}>
        <label style={{ width: 160 }}>Admin key:</label>
        <input type="password" value={adminKey} onChange={(e)=>setAdminKey(e.target.value)} style={input} />
      </div>
      <div style={{ marginTop: 12 }}>
        <button onClick={generate} style={{ padding: "8px 12px" }}>Сгенерировать</button>
      </div>

      {msg && <div style={{ marginTop: 12, color:"#b00" }}>{msg}</div>}

      {links.length>0 && (
        <div style={{ marginTop: 16 }}>
          <h3>Результат ({links.length}):</h3>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign:"left", borderBottom:"1px solid #eee", padding:"6px 4px" }}>Кому</th>
                <th style={{ textAlign:"left", borderBottom:"1px solid #eee", padding:"6px 4px" }}>Тип ID</th>
                <th style={{ textAlign:"left", borderBottom:"1px solid #eee", padding:"6px 4px" }}>Ссылка</th>
              </tr>
            </thead>
            <tbody>
              {links.map((l, i) => (
                <tr key={i}>
                  <td style={{ padding:"6px 4px" }}>{l.name}</td>
                  <td style={{ padding:"6px 4px" }}>{l.idType}</td>
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
