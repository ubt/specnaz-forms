"use client";
import { useState } from "react";

export default function Admin() {
  const [reviewerId, setReviewerId] = useState("");
  const [expDays, setExpDays] = useState(14);
  const [adminKey, setAdminKey] = useState("");
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");

  async function generate() {
    setMsg(""); setUrl("");
    const res = await fetch("/api/admin/sign", {
      method: "POST",
      headers: { "Content-Type":"application/json", "x-admin-key": adminKey },
      body: JSON.stringify({ reviewerId, expDays, adminKey })
    });
    const data = await res.json();
    if (!res.ok) { setMsg(data.error || "Ошибка"); return; }
    setUrl(data.url);
  }

  const row = { display: "flex", gap: 12, alignItems: "center", margin: "8px 0" };
  const input = { padding: "6px 8px" };

  return (
    <main style={{ padding: 24 }}>
      <h1>Генерация ссылки для оценивающего</h1>
      <div style={row}>
        <label style={{ width: 160 }}>Reviewer (ID страницы):</label>
        <input value={reviewerId} onChange={(e)=>setReviewerId(e.target.value)} style={input} />
      </div>
      <div style={row}>
        <label style={{ width: 160 }}>Срок (дней):</label>
        <input type="number" value={expDays} onChange={(e)=>setExpDays(e.target.value)} style={input} />
      </div>
      <div style={row}>
        <label style={{ width: 160 }}>Admin key:</label>
        <input type="password" value={adminKey} onChange={(e)=>setAdminKey(e.target.value)} style={input} />
      </div>
      <div style={{ marginTop: 12 }}>
        <button onClick={generate} style={{ padding: "8px 12px" }}>Сгенерировать</button>
      </div>
      {msg && <div style={{ marginTop: 12 }}>{msg}</div>}
      {url && (
        <div style={{ marginTop: 16 }}>
          <h3>Ссылка:</h3>
          <p><a href={url} target="_blank" rel="noreferrer">{url}</a></p>
        </div>
      )}
    </main>
  );
}
