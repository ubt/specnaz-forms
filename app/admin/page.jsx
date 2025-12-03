"use client";

import { useState, useCallback, useMemo } from "react";

export default function AdminPage() {
  const [teamName, setTeamName] = useState("");
  const [expDays, setExpDays] = useState(14);
  const [adminKey, setAdminKey] = useState("");
  const [links, setLinks] = useState([]);
  const [msg, setMsg] = useState("");
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const validation = useMemo(() => {
    const errs = {};
    if (!teamName.trim()) errs.teamName = "Название команды обязательно";
    else if (teamName.trim().length < 2) errs.teamName = "Минимум 2 символа";
    else if (teamName.trim().length > 100) errs.teamName = "Максимум 100 символов";
    if (expDays < 1 || expDays > 365) errs.expDays = "От 1 до 365 дней";
    if (!adminKey.trim()) errs.adminKey = "Admin key обязателен";
    else if (adminKey.trim().length < 4) errs.adminKey = "Admin key слишком короткий";
    return { errors: errs, isValid: Object.keys(errs).length === 0 };
  }, [teamName, expDays, adminKey]);

  const generate = useCallback(async () => {
    if (!validation.isValid) {
      setErrors(validation.errors);
      setMsg("Исправьте ошибки");
      return;
    }

    setMsg(""); setLinks([]); setErrors({}); setLoading(true); setProgress(0);
    
    let p = 0;
    const timer = setInterval(() => {
      p = Math.min(90, p + Math.random() * 8);
      setProgress(p);
    }, 200);

    try {
      const res = await fetch("/api/admin/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey.trim() },
        body: JSON.stringify({ teamName: teamName.trim(), expDays: Number(expDays) })
      });

      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setLinks(data.links || []);
      setMsg(`✅ Команда: ${data.teamName}. Создано: ${data.count}`);

    } catch (error) {
      let errorMsg = "❌ ";
      if (error.message.includes("403")) errorMsg += "Неверный admin key";
      else if (error.message.includes("404")) errorMsg += "Команда не найдена";
      else errorMsg += error.message;
      setMsg(errorMsg);
    } finally {
      clearInterval(timer);
      setProgress(100);
      setTimeout(() => { setLoading(false); setProgress(0); }, 500);
    }
  }, [teamName, expDays, adminKey, validation]);

  const inputStyle = {
    padding: "10px 12px",
    border: "2px solid #e1e5e9",
    borderRadius: 8,
    fontSize: 14,
    width: "100%"
  };

  const errorStyle = { ...inputStyle, borderColor: "#dc3545" };

  return (
    <main style={{ padding: 32, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, color: "#2c3e50", marginBottom: 32 }}>
        🔗 Генерация ссылок
      </h1>

      <div style={{ backgroundColor: "#f8f9fa", padding: 24, borderRadius: 12, marginBottom: 24 }}>
        <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>📋 Команда</label>
        <input
          value={teamName}
          onChange={e => setTeamName(e.target.value)}
          placeholder="Название команды"
          style={errors.teamName ? errorStyle : inputStyle}
        />
        {errors.teamName && <div style={{ color: "#dc3545", fontSize: 12, marginTop: 4 }}>{errors.teamName}</div>}

        <label style={{ display: "block", margin: "16px 0 6px", fontWeight: 600 }}>⏰ Срок (дней)</label>
        <input
          type="number"
          min={1} max={365}
          value={expDays}
          onChange={e => setExpDays(Number(e.target.value))}
          style={errors.expDays ? errorStyle : inputStyle}
        />
        {errors.expDays && <div style={{ color: "#dc3545", fontSize: 12, marginTop: 4 }}>{errors.expDays}</div>}

        <label style={{ display: "block", margin: "16px 0 6px", fontWeight: 600 }}>🔑 Admin Key</label>
        <input
          type="password"
          value={adminKey}
          onChange={e => setAdminKey(e.target.value)}
          placeholder="Admin key"
          style={errors.adminKey ? errorStyle : inputStyle}
        />
        {errors.adminKey && <div style={{ color: "#dc3545", fontSize: 12, marginTop: 4 }}>{errors.adminKey}</div>}

        {loading && (
          <div style={{ margin: "20px 0" }}>
            <div style={{ height: 12, background: "#e9ecef", borderRadius: 6, overflow: "hidden" }}>
              <div style={{
                width: `${progress}%`,
                height: "100%",
                background: "linear-gradient(90deg, #007bff, #0056b3)",
                transition: "width 200ms"
              }} />
            </div>
            <div style={{ fontSize: 13, color: "#6c757d", textAlign: "center", marginTop: 8 }}>
              Генерируем... {Math.round(progress)}%
            </div>
          </div>
        )}

        <button
          onClick={generate}
          disabled={loading || !validation.isValid}
          style={{
            marginTop: 20,
            padding: "12px 24px",
            background: loading || !validation.isValid ? "#6c757d" : "#007bff",
            color: "white",
            border: "none",
            borderRadius: 8,
            fontSize: 16,
            fontWeight: 600,
            cursor: loading || !validation.isValid ? "not-allowed" : "pointer"
          }}
        >
          {loading ? "⏳ Генерируем..." : "🚀 Сгенерировать"}
        </button>
      </div>

      {msg && (
        <div style={{
          padding: "12px 16px",
          borderRadius: 8,
          backgroundColor: msg.includes("❌") ? "#f8d7da" : "#d4edda",
          color: msg.includes("❌") ? "#721c24" : "#155724",
          marginBottom: 20
        }}>
          {msg}
        </div>
      )}

      {links.length > 0 && (
        <div style={{ backgroundColor: "white", border: "1px solid #dee2e6", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", backgroundColor: "#f8f9fa", borderBottom: "1px solid #dee2e6" }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "#495057" }}>
              📋 Ссылки ({links.length})
            </h3>
          </div>
          <div style={{ padding: 20 }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ backgroundColor: "#f8f9fa" }}>
                  <th style={{ textAlign: "left", padding: "12px 8px", fontWeight: 600, borderBottom: "2px solid #dee2e6" }}>
                    👤 Ревьюер
                  </th>
                  <th style={{ textAlign: "left", padding: "12px 8px", fontWeight: 600, borderBottom: "2px solid #dee2e6" }}>
                    🔗 Ссылка
                  </th>
                </tr>
              </thead>
              <tbody>
                {links.map((link, i) => (
                  <tr key={i} style={{ borderBottom: i < links.length - 1 ? "1px solid #f1f3f4" : "none" }}>
                    <td style={{ padding: "12px 8px", fontSize: 14, fontWeight: 500 }}>{link.name}</td>
                    <td style={{ padding: "12px 8px", fontSize: 13, fontFamily: "monospace" }}>
                      <a href={link.url} target="_blank" rel="noreferrer" style={{ color: "#007bff" }}>
                        {link.url.length > 60 ? `${link.url.substring(0, 60)}...` : link.url}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
