"use client";
import { useEffect, useMemo, useState, useTransition, useCallback } from "react";
import ScoreRow from "@/components/ScoreRow";

// Отключаем статическую генерацию для динамических страниц
export const dynamic = 'force-dynamic';

// Генерируем пустой массив для предотвращения статической генерации
export async function generateStaticParams() {
  return []; // Возвращаем пустой массив - никакие параметры не будут предгенерированы
}

export default function FormPage({ params }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState("");
  const [stats, setStats] = useState(null);
  const [pending, startTransition] = useTransition();
  const [lastSaved, setLastSaved] = useState(null);
  const [debugInfo, setDebugInfo] = useState(null);
  const [mounted, setMounted] = useState(false);
  const token = params.token;

  // Состояние черновика
  const [draft, setDraft] = useState({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Проверяем, что компонент смонтирован на клиенте
  useEffect(() => {
    setMounted(true);
  }, []);

  // Маппинг ролей для отображения
  const getRoleDisplayName = (role) => {
    const roleMap = {
      'self': 'Самооценка',
      'p1_peer': 'Peer',
      'p2_peer': 'Peer',
      'manager': 'Менеджер',
      'peer': 'Peer'
    };
    return roleMap[role] || 'Peer';
  };

  // Функция диагностики
  const runDiagnostic = async () => {
    if (!mounted) return;
    
    try {
      const res = await fetch('/api/debug/form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await res.json();
      setDebugInfo(data);
      console.log('Diagnostic results:', data);
    } catch (error) {
      console.error('Diagnostic failed:', error);
      setDebugInfo({ error: error.message });
    }
  };

  // Загрузка данных с улучшенной обработкой ошибок
  useEffect(() => {
    if (!mounted) return;
    
    let cancelled = false;
    let retryCount = 0;
    const maxRetries = 3;

    async function loadWithRetry() {
      while (retryCount < maxRetries && !cancelled) {
        setLoading(true);
        setMsg("");
        
        try {
          console.log(`[LOAD] Attempt ${retryCount + 1} for token: ${token.substring(0, 10)}...`);
          
          const res = await fetch(`/api/form/${token}`, { 
            cache: "no-store",
            headers: {
              'Accept': 'application/json',
            }
          });
          
          console.log(`[LOAD] Response status: ${res.status}`);
          
          const data = await res.json();
          console.log(`[LOAD] Response data:`, data);
          
          if (!res.ok) {
            if (res.status === 401) {
              throw new Error("Ссылка недействительна или истекла");
            }
            if (res.status === 404) {
              throw new Error("Не найдено сотрудников для оценки");
            }
            if (res.status >= 500) {
              throw new Error(data?.error || "Ошибка сервера");
            }
            throw new Error(data?.error || `HTTP ${res.status}`);
          }
          
          if (!cancelled) {
            setRows(data?.rows || []);
            setStats(data?.stats || null);
            
            if (data?.warning) {
              setMsg(`Предупреждение: ${data.warning}`);
            } else if (data?.rows?.length > 0) {
              setMsg(`Загружено ${data.rows.length} навыков для оценки`);
              setTimeout(() => setMsg(""), 3000);
            }
          }
          break; // Успешно загружено
          
        } catch (error) {
          retryCount++;
          console.error(`[LOAD] Attempt ${retryCount} failed:`, error);
          
          if (retryCount >= maxRetries || cancelled) {
            if (!cancelled) {
              setMsg(error.message || "Не удалось загрузить данные");
              console.log('[LOAD] Running diagnostic...');
              await runDiagnostic();
            }
            break;
          }
          
          // Экспоненциальная задержка перед повтором
          const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
          setMsg(`Попытка ${retryCount} не удалась, повтор через ${delay/1000}с...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      if (!cancelled) {
        setLoading(false);
      }
    }

    loadWithRetry();
    
    return () => { 
      cancelled = true; 
    };
  }, [token, mounted]);

  // Оптимизированный обработчик изменений
  const onRowChange = useCallback((pageId) => (newData) => {
    setDraft(prev => {
      const updated = { ...prev, [pageId]: { value: newData.value } };
      setHasUnsavedChanges(true);
      return updated;
    });
  }, []);

  // Группировка навыков по сотрудникам
  const groupedRows = useMemo(() => {
    const groups = {};
    
    rows.forEach(row => {
      const employeeKey = row.employeeId || row.employeeName || 'unknown';
      if (!groups[employeeKey]) {
        groups[employeeKey] = {
          employeeName: row.employeeName || 'Неизвестный сотрудник',
          employeeId: row.employeeId,
          role: row.role,
          skills: []
        };
      }
      groups[employeeKey].skills.push(row);
    });
    
    return Object.values(groups);
  }, [rows]);

  // Счетчики для прогресса
  const progressStats = useMemo(() => {
    const total = rows.length;
    const filled = Object.keys(draft).length;
    
    return {
      total,
      filled,
      percentage: total > 0 ? Math.round((filled / total) * 100) : 0
    };
  }, [rows.length, draft]);

  // Отправка всех оценок
  const submitAll = async () => {
    if (!mounted) return;
    
    setMsg("");
    
    const items = Object.entries(draft).map(([pageId, data]) => ({ 
      pageId, 
      value: data.value,
      comment: ""
    }));
    
    if (!items.length) { 
      setMsg("Нет оценок для отправки. Заполните хотя бы одну оценку.");
      return; 
    }

    startTransition(async () => {
      let progressTimer;
      setProgress(0);
      
      progressTimer = setInterval(() => {
        setProgress(prev => Math.min(90, prev + Math.random() * 10));
      }, 100);

      try {
        console.log(`[SUBMIT] Sending ${items.length} items`);
        
        const res = await fetch(`/api/form/${token}`, {
          method: "POST",
          headers: { 
            "content-type": "application/json",
            "accept": "application/json"
          },
          body: JSON.stringify({ 
            items, 
            mode: "final" 
          }),
        });
        
        const data = await res.json();
        console.log(`[SUBMIT] Response:`, data);
        
        if (!res.ok) {
          if (res.status === 401) {
            throw new Error("Ссылка истекла. Запросите новую ссылку у администратора.");
          }
          if (res.status === 403) {
            throw new Error("Нет прав для обновления записей");
          }
          if (res.status === 429) {
            throw new Error("Слишком много запросов. Попробуйте через несколько секунд.");
          }
          throw new Error(data?.error || `Ошибка ${res.status}`);
        }
        
        clearInterval(progressTimer);
        setProgress(100);
        setHasUnsavedChanges(false);
        setLastSaved(new Date());
        
        const successMsg = `✅ Готово! Отправлено ${data.updated || items.length} оценок.`;
        setMsg(successMsg);
        
        setTimeout(() => setMsg(""), 5000);
        
      } catch (error) {
        clearInterval(progressTimer);
        setProgress(0);
        setMsg(`❌ ${error.message || "Ошибка отправки данных"}`);
        console.error('Submit error:', error);
      }
    });
  };

  // Сброс формы
  const resetForm = () => {
    setDraft({});
    setHasUnsavedChanges(false);
    setMsg("Форма очищена");
    setTimeout(() => setMsg(""), 3000);
  };

  // Стили
  const containerStyle = { 
    padding: 16, 
    maxWidth: 1200, 
    margin: '0 auto',
    fontFamily: 'system-ui, sans-serif'
  };
  
  const headerStyle = { 
    marginBottom: 24,
    padding: 16,
    background: '#f8f9fa',
    borderRadius: 8,
    border: '1px solid #e9ecef'
  };

  // Показываем загрузку, пока компонент не смонтирован
  if (!mounted || loading) {
    return (
      <main style={containerStyle}>
        <div style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 18, marginBottom: 16 }}>Загрузка данных...</div>
          <div style={{ 
            width: 200, 
            height: 4, 
            background: '#e9ecef', 
            borderRadius: 2, 
            margin: '0 auto',
            overflow: 'hidden'
          }}>
            <div style={{ 
              width: '30%', 
              height: '100%', 
              background: '#007bff',
              animation: 'loading 1.5s ease-in-out infinite'
            }} />
          </div>
          
          {/* Показываем диагностику если есть ошибки */}
          {debugInfo && (
            <div style={{ 
              marginTop: 24,
              padding: 16,
              background: '#f8f9fa',
              borderRadius: 8,
              textAlign: 'left',
              fontSize: 12,
              fontFamily: 'monospace'
            }}>
              <h4>Диагностика:</h4>
              <pre>{JSON.stringify(debugInfo, null, 2)}</pre>
            </div>
          )}
        </div>
        <style jsx>{`
          @keyframes loading {
            0% { transform: translateX(-100%); }
            50% { transform: translateX(200%); }
            100% { transform: translateX(300%); }
          }
        `}</style>
      </main>
    );
  }

  return (
    <main style={containerStyle}>
      {/* Заголовок и статистика */}
      <div style={headerStyle}>
        <h1 style={{ margin: 0, marginBottom: 16, fontSize: 24 }}>
          Оценка компетенций
        </h1>
        
        {stats && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 14, color: '#666' }}>
            <span>📊 Сотрудников: <strong>{stats.totalEmployees}</strong></span>
            <span>🎯 Навыков: <strong>{stats.totalSkills}</strong></span>
            <span>✅ Заполнено: <strong>{progressStats.filled}/{progressStats.total}</strong> ({progressStats.percentage}%)</span>
            {stats.reviewerRole && (
              <span>👤 Роль: <strong>{getRoleDisplayName(stats.reviewerRole)}</strong></span>
            )}
          </div>
        )}
        
        {lastSaved && (
          <div style={{ fontSize: 12, color: '#28a745', marginTop: 8 }}>
            ✓ Последнее сохранение: {lastSaved.toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Основной контент */}
      {groupedRows.length ? (
        <>
          {/* Группы по сотрудникам */}
          {groupedRows.map((group, groupIndex) => (
            <div key={group.employeeId || groupIndex} style={{ marginBottom: 32 }}>
              <h2 style={{ 
                fontSize: 20, 
                marginBottom: 16, 
                color: '#495057',
                borderBottom: '2px solid #e9ecef',
                paddingBottom: 8
              }}>
                {group.employeeName}
                <span style={{ 
                  fontSize: 14, 
                  color: '#6c757d', 
                  fontWeight: 'normal',
                  marginLeft: 8
                }}>
                  ({group.skills.length} навыков)
                </span>
                <span style={{
                  fontSize: 14,
                  color: '#007bff',
                  fontWeight: 600,
                  marginLeft: 8,
                  padding: '2px 8px',
                  background: '#e7f3ff',
                  borderRadius: 4,
                  border: '1px solid #b8daff'
                }}>
                  {getRoleDisplayName(group.role)}
                </span>
              </h2>
              
              <div style={{ display: "grid", gap: 8 }}>
                {group.skills.map((row) => (
                  <ScoreRow 
                    key={row.pageId} 
                    item={row} 
                    onChange={onRowChange(row.pageId)}
                    initialValue={draft[row.pageId]}
                    hideComment={true}
                  />
                ))}
              </div>
            </div>
          ))}
          
          {/* Элементы управления */}
          <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
            <button
              onClick={submitAll}
              disabled={pending || !Object.keys(draft).length}
              style={{
                padding: "12px 24px",
                background: pending || !Object.keys(draft).length ? "#6c757d" : "#007bff",
                color: "white",
                border: "none",
                borderRadius: 8,
                fontSize: 16,
                fontWeight: 600,
                cursor: pending || !Object.keys(draft).length ? "not-allowed" : "pointer",
                transition: "all 0.2s ease"
              }}
            >
              {pending ? "Отправка..." : `Отправить все (${Object.keys(draft).length})`}
            </button>
            
            <button
              onClick={resetForm}
              disabled={pending || !Object.keys(draft).length}
              style={{
                padding: "12px 24px",
                background: "#fff",
                color: "#6c757d",
                border: '1px solid #dee2e6',
                borderRadius: 8,
                fontSize: 16,
                cursor: pending || !Object.keys(draft).length ? "not-allowed" : "pointer",
                transition: 'all 0.2s'
              }}
            >
              Очистить форму
            </button>
            
            {hasUnsavedChanges && (
              <span style={{ 
                alignSelf: 'center', 
                color: '#ffc107', 
                fontSize: 14,
                fontWeight: 500
              }}>
                ⚠️ Есть несохранённые изменения
              </span>
            )}
          </div>
          
          {/* Прогресс отправки */}
          {progress > 0 && progress < 100 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                marginBottom: 8,
                fontSize: 14,
                color: '#495057'
              }}>
                <span>Отправка данных...</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div style={{ 
                height: 8, 
                background: '#e9ecef', 
                borderRadius: 4, 
                overflow: 'hidden'
              }}>
                <div style={{ 
                  width: `${progress}%`, 
                  height: '100%', 
                  background: '#28a745',
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ 
          textAlign: 'center', 
          padding: 48,
          background: '#f8f9fa',
          borderRadius: 8,
          border: '1px solid #e9ecef'
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎯</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>Нет сотрудников для оценки</div>
          <div style={{ color: '#6c757d', marginBottom: 16 }}>
            Возможно, для вас не назначены задачи по оценке, или данные ещё загружаются.
          </div>
          
          {/* Кнопка диагностики */}
          <button
            onClick={runDiagnostic}
            style={{
              padding: "8px 16px",
              background: "#17a2b8",
              color: "white",
              border: "none",
              borderRadius: 4,
              fontSize: 14,
              cursor: "pointer"
            }}
          >
            🔍 Запустить диагностику
          </button>
          
          {/* Показываем результаты диагностики */}
          {debugInfo && (
            <div style={{ 
              marginTop: 24,
              padding: 16,
              background: '#fff',
              borderRadius: 8,
              textAlign: 'left',
              fontSize: 12,
              fontFamily: 'monospace',
              border: '1px solid #ddd',
              maxHeight: 400,
              overflow: 'auto'
            }}>
              <h4 style={{ fontFamily: 'system-ui', fontSize: 16, marginBottom: 12 }}>
                Результаты диагностики:
              </h4>
              <pre>{JSON.stringify(debugInfo, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
      
      {/* Сообщения */}
      {msg && (
        <div style={{ 
          marginTop: 16, 
          padding: 12,
          background: msg.includes('✅') || msg.includes('✓') ? '#d4edda' : 
                     msg.includes('❌') || msg.includes('⚠️') ? '#f8d7da' : '#d1ecf1',
          color: msg.includes('✅') || msg.includes('✓') ? '#155724' : 
                 msg.includes('❌') || msg.includes('⚠️') ? '#721c24' : '#0c5460',
          borderRadius: 6,
          border: `1px solid ${msg.includes('✅') || msg.includes('✓') ? '#c3e6cb' : 
                                msg.includes('❌') || msg.includes('⚠️') ? '#f5c6cb' : '#bee5eb'}`,
          fontSize: 14
        }}>
          {msg}
        </div>
      )}
    </main>
  );
}