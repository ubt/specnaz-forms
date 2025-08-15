"use client";
import { useEffect, useMemo, useState, useTransition, useCallback } from "react";
import ScoreRow from "@/components/ScoreRow";

export default function FormPage({ params }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState("");
  const [stats, setStats] = useState(null);
  const [pending, startTransition] = useTransition();
  const [lastSaved, setLastSaved] = useState(null);
  const token = params.token;

  // Состояние черновика с оптимизацией
  const [draft, setDraft] = useState({}); // pageId -> { value }
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

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

  // Загрузка данных с улучшенной обработкой ошибок
  useEffect(() => {
    let cancelled = false;
    let retryCount = 0;
    const maxRetries = 3;

    async function loadWithRetry() {
      while (retryCount < maxRetries && !cancelled) {
        setLoading(true);
        setMsg("");
        
        try {
          const res = await fetch(`/api/form/${token}`, { 
            cache: "no-store",
            headers: {
              'Accept': 'application/json',
            }
          });
          
          const data = await res.json();
          
          if (!res.ok) {
            // Специальная обработка для разных типов ошибок
            if (res.status === 401) {
              throw new Error(data?.error || "Ссылка недействительна или истекла");
            }
            if (res.status === 404) {
              throw new Error("Не найдено сотрудников для оценки");
            }
            if (res.status >= 500) {
              throw new Error("Ошибка сервера. Попробуйте обновить страницу");
            }
            throw new Error(data?.error || `HTTP ${res.status}`);
          }
          
          if (!cancelled) {
            setRows(data?.rows || []);
            setStats(data?.stats || null);
            
            // Показываем полезную информацию пользователю
            if (data?.stats) {
              const { totalEmployees, totalSkills, loadTime } = data.stats;
              console.log(`Загружено: ${totalSkills} навыков для ${totalEmployees} сотрудников за ${loadTime}ms`);
            }
            
            if (data?.warning) {
              setMsg(`Предупреждение: ${data.warning}`);
            }
          }
          break; // Успешно загружено
          
        } catch (error) {
          retryCount++;
          console.error(`Load attempt ${retryCount} failed:`, error);
          
          if (retryCount >= maxRetries || cancelled) {
            if (!cancelled) {
              setMsg(error.message || "Не удалось загрузить данные");
            }
            break;
          }
          
          // Экспоненциальная задержка перед повтором
          const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
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
  }, [token]);

  // Оптимизированный обработчик изменений (убрали comment)
  const onRowChange = useCallback((pageId) => (newData) => {
    setDraft(prev => {
      const updated = { ...prev, [pageId]: { value: newData.value } };
      setHasUnsavedChanges(true);
      return updated;
    });
  }, []);

  // Группировка навыков по сотрудникам для лучшего UX
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

  // Автосохранение черновика (опционально)
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    
    const autoSaveTimer = setTimeout(() => {
      // Здесь можно добавить автосохранение в localStorage
      // или отправку на сервер в режиме "draft"
      console.log('Auto-save draft...', Object.keys(draft).length, 'items');
    }, 30000); // Автосохранение через 30 секунд

    return () => clearTimeout(autoSaveTimer);
  }, [draft, hasUnsavedChanges]);

  // Отправка всех оценок
  const submitAll = async () => {
    setMsg("");
    
    const items = Object.entries(draft).map(([pageId, data]) => ({ 
      pageId, 
      value: data.value,
      comment: "" // Убираем комментарии из отправки
    }));
    
    if (!items.length) { 
      setMsg("Нет оценок для отправки. Заполните хотя бы одну оценку.");
      return; 
    }

    startTransition(async () => {
      let progressTimer;
      setProgress(0);
      
      // Симуляция прогресса для лучшего UX
      progressTimer = setInterval(() => {
        setProgress(prev => Math.min(90, prev + Math.random() * 10));
      }, 100);

      try {
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
        
        if (!res.ok) {
          if (res.status === 401) {
            throw new Error("Ссылка истекла. Запросите новую ссылку у администратора.");
          }
          if (res.status === 403) {
            throw new Error("Нет прав для обновления некоторых записей");
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
        
        const successMsg = `Готово! Отправлено ${data.updated || items.length} оценок.`;
        setMsg(successMsg);
        
        // Показываем статистику если есть
        if (data.stats?.updateTime) {
          console.log(`Обновление завершено за ${data.stats.updateTime}ms`);
        }
        
        // Очищаем сообщение через 5 секунд
        setTimeout(() => setMsg(""), 5000);
        
      } catch (error) {
        clearInterval(progressTimer);
        setProgress(0);
        setMsg(error.message || "Ошибка отправки данных");
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
  
  const statsStyle = { 
    display: 'flex', 
    gap: 16, 
    flexWrap: 'wrap',
    fontSize: 14,
    color: '#666'
  };
  
  const buttonGroupStyle = { 
    display: "flex", 
    gap: 12, 
    marginTop: 24,
    flexWrap: 'wrap'
  };
  
  const primaryButtonStyle = { 
    padding: "12px 24px", 
    background: pending ? "#6c757d" : "#007bff", 
    color: "#fff", 
    border: 'none',
    borderRadius: 6,
    fontSize: 16,
    fontWeight: 500,
    cursor: pending ? 'not-allowed' : 'pointer',
    transition: 'background-color 0.2s'
  };
  
  const secondaryButtonStyle = { 
    padding: "12px 24px", 
    background: "#fff", 
    color: "#6c757d", 
    border: '1px solid #dee2e6',
    borderRadius: 6,
    fontSize: 16,
    cursor: 'pointer',
    transition: 'all 0.2s'
  };

  if (loading) {
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
          <div style={statsStyle}>
            <span>📊 Сотрудников: <strong>{stats.totalEmployees}</strong></span>
            <span>🎯 Навыков: <strong>{stats.totalSkills}</strong></span>
            <span>✅ Заполнено: <strong>{progressStats.filled}/{progressStats.total}</strong> ({progressStats.percentage}%)</span>
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
          <div style={buttonGroupStyle}>
            <button
              onClick={submitAll}
              disabled={pending || !Object.keys(draft).length}
              style={primaryButtonStyle}
              onMouseOver={(e) => !pending && (e.target.style.background = '#0056b3')}
              onMouseOut={(e) => !pending && (e.target.style.background = '#007bff')}
            >
              {pending ? "Отправка..." : `Отправить все (${Object.keys(draft).length})`}
            </button>
            
            <button
              onClick={resetForm}
              disabled={pending || !Object.keys(draft).length}
              style={secondaryButtonStyle}
              onMouseOver={(e) => !pending && (e.target.style.background = '#f8f9fa')}
              onMouseOut={(e) => !pending && (e.target.style.background = '#fff')}
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
          <div style={{ color: '#6c757d' }}>
            Возможно, для вас не назначены задачи по оценке, или данные ещё загружаются.
          </div>
        </div>
      )}
      
      {/* Сообщения */}
      {msg && (
        <div style={{ 
          marginTop: 16, 
          padding: 12,
          background: msg.includes('Готово') || msg.includes('✓') ? '#d4edda' : msg.includes('Ошибка') || msg.includes('⚠️') ? '#f8d7da' : '#d1ecf1',
          color: msg.includes('Готово') || msg.includes('✓') ? '#155724' : msg.includes('Ошибка') || msg.includes('⚠️') ? '#721c24' : '#0c5460',
          borderRadius: 6,
          border: `1px solid ${msg.includes('Готово') || msg.includes('✓') ? '#c3e6cb' : msg.includes('Ошибка') || msg.includes('⚠️') ? '#f5c6cb' : '#bee5eb'}`,
          fontSize: 14
        }}>
          {msg}
        </div>
      )}
    </main>
  );
}