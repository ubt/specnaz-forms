"use client";
import { useState } from "react";

export default function Admin() {
  const [employeeId, setEmployeeId] = useState("");
  const [expDays, setExpDays] = useState(14);
  const [adminKey, setAdminKey] = useState("");
  const [roles, setRoles] = useState({ self:true, p1:true, p2:true, manager:true });
  const [links, setLinks] = useState([]);
  const [msg, setMsg] = useState("");

  async function generate() {
    setMsg(""); setLinks([]);
    const chosen = Object.entries(roles).filter(([,v])=>v).map(([k])=>k);
    const res = await fetch("/api/admin/sign", {
      method: "POST",
      headers: { "Content-Type":"application/json", "x-admin-key": adminKey },
      body: JSON.stringify({ employeeId, roles: chosen, expDays: Number(expDays) })
    });
    const data = await res.json();
    if (!res.ok) { setMsg(data.error || "Ошибка"); return; }
    setLinks(data.links);
  }

  const box = { padding: 24 };
  const row = { display: "flex", gap: 12, alignItems: "center", margin: "8px 0" };
  const input = { padding: "6px 8px" };

  return (
    <main style={box}>
      <h1>Генерация ссылок</h1>
      <div style={row}>
        <label style={{ width: 140 }}>Employee ID:</label>
        <input value={employeeId} onChange={(e)=>setEmployeeId(e.target.value)} style={input} />
      </div>
      <div style={row}>
        <label style={{ width: 140 }}>Срок (дней):</label>
        <input type="number" value={expDays} onChange={(e)=>setExpDays(e.target.value)} style={input} />
      </div>
      <div style={row}>
        <label style={{ width: 140 }}>Роли:</label>
        {["self","p1","p2","manager"].map(r => (
          <label key={r}><input type="checkbox" checked={roles[r]} onChange={(e)=>setRoles({...roles, [r]:e.target.checked})}/> {r}</label>
        ))}
      </div>
      <div style={row}>
        <label style={{ width: 140 }}>Admin key:</label>
        <input type="password" value={adminKey} onChange={(e)=>setAdminKey(e.target.value)} style={input} />
      </div>
      <div style={{ marginTop: 12 }}>
        <button onClick={generate} style={{ padding: "8px 12px" }}>Сгенерировать</button>
      </div>
      {msg && <div style={{ marginTop: 12 }}>{msg}</div>}
      {links.length>0 && (
        <div style={{ marginTop: 16 }}>
          <h3>Ссылки:</h3>
          <ul>
            {links.map(l => <li key={l.role}><b>{l.role}</b>: <a href={l.url} target="_blank">{l.url}</a></li>)}
          </ul>
        </div>
      )}
    </main>
  );
}
