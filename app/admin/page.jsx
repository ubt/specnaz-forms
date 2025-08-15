"use client";

import { useState, useCallback, useMemo } from "react";

async function parseResponse(res) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) { 
    try { 
      return await res.json(); 
    } catch { 
      return null; 
    } 
  }
  try { 
    const t = await res.text(); 
    return t ? { error: t } : null; 
  } catch { 
    return null; 
  }
}

export default function OptimizedAdmin() {
  const [teamName, setTeamName] = useState("");
  const [expDays, setExpDays] = useState(14);
  const [adminKey, setAdminKey] = useState("");
  const [links, setLinks] = useState([]);
  const [msg, setMsg] = useState("");
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  // Валидация формы
  const validation = useMemo(() => {
    const errors = {};
    
    if (!teamName.trim()) {
      errors.teamName = "Название команды обязательно";
    } else if (teamName.trim().length < 2) {
      errors.teamName = "Слишком короткое название";
    } else if (teamName.trim().length > 50) {
      errors.teamName = "Слишком длинное название";
    }
    
    if (expDays < 1 || expDays > 365) {
      errors.expDays = "Срок должен быть от 1 до 365 дней";
    }
    
    if (!adminKey.trim()) {
      errors.adminKey = "Admin key обязателен";
    } else if (adminKey.trim().length < 8) {
      errors.adminKey = "Admin key слишком короткий";
    }
    
    return {
      errors,
      isValid: Object.keys(errors).length === 0
    };
  }, [teamName, expDays, adminKey]);

  const generate = useCallback(async () => {
    if (!validation.isValid) {
      setErrors(validation.errors);
      setMsg("Исправьте ошибки в форме");
      return;
    }

    setMsg("");
    setLinks([]);
    setErrors({});
    setLoading(true);
    setProgress(0);
    
    // Анимация прогресса
    let p = 0;
    const timer = setInterval(() => {
      p = Math.min(90, p + Math.random() * 8);
      setProgress(p);
    }, 200);

    try {
      const requestData = {
        teamName: teamName.trim(),
        expDays: Number(expDays),
        adminKey: adminKey.trim()
      };

      console.log('[ADMIN] Generating links for team:', requestData.teamName);
      
      const res = await fetch("/api/admin/sign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": requestData.adminKey
        },
        body: JSON.stringify(requestData)
      });

      const data = await parseResponse(res);
      
      if (!res.ok) {
        const errorMsg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
        throw new Error(errorMsg);
      }

      const generatedLinks = data.links || [];
      setLinks(generatedLinks);
      
      const successMsg = `✅ Команда: ${data.teamName}. Создано ссылок: ${data.count || generatedLinks.length}`;
      setMsg(successMsg);
      
      console.log('[ADMIN] Successfully generated', generatedLinks.length, 'links');

    } catch (error) {
      console.error('[ADMIN] Generation failed:', error);
      
      let errorMsg = "❌ ";
      if (error.message.includes("403") || error.message.includes("Forbidden")) {
        errorMsg += "Неверный admin key";
      } else if (error.message.includes("404")) {
        errorMsg += "Команда не найдена";
      } else if (error.message.includes("500")) {
        errorMsg += "Ошибка сервера";
      } else {
        errorMsg += error.message || "Неизвестная ошибка";
      }
      
      setMsg(errorMsg);
    } finally {
      clearInterval(timer);
      setProgress(100);
      setTimeout(() => {
        setLoading(false);
        setProgress(0);
      }, 700);
    }
  }, [teamName, expDays, adminKey, validation.isValid]);

  // Копирование ссылки
  const copyLink = useCallback(async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setMsg("📋 Ссылка скопирована в буфер обмена");
      setTimeout(() => setMsg(""), 2000);
    } catch (error) {
      console.warn('Clipboard API not available, falling back to selection');
      // Fallback для старых браузеров
      const textArea = document.createElement('textarea');
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setMsg("📋 Ссылка скопирована");
      setTimeout(() => setMsg(""), 2000);
    }
  }, []);

  // Экспорт ссылок в CSV
  const exportLinks = useCallback(() => {
    if (!links.length) return;
    
    const csvContent = [
      'Ревьюер,Ссылка',
      ...links.map(l => `"${l.name}","${l.url}"`)
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `review-links-${teamName.replace(/\s+/g, '-')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    setMsg("📁 Файл CSV загружен");
    setTimeout(() => setMsg(""), 2000);
  }, [links, teamName]);

  const inputStyle = {
    padding: "10px 12px",
    border: "2px solid #e1e5e9",
    borderRadius: 8,
    fontSize: 14,
    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
    width: "100%",
    fontFamily: "inherit"
  };

  const errorInputStyle = {
    ...inputStyle,
    borderColor: "#dc3545",
    boxShadow: "0 0 0 3px rgba(220,53,69,0.1)"
  };

  const labelStyle = {
    display: "block",
    margin: "16px 0 6px",
    fontWeight: 600,
    color: "#495057",
    fontSize: 14
  };

  return (
    <main style={{ 
      padding: 32, 
      maxWidth: 1000, 
      margin: "0 auto",
      fontFamily: "system-ui, -apple-system, sans-serif"
    }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ 
          fontSize: 32, 
          fontWeight: 700, 
          color: "#2c3e50",
          margin: 0,
          marginBottom: 8
        }}>
          🔗 Генерация ссылок для ревью
        </h1>
        <p style={{ 
          color: "#6c757d", 
          fontSize: 16,
          margin: 0
        }}>
          Создайте персональные ссылки для оценки компетенций сотрудников
        </p>
      </div>

      <div style={{ 
        backgroundColor: "#f8f9fa",
        padding: 24,
        borderRadius: 12,
        border: "1px solid #e9ecef",
        marginBottom: 24
      }}>
        <label style={labelStyle}>
          📋 Название команды
        </label>
        <input
          value={teamName}
          onChange={e => setTeamName(e.target.value)}
          placeholder="Введите название команды"
          style={errors.teamName ? errorInputStyle : inputStyle}
          maxLength={50}
        />
        {errors.teamName && (
          <div style={{ color: "#dc3545", fontSize: 12, marginTop: 4 }}>
            {errors.teamName}
          </div>
        )}

        <label style={labelStyle}>
          ⏰ Срок действия (дней)
        </label>
        <input
          type="number"
          min={1}
          max={365}
          value={expDays}
          onChange={e => setExpDays(Number(e.target.value))}
          style={errors.expDays ? errorInputStyle : inputStyle}
        />
        {errors.expDays && (
          <div style={{ color: "#dc3545", fontSize: 12, marginTop: 4 }}>
            {errors.expDays}
          </div>
        )}

        <label style={labelStyle}>
          🔑 Admin Key
        </label>
        <input
          type="password"
          value={adminKey}
          onChange={e => setAdminKey(e.target.value)}
          placeholder="Введите admin key"
          style={errors.adminKey ? errorInputStyle : inputStyle}
        />
        {errors.adminKey && (
          <div style={{ color: "#dc3545", fontSize: 12, marginTop: 4 }}>
            {errors.adminKey}
          </div>
        )}

        {loading && (
          <div style={{ margin: "20px 0" }}>
            <div style={{
              height: 12,
              background: "#e9ecef",
              borderRadius: 6,
              overflow: "hidden",
              marginBottom: 8
            }}>
              <div style={{
                width: `${progress}%`,
                height: "100%",
                background: "linear-gradient(90deg, #007bff, #0056b3)",
                transition: "width 200ms ease-out",
                borderRadius: "inherit"
              }} />
            </div>
            <div style={{ 
              fontSize: 13, 
              color: "#6c757d",
              textAlign: "center"
            }}>
              Генерируем ссылки... {Math.round(progress)}%
            </div>
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <button
            onClick={generate}
            disabled={loading || !validation.isValid}
            style={{
              padding: "12px 24px",
              background: loading || !validation.isValid ? "#6c757d" : "#007bff",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontSize: 16,
              fontWeight: 600,
              cursor: loading || !validation.isValid ? "not-allowed" : "pointer",
              transition: "all 0.2s ease",
              boxShadow: loading || !validation.isValid ? "none" : "0 4px 8px rgba(0,123,255,0.2)"
            }}
          >
            {loading ? "⏳ Генерируем..." : "🚀 Сгенерировать ссылки"}
          </button>
        </div>
      </div>

      {msg && (
        <div style={{
          padding: "12px 16px",
          borderRadius: 8,
          backgroundColor: msg.includes("❌") ? "#f8d7da" : 
                          msg.includes("📋") || msg.includes("📁") ? "#d1ecf1" : "#d4edda",
          color: msg.includes("❌") ? "#721c24" : 
                 msg.includes("📋") || msg.includes("📁") ? "#0c5460" : "#155724",
          border: `1px solid ${msg.includes("❌") ? "#f5c6cb" : 
                               msg.includes("📋") || msg.includes("📁") ? "#bee5eb" : "#c3e6cb"}`,
          marginBottom: 20,
          fontSize: 14,
          fontWeight: 500
        }}>
          {msg}
        </div>
      )}

      {links.length > 0 && (
        <div style={{
          backgroundColor: "white",
          border: "1px solid #dee2e6",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)"
        }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 20px",
            backgroundColor: "#f8f9fa",
            borderBottom: "1px solid #dee2e6"
          }}>
            <h3 style={{ 
              margin: 0, 
              fontSize: 18, 
              fontWeight: 600,
              color: "#495057"
            }}>
              📋 Сгенерированные ссылки ({links.length})
            </h3>
            <button
              onClick={exportLinks}
              style={{
                padding: "6px 12px",
                background: "#28a745",
                color: "white",
                border: "none",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer"
              }}
            >
              💾 Экспорт CSV
            </button>
          </div>

          <div style={{ padding: "0 20px 20px" }}>
            <table style={{ 
              borderCollapse: "collapse", 
              width: "100%",
              marginTop: 16
            }}>
              <thead>
                <tr style={{ backgroundColor: "#f8f9fa" }}>
                  <th style={{
                    textAlign: "left",
                    padding: "12px 8px",
                    fontWeight: 600,
                    color: "#495057",
                    fontSize: 14,
                    borderBottom: "2px solid #dee2e6"
                  }}>
                    👤 Ревьюер
                  </th>
                  <th style={{
                    textAlign: "left",
                    padding: "12px 8px",
                    fontWeight: 600,
                    color: "#495057",
                    fontSize: 14,
                    borderBottom: "2px solid #dee2e6"
                  }}>
                    🔗 Ссылка
                  </th>
                  <th style={{
                    textAlign: "center",
                    padding: "12px 8px",
                    fontWeight: 600,
                    color: "#495057",
                    fontSize: 14,
                    borderBottom: "2px solid #dee2e6",
                    width: 100
                  }}>
                    ⚡ Действия
                  </th>
                </tr>
              </thead>
              <tbody>
                {links.map((link, index) => (
                  <tr 
                    key={index}
                    style={{
                      borderBottom: index < links.length - 1 ? "1px solid #f1f3f4" : "none",
                      transition: "background-color 0.1s ease"
                    }}
                    onMouseEnter={(e) => e.target.parentElement.style.backgroundColor = "#f8f9fa"}
                    onMouseLeave={(e) => e.target.parentElement.style.backgroundColor = "transparent"}
                  >
                    <td style={{
                      padding: "12px 8px",
                      fontSize: 14,
                      color: "#495057",
                      fontWeight: 500
                    }}>
                      {link.name}
                    </td>
                    <td style={{
                      padding: "12px 8px",
                      fontSize: 13,
                      fontFamily: "Monaco, 'Courier New', monospace",
                      maxWidth: 400,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    }}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: "#007bff",
                          textDecoration: "none",
                          borderBottom: "1px dotted #007bff"
                        }}
                        onMouseEnter={(e) => e.target.style.textDecoration = "underline"}
                        onMouseLeave={(e) => e.target.style.textDecoration = "none"}
                        title={link.url}
                      >
                        {link.url.length > 60 ? `${link.url.substring(0, 60)}...` : link.url}
                      </a>
                    </td>
                    <td style={{
                      padding: "12px 8px",
                      textAlign: "center"
                    }}>
                      <button
                        onClick={() => copyLink(link.url)}
                        style={{
                          padding: "4px 8px",
                          background: "#6c757d",
                          color: "white",
                          border: "none",
                          borderRadius: 4,
                          fontSize: 11,
                          cursor: "pointer",
                          transition: "background-color 0.2s ease"
                        }}
                        onMouseEnter={(e) => e.target.style.backgroundColor = "#495057"}
                        onMouseLeave={(e) => e.target.style.backgroundColor = "#6c757d"}
                        title="Копировать ссылку"
                      >
                        📋 Копировать
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {/* Информационная панель */}
      <div style={{
        marginTop: 32,
        padding: 20,
        backgroundColor: "#e7f3ff",
        border: "1px solid #b8daff",
        borderRadius: 8,
        fontSize: 14,
        color: "#004085"
      }}>
        <h4 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>
          ℹ️ Информация
        </h4>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>Ссылки действительны в течение указанного срока</li>
          <li>Каждая ссылка персональна и привязана к конкретному ревьюеру</li>
          <li>Ссылки содержат зашифрованный токен с правами доступа</li>
          <li>После истечения срока ссылки перестают работать</li>
        </ul>
      </div>
    </main>
  );
}