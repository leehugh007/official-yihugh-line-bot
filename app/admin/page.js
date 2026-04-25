'use client';

import { useState, useEffect, useCallback } from 'react';

// ============================================================
// 常數
// ============================================================
const SEGMENT_LABELS = {
  active: { label: '活躍', icon: '🔥', color: '#ef4444' },
  warm: { label: '溫熱', icon: '🟡', color: '#f59e0b' },
  new: { label: '新加入', icon: '🆕', color: '#3b82f6' },
  silent: { label: '沉默', icon: '🧊', color: '#94a3b8' },
  admin: { label: '管理者', icon: '👨‍💼', color: '#8b5cf6' },
};

// 圖片上傳元件
function ImageUpload({ imageUrl, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 前端驗證
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('只支援 JPG / PNG / WebP');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('檔案不可超過 2MB');
      return;
    }

    setError('');
    setUploading(true);

    try {
      // 轉 Base64
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(file);
      });

      const res = await apiPost({
        action: 'upload_image',
        fileName: file.name,
        fileBase64: base64,
        contentType: file.type,
      });

      if (res.url) {
        onChange(res.url);
      } else {
        setError(res.error || '上傳失敗');
      }
    } catch {
      setError('上傳失敗');
    }
    setUploading(false);
  };

  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#444', margin: '12px 0 4px' }}>
        圖片<span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>（選填，顯示在訊息頂部）</span>
      </label>
      {imageUrl ? (
        <div style={{ position: 'relative', maxWidth: 280, marginBottom: 8 }}>
          <img src={imageUrl} alt="" style={{ width: '100%', borderRadius: 8, display: 'block' }} />
          <button
            onClick={() => onChange('')}
            style={{
              position: 'absolute', top: 6, right: 6,
              background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none',
              borderRadius: '50%', width: 24, height: 24, cursor: 'pointer',
              fontSize: 14, lineHeight: '24px', textAlign: 'center',
            }}
          >
            ✕
          </button>
        </div>
      ) : (
        <label style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '100%', maxWidth: 280, height: 80,
          border: '2px dashed #d1d5db', borderRadius: 8,
          cursor: uploading ? 'wait' : 'pointer',
          color: '#94a3b8', fontSize: 13, marginBottom: 8,
        }}>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFile} style={{ display: 'none' }} disabled={uploading} />
          {uploading ? '上傳中...' : '點擊上傳圖片'}
        </label>
      )}
      {error && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 4 }}>{error}</div>}
    </div>
  );
}

// 訊息預覽元件：模擬 LINE Flex Message 樣式
function FlexPreview({ message, buttons, imageUrl }) {
  const cleanButtons = (buttons || []).filter((b) => b.label && b.url);
  if (!message && cleanButtons.length === 0 && !imageUrl) return null;

  const lines = (message || '').split('\n').filter((l) => l.trim());
  const title = lines[0] || '';
  const body = lines.slice(1).join('\n').trim();

  const hasFlex = cleanButtons.length > 0 || !!imageUrl;

  return (
    <div style={{
      marginTop: 12, borderRadius: 12, overflow: 'hidden',
      border: '1px solid #e5e7eb', maxWidth: 280,
    }}>
      <div style={{ fontSize: 11, color: '#94a3b8', padding: '6px 12px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
        LINE 預覽
      </div>
      {hasFlex ? (
        <div style={{ background: '#fff' }}>
          {imageUrl && <img src={imageUrl} alt="" style={{ width: '100%', display: 'block' }} />}
          <div style={{ padding: '14px 16px' }}>
            {title && <div style={{ fontWeight: 700, fontSize: 15, marginBottom: body ? 6 : 0, whiteSpace: 'pre-wrap' }}>{title}</div>}
            {body && <div style={{ fontSize: 13, color: '#666', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{body}</div>}
          </div>
          {cleanButtons.length > 0 && (
            <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {cleanButtons.map((btn, i) => (
                <div key={i} style={{
                  padding: '10px 12px', borderRadius: 8, fontSize: 14, textAlign: 'center', fontWeight: 600,
                  background: i === 0 ? '#2a9d6f' : '#f1f5f9',
                  color: i === 0 ? '#fff' : '#334155',
                  cursor: 'default',
                }}>
                  {btn.label}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: '12px 16px', fontSize: 14, whiteSpace: 'pre-wrap', background: '#fff', lineHeight: 1.5 }}>
          {message}
        </div>
      )}
    </div>
  );
}

const MODE_LABELS = {
  instant: { label: '即時', desc: '幾秒內送達', color: '#ef4444' },
  queued: { label: '佇列', desc: '約 25 分鐘', color: '#3b82f6' },
  scheduled: { label: '排程', desc: '指定時間送出', color: '#8b5cf6' },
};

// ============================================================
// 24 小時制日期時間選擇器
// ============================================================
function DateTimePicker24({ value, onChange, style }) {
  const [date, setDate] = useState('');
  const [hour, setHour] = useState('');
  const [minute, setMinute] = useState('');

  useEffect(() => {
    if (value) {
      const [d, t] = value.split('T');
      if (d) setDate(d);
      if (t) {
        const [h, m] = t.split(':');
        setHour(h || '');
        setMinute(m || '');
      }
    }
  }, []);

  const update = (newDate, newHour, newMinute) => {
    setDate(newDate);
    setHour(newHour);
    setMinute(newMinute);
    if (newDate && newHour !== '' && newMinute !== '') {
      // 加上 +08:00 確保 Vercel (UTC) 伺服器正確解析為台灣時間
      onChange(`${newDate}T${newHour.padStart(2, '0')}:${newMinute.padStart(2, '0')}:00+08:00`);
    } else {
      onChange('');
    }
  };

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', ...style }}>
      <input
        type="date"
        value={date}
        onChange={(e) => update(e.target.value, hour, minute)}
        style={{ ...styles.input, flex: 1, minWidth: 140, marginBottom: 0 }}
      />
      <select
        value={hour}
        onChange={(e) => update(date, e.target.value, minute || '00')}
        style={{ ...styles.input, width: 70, marginBottom: 0 }}
      >
        <option value="">時</option>
        {Array.from({ length: 24 }, (_, i) => (
          <option key={i} value={String(i).padStart(2, '0')}>{String(i).padStart(2, '0')}</option>
        ))}
      </select>
      <span style={{ color: '#64748b', fontWeight: 600 }}>:</span>
      <select
        value={minute}
        onChange={(e) => update(date, hour || '00', e.target.value)}
        style={{ ...styles.input, width: 70, marginBottom: 0 }}
      >
        <option value="">分</option>
        {['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'].map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </div>
  );
}

// ============================================================
// API 工具
// ============================================================
function apiUrl(action) {
  return `/api/admin?action=${action}&secret=${sessionStorage.getItem('admin_secret') || ''}`;
}

async function apiPost(data) {
  const secret = sessionStorage.getItem('admin_secret') || '';
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, ...data }),
  });
  return res.json();
}

// ============================================================
// 主頁面
// ============================================================
export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // 資料
  const [stats, setStats] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  // UI 狀態
  const [editingId, setEditingId] = useState(null);
  const [confirmPush, setConfirmPush] = useState(null); // { template, targetCount }
  const [pushResult, setPushResult] = useState(null);
  const [queueProgress, setQueueProgress] = useState(null);
  const [showCustom, setShowCustom] = useState(false);
  const [tab, setTab] = useState('push'); // push | history | drip | users
  const [dripStats, setDripStats] = useState(null);
  const [settings, setSettings] = useState({});

  // 用戶管理
  const [usersData, setUsersData] = useState(null);
  const [usersSearch, setUsersSearch] = useState('');
  const [usersFilter, setUsersFilter] = useState({ segment: '', source: '', tag: '' });
  const [usersPage, setUsersPage] = useState(1);
  const [sources, setSources] = useState([]);

  // 報名管理（Phase 4.5）
  const [applicationsData, setApplicationsData] = useState(null);
  const [applicationsFilter, setApplicationsFilter] = useState('all'); // all|pending|paid|cancelled
  const [markedBy, setMarkedBy] = useState(
    typeof window !== 'undefined'
      ? sessionStorage.getItem('admin_marked_by') || 'yixiu'
      : 'yixiu'
  );

  const loadApplications = useCallback(async (filter = 'all') => {
    const params = new URLSearchParams({
      action: 'applications',
      filter,
      secret: sessionStorage.getItem('admin_secret') || '',
    });
    const res = await fetch(`/api/admin?${params}`);
    const data = await res.json();
    setApplicationsData(data);
  }, []);

  const loadUsers = useCallback(async (page = 1, search = '', filters = {}) => {
    const params = new URLSearchParams({
      action: 'users',
      secret: sessionStorage.getItem('admin_secret') || '',
      page: String(page),
    });
    if (search) params.set('search', search);
    if (filters.segment) params.set('segment', filters.segment);
    if (filters.source) params.set('source', filters.source);
    if (filters.tag) params.set('tag', filters.tag);

    const res = await fetch(`/api/admin?${params}`);
    const data = await res.json();
    setUsersData(data);
  }, []);

  const loadSources = useCallback(async () => {
    const res = await fetch(apiUrl('sources'));
    const data = await res.json();
    setSources(data);
  }, []);

  // 載入資料
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t, l, settingsData] = await Promise.all([
        fetch(apiUrl('stats')).then((r) => r.json()),
        fetch(apiUrl('templates')).then((r) => r.json()),
        fetch(apiUrl('logs')).then((r) => r.json()),
        fetch(apiUrl('settings')).then((r) => r.json()),
      ]);
      setStats(s);
      setTemplates(t);
      setLogs(l);
      setSettings(Object.fromEntries((settingsData || []).map(s => [s.key, s.value])));
    } catch (e) {
      console.error('Load error:', e);
    }
    setLoading(false);
  }, []);

  // 登入
  const handleLogin = async () => {
    sessionStorage.setItem('admin_secret', password);
    try {
      const res = await fetch(apiUrl('stats'));
      if (res.ok) {
        setAuthed(true);
        setLoginError('');
        loadData();
      } else {
        setLoginError('密碼錯誤');
        sessionStorage.removeItem('admin_secret');
      }
    } catch {
      setLoginError('連線失敗');
    }
  };

  // 自動登入（如果 sessionStorage 有密碼）
  useEffect(() => {
    const saved = sessionStorage.getItem('admin_secret');
    if (saved) {
      setPassword(saved);
      fetch(`/api/admin?action=stats&secret=${saved}`)
        .then((r) => {
          if (r.ok) {
            setAuthed(true);
            loadData();
          }
        })
        .catch(() => {});
    }
  }, [loadData]);

  // ============================================================
  // 登入畫面
  // ============================================================
  if (!authed) {
    return (
      <div style={styles.loginWrap}>
        <div style={styles.loginCard}>
          <h1 style={styles.loginTitle}>一休官方 LINE 推播後台</h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="輸入管理密碼"
            style={styles.input}
            autoFocus
          />
          {loginError && <p style={styles.error}>{loginError}</p>}
          <button onClick={handleLogin} style={styles.btnPrimary}>
            登入
          </button>
        </div>
      </div>
    );
  }

  // ============================================================
  // 推播操作
  // ============================================================
  const handleConfirmPush = async (template, overrides = {}) => {
    const mergedTemplate = { ...template, ...overrides };
    const result = await apiPost({
      action: 'count_targets',
      segments: mergedTemplate.segments,
      allUsers: mergedTemplate.allUsers || false,
      excludeEnrolled: mergedTemplate.excludeEnrolled || false,
      adminOnly: mergedTemplate.adminOnly || false,
    });
    setConfirmPush({ template: mergedTemplate, targetCount: result.count });
  };

  const handleSendPush = async () => {
    if (!confirmPush) return;
    const { template, targetCount } = confirmPush;
    setConfirmPush(null);

    const result = await apiPost({
      action: 'push',
      templateId: template.id,
      label: template.name,
      message: template.message,
      buttons: template.buttons || [],
      linkUrl: template.link_url,
      linkText: template.link_text,
      imageUrl: template.image_url || undefined,
      segments: template.segments,
      mode: template.mode,
      allUsers: template.allUsers || false,
      excludeEnrolled: template.excludeEnrolled || false,
      adminOnly: template.adminOnly || false,
      scheduled_at: template.scheduled_at,
    });

    if (result.mode === 'queued') {
      // 開始佇列處理
      setQueueProgress({ logId: result.logId, total: result.total, sent: 0, label: template.name });
      processQueue(result.logId, result.total, template.name);
    } else {
      setPushResult({
        label: template.name,
        sent: result.sent,
        total: result.total,
      });
      loadData();
    }
  };

  const processQueue = async (logId, total, label) => {
    let done = false;
    while (!done) {
      const result = await apiPost({ action: 'process_queue', logId });
      setQueueProgress({
        logId,
        total,
        sent: result.sentCount || 0,
        label,
      });
      done = result.done;
      if (!done) {
        await new Promise((r) => setTimeout(r, 500)); // 小延遲避免打太快
      }
    }
    setQueueProgress(null);
    setPushResult({ label, sent: total, total });
    loadData();
  };

  // 模板更新
  const handleSaveTemplate = async (id, updates) => {
    await apiPost({ action: 'update_template', id, ...updates });
    setEditingId(null);
    loadData();
  };

  // 自訂推播
  const handleCustomPush = async (data) => {
    const result = await apiPost({
      action: 'count_targets',
      segments: data.segments,
      allUsers: data.allUsers || false,
      excludeEnrolled: data.excludeEnrolled || false,
      adminOnly: data.adminOnly || false,
    });
    setConfirmPush({
      template: {
        ...data,
        id: null,
        name: '自訂推播',
      },
      targetCount: result.count,
    });
    setShowCustom(false);
  };

  // ============================================================
  // 主畫面
  // ============================================================
  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <h1 style={styles.headerTitle}>推播後台</h1>
        <span style={styles.headerSub}>一休陪你健康瘦</span>
      </header>

      {/* 統計區 */}
      {stats && <StatsBar stats={stats} />}

      {/* Tab 切換 */}
      <div style={styles.tabs}>
        <button
          style={tab === 'push' ? styles.tabActive : styles.tab}
          onClick={() => setTab('push')}
        >
          推播
        </button>
        <button
          style={tab === 'history' ? styles.tabActive : styles.tab}
          onClick={() => setTab('history')}
        >
          紀錄
        </button>
        <button
          style={tab === 'drip' ? styles.tabActive : styles.tab}
          onClick={() => {
            setTab('drip');
            if (!dripStats) {
              fetch(apiUrl('drip_stats')).then(r => r.json()).then(setDripStats);
            }
          }}
        >
          排程
        </button>
        <button
          style={tab === 'users' ? styles.tabActive : styles.tab}
          onClick={() => {
            setTab('users');
            if (!usersData) loadUsers(1, '', usersFilter);
            if (sources.length === 0) loadSources();
          }}
        >
          用戶
        </button>
        <button
          style={tab === 'applications' ? styles.tabActive : styles.tab}
          onClick={() => {
            setTab('applications');
            if (!applicationsData) loadApplications(applicationsFilter);
          }}
        >
          📝 報名
        </button>
        <button
          style={tab === 'settings' ? styles.tabActive : styles.tab}
          onClick={() => setTab('settings')}
        >
          設定
        </button>
      </div>

      {/* 推播 Tab */}
      {tab === 'push' && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>快速推播</h2>
          <p style={styles.sectionDesc}>
            事先編輯好內容，到時候一鍵送出
          </p>

          <div style={styles.templateGrid}>
            {templates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                stats={stats}
                isEditing={editingId === t.id}
                onEdit={() => setEditingId(editingId === t.id ? null : t.id)}
                onSave={(updates) => handleSaveTemplate(t.id, updates)}
                onSend={(overrides) => handleConfirmPush(t, overrides)}
                onCancel={() => setEditingId(null)}
              />
            ))}
          </div>

          {/* 自訂推播 */}
          <div style={{ marginTop: 24 }}>
            {!showCustom ? (
              <button
                onClick={() => setShowCustom(true)}
                style={styles.btnOutline}
              >
                + 建立自訂推播
              </button>
            ) : (
              <CustomPushForm
                stats={stats}
                onSend={handleCustomPush}
                onCancel={() => setShowCustom(false)}
              />
            )}
          </div>
        </div>
      )}

      {/* 紀錄 Tab */}
      {tab === 'history' && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>推播紀錄</h2>
          <PushHistory logs={logs} onReload={async () => {
            const l = await fetch(apiUrl('logs')).then(r => r.json());
            setLogs(l);
          }} />
        </div>
      )}

      {/* 排程 Tab */}
      {tab === 'drip' && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>文章排程</h2>
          <p style={styles.sectionDesc}>
            用戶加入後自動推送，每週一篇，已報名者自動停止
          </p>
          {dripStats && <DripTab dripStats={dripStats} onUpdate={async (stepNumber, updates) => {
            await apiPost({ action: 'update_drip', step_number: stepNumber, ...updates });
            const refreshed = await fetch(apiUrl('drip_stats')).then(r => r.json());
            setDripStats(refreshed);
          }} onToggleActive={async (stepNumber, active) => {
            const res = await apiPost({ action: 'toggle_drip_active', step_number: stepNumber, active });
            if (res.error) return res;
            const refreshed = await fetch(apiUrl('drip_stats')).then(r => r.json());
            setDripStats(refreshed);
            return res;
          }} onToggleTestMode={async (enabled) => {
            await apiPost({ action: 'toggle_drip_test_mode', enabled });
            const refreshed = await fetch(apiUrl('drip_stats')).then(r => r.json());
            setDripStats(refreshed);
          }} onAddStep={async () => {
            const res = await apiPost({ action: 'add_drip_step' });
            if (res.error) return res;
            const refreshed = await fetch(apiUrl('drip_stats')).then(r => r.json());
            setDripStats(refreshed);
            return res;
          }} onDeleteStep={async (stepNumber) => {
            const res = await apiPost({ action: 'delete_drip_step', step_number: stepNumber });
            if (res.error) return res;
            const refreshed = await fetch(apiUrl('drip_stats')).then(r => r.json());
            setDripStats(refreshed);
            return res;
          }} />}
        </div>
      )}

      {/* 用戶 Tab */}
      {tab === 'users' && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>用戶管理</h2>
          <p style={styles.sectionDesc}>查看用戶、標記已報名、管理加入來源</p>

          <UsersTab
            usersData={usersData}
            search={usersSearch}
            filters={usersFilter}
            sources={sources}
            page={usersPage}
            onSearch={(s) => {
              setUsersSearch(s);
              setUsersPage(1);
              loadUsers(1, s, usersFilter);
            }}
            onFilter={(f) => {
              setUsersFilter(f);
              setUsersPage(1);
              loadUsers(1, usersSearch, f);
            }}
            onClear={() => {
              setUsersSearch('');
              setUsersFilter({ segment: '', source: '', tag: '' });
              setUsersPage(1);
              loadUsers(1, '', { segment: '', source: '', tag: '' });
            }}
            onPageChange={(p) => {
              setUsersPage(p);
              loadUsers(p, usersSearch, usersFilter);
            }}
            onTagUser={async (userId, tags) => {
              await apiPost({ action: 'update_user_tags', userId, tags });
              loadUsers(usersPage, usersSearch, usersFilter);
              loadData();
            }}
            onAddSource={async (source) => {
              await apiPost({ action: 'add_source', ...source });
              loadSources();
            }}
            onDeleteSource={async (id) => {
              await apiPost({ action: 'delete_source', id });
              loadSources();
            }}
          />
        </div>
      )}

      {/* 報名 Tab（Phase 4.5）*/}
      {tab === 'applications' && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>📝 報名管理</h2>
          <p style={styles.sectionDesc}>
            查看 /apply 表單送出的報名資料、標記已付款、編輯匯款資訊
          </p>
          <ApplicationsTab
            data={applicationsData}
            filter={applicationsFilter}
            markedBy={markedBy}
            onMarkedByChange={(v) => {
              setMarkedBy(v);
              sessionStorage.setItem('admin_marked_by', v);
            }}
            onFilterChange={(f) => {
              setApplicationsFilter(f);
              loadApplications(f);
            }}
            onMarkPaid={async ({ id, last5, amount, date }) => {
              const res = await apiPost({
                action: 'mark_application_paid',
                id, last5, amount, date, marked_by: markedBy,
              });
              if (res?.ok) {
                loadApplications(applicationsFilter);
                return { ok: true };
              }
              return { ok: false, error: res?.error || 'unknown' };
            }}
            onCancel={async ({ id, notes }) => {
              const res = await apiPost({
                action: 'cancel_application',
                id, notes, marked_by: markedBy,
              });
              if (res?.ok) {
                loadApplications(applicationsFilter);
                return { ok: true };
              }
              return { ok: false, error: res?.error || 'unknown' };
            }}
            onEditPayment={async ({ id, last5, amount, date, notes }) => {
              const res = await apiPost({
                action: 'update_application_payment',
                id, last5, amount, date, notes, marked_by: markedBy,
              });
              if (res?.ok) {
                loadApplications(applicationsFilter);
                return { ok: true };
              }
              return { ok: false, error: res?.error || 'unknown' };
            }}
            onReload={() => loadApplications(applicationsFilter)}
          />
        </div>
      )}

      {/* 設定 Tab */}
      {tab === 'settings' && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>關鍵字回覆設定</h2>
          <p style={styles.sectionDesc}>用戶傳關鍵字時的自動回覆內容</p>
          <SettingsTab settings={settings} onSave={async (key, value) => {
            await apiPost({ action: 'update_setting', key, value });
            setSettings(prev => ({ ...prev, [key]: value }));
          }} />
        </div>
      )}

      {/* 確認彈窗 */}
      {confirmPush && (
        <ConfirmModal
          template={confirmPush.template}
          targetCount={confirmPush.targetCount}
          onConfirm={handleSendPush}
          onCancel={() => setConfirmPush(null)}
        />
      )}

      {/* 佇列進度 */}
      {queueProgress && <QueueProgressModal progress={queueProgress} />}

      {/* 送出結果 */}
      {pushResult && (
        <ResultModal
          result={pushResult}
          onClose={() => setPushResult(null)}
        />
      )}

      {loading && <div style={styles.loadingBar} />}
    </div>
  );
}

// ============================================================
// 統計列
// ============================================================
function StatsBar({ stats }) {
  return (
    <div style={styles.statsBar}>
      <div style={styles.statMain}>
        <span style={styles.statNumber}>{stats.total}</span>
        <span style={styles.statLabel}>位用戶</span>
      </div>
      <div style={styles.statSegments}>
        {Object.entries(SEGMENT_LABELS).map(([key, { label, icon }]) => (
          <div key={key} style={styles.statChip}>
            <span>{icon}</span>
            <span style={styles.statChipNum}>{stats.segments[key] || 0}</span>
            <span style={styles.statChipLabel}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 模板卡片
// ============================================================
function TemplateCard({ template, stats, isEditing, onEdit, onSave, onSend, onCancel }) {
  const [editData, setEditData] = useState({});
  const [scheduledAt, setScheduledAt] = useState('');
  const [excludeEnrolled, setExcludeEnrolled] = useState(false);
  const [adminTargetCount, setAdminTargetCount] = useState(0);

  useEffect(() => {
    if (isEditing) {
      // 從 template.buttons 取；若空則從舊 link_url/link_text 轉換
      const initialButtons =
        template.buttons && template.buttons.length > 0
          ? [...template.buttons, { label: '', url: '' }].slice(0, 2)
          : template.link_url
          ? [{ label: template.link_text || '點這裡', url: template.link_url }, { label: '', url: '' }]
          : [{ label: '', url: '' }, { label: '', url: '' }];

      setEditData({
        message: template.message,
        buttons: initialButtons,
        segments: [...template.segments],
        mode: template.mode,
        allUsers: false,
        image_url: template.image_url || '',
      });
      loadAdminCount();
    }
  }, [isEditing, template]);

  // 載入管理者人數
  const loadAdminCount = async () => {
    try {
      const res = await apiPost({
        action: 'count_targets',
        adminOnly: true,
      });
      setAdminTargetCount(res.count || 0);
    } catch {
      setAdminTargetCount(0);
    }
  };

  const targetCount = template.segments.reduce(
    (sum, seg) => sum + (stats?.segments[seg] || 0),
    0
  );

  const modeInfo = MODE_LABELS[template.mode];

  // 編輯中的即時人數計算
  const editTargetCount = editData.adminOnly
    ? adminTargetCount
    : editData.allUsers
    ? Object.values(stats?.segments || {}).reduce((a, b) => a + b, 0)
    : (editData.segments || []).reduce((sum, seg) => sum + (stats?.segments[seg] || 0), 0);

  const editModeInfo = MODE_LABELS[editData.mode || template.mode];

  if (isEditing) {
    return (
      <div style={styles.cardEditing}>
        <div style={styles.cardHeader}>
          <span style={styles.cardIcon}>{template.icon}</span>
          <div>
            <div style={styles.cardName}>{template.name}</div>
            <div style={styles.cardMeta}>
              <span style={{ ...styles.modeBadge, background: (editModeInfo?.color || '#888') + '18', color: editModeInfo?.color || '#888' }}>
                {editModeInfo?.label || '即時'}
              </span>
              <span style={styles.cardTarget}>→ {editTargetCount} 人</span>
            </div>
          </div>
        </div>

        <label style={styles.fieldLabel}>訊息內容</label>
        <textarea
          value={editData.message || ''}
          onChange={(e) => setEditData({ ...editData, message: e.target.value })}
          style={styles.textarea}
          rows={6}
        />

        {[0, 1].map((i) => (
          <div key={i}>
            <label style={styles.fieldLabel}>
              按鈕 {i + 1}{i === 1 && <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>（選填）</span>}
            </label>
            <input
              value={editData.buttons?.[i]?.label || ''}
              onChange={(e) => {
                const btns = [...(editData.buttons || [{}, {}])];
                btns[i] = { ...btns[i], label: e.target.value };
                setEditData({ ...editData, buttons: btns });
              }}
              style={{ ...styles.input, marginBottom: 4 }}
              placeholder={i === 0 ? '例如：🎥 觀看說明會回放' : '例如：👇 立即報名'}
            />
            <input
              value={editData.buttons?.[i]?.url || ''}
              onChange={(e) => {
                const btns = [...(editData.buttons || [{}, {}])];
                btns[i] = { ...btns[i], url: e.target.value };
                setEditData({ ...editData, buttons: btns });
              }}
              style={styles.input}
              placeholder="https://..."
            />
          </div>
        ))}

        <ImageUpload imageUrl={editData.image_url || ''} onChange={(url) => setEditData({ ...editData, image_url: url })} />

        <FlexPreview message={editData.message} buttons={editData.buttons} imageUrl={editData.image_url} />

        <label style={styles.fieldLabel}>推給誰</label>
        <div style={styles.segmentCheckboxes}>
          <label style={{ ...styles.checkbox, fontWeight: 600, color: '#8b5cf6' }}>
            <input
              type="checkbox"
              checked={editData.adminOnly || false}
              onChange={(e) => setEditData({ ...editData, adminOnly: e.target.checked, allUsers: false })}
            />
            <span>👨‍💼 僅管理者（測試用）</span>
          </label>
          {!editData.adminOnly && (
            <>
              <label style={{ ...styles.checkbox, fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={editData.allUsers || false}
                  onChange={(e) => setEditData({ ...editData, allUsers: e.target.checked })}
                />
                <span>👥 所有人</span>
              </label>
              {!editData.allUsers && Object.entries(SEGMENT_LABELS).map(([key, { label, icon }]) => (
                <label key={key} style={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={editData.segments?.includes(key)}
                    onChange={(e) => {
                      const segs = editData.segments || [];
                      setEditData({
                        ...editData,
                        segments: e.target.checked
                          ? [...segs, key]
                          : segs.filter((s) => s !== key),
                      });
                    }}
                  />
                  <span>{icon} {label}</span>
                </label>
              ))}
            </>
          )}
        </div>

        <label style={styles.fieldLabel}>模式</label>
        <div style={styles.modeToggle}>
          {Object.entries(MODE_LABELS).map(([key, { label, desc }]) => (
            <button
              key={key}
              style={editData.mode === key ? styles.modeActive : styles.modeBtn}
              onClick={() => setEditData({ ...editData, mode: key })}
            >
              <strong>{label}</strong>
              <span style={styles.modeDesc}>{desc}</span>
            </button>
          ))}
        </div>

        <div style={styles.editActions}>
          <span style={styles.targetInfo}>
            推給 {editData.adminOnly
              ? adminTargetCount
              : editData.allUsers
              ? Object.values(stats?.segments || {}).reduce((a, b) => a + b, 0)
              : (editData.segments || []).reduce((sum, seg) => sum + (stats?.segments[seg] || 0), 0)
            } 人
          </span>
          <button onClick={onCancel} style={styles.btnGhost}>取消</button>
          <button
            onClick={() => {
              const cleanButtons = (editData.buttons || []).filter((b) => b.label && b.url);
              // 只保存資料庫欄位，過濾掉前端狀態
              const { adminOnly, allUsers, excludeEnrolled, ...dbData } = editData;
              onSave({ ...dbData, buttons: cleanButtons, image_url: editData.image_url || null });
            }}
            style={styles.btnPrimary}
          >
            儲存
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <span style={styles.cardIcon}>{template.icon}</span>
        <div>
          <div style={styles.cardName}>{template.name}</div>
          <div style={styles.cardMeta}>
            <span style={{ ...styles.modeBadge, background: modeInfo.color + '18', color: modeInfo.color }}>
              {modeInfo.label}
            </span>
            <span style={styles.cardTarget}>→ {targetCount} 人</span>
          </div>
        </div>
      </div>

      <div style={styles.cardPreview}>
        {template.message.split('\n').slice(0, 3).join('\n')}
        {template.message.split('\n').length > 3 && '...'}
      </div>

      {template.buttons?.length > 0 ? (
        <div style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {template.buttons.map((btn, i) => (
            <div key={i} style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 13, textAlign: 'center',
              background: i === 0 ? '#2a9d6f' : '#f1f5f9',
              color: i === 0 ? '#fff' : '#334155',
            }}>
              {btn.label}
            </div>
          ))}
        </div>
      ) : template.link_url ? (
        <div style={styles.cardLink}>
          🔗 {template.link_text || '連結'}
        </div>
      ) : null}

      {template.mode === 'scheduled' && (
        <div style={{ marginBottom: 8 }}>
          <div style={styles.fieldLabel}>排程時間</div>
          <DateTimePicker24
            value={scheduledAt}
            onChange={setScheduledAt}
            style={{ marginBottom: 4 }}
          />
          {scheduledAt && (
            <div style={{ fontSize: 12, color: '#8b5cf6', marginTop: 4 }}>
              將於 {scheduledAt.replace('T', ' ').replace(/:\d{2}\+.*$/, '')} 送出
            </div>
          )}
        </div>
      )}

      <label style={{ ...styles.checkbox, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={excludeEnrolled}
          onChange={(e) => setExcludeEnrolled(e.target.checked)}
        />
        <span style={{ fontSize: 13, color: '#64748b' }}>排除已報名減重班</span>
      </label>

      <div style={styles.cardActions}>
        <button onClick={onEdit} style={styles.btnSmallGhost}>✏️ 編輯</button>
        <button
          onClick={() => onSend({
            scheduled_at: scheduledAt || undefined,
            excludeEnrolled,
            adminOnly: editData.adminOnly || false,
            allUsers: editData.allUsers || false,
            segments: editData.segments || template.segments,
            image_url: template.image_url || undefined,
          })}
          style={styles.btnSmallPrimary}
          disabled={template.mode === 'scheduled' && !scheduledAt}
        >
          送出 →
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 自訂推播表單
// ============================================================
function CustomPushForm({ stats, onSend, onCancel }) {
  const [data, setData] = useState({
    message: '',
    buttons: [{ label: '', url: '' }, { label: '', url: '' }],
    segments: ['active', 'warm'],
    mode: 'queued',
    label: '自訂推播',
    allUsers: false,
    adminOnly: false,
    excludeEnrolled: false,
    image_url: '',
  });
  const [scheduledAt, setScheduledAt] = useState('');
  const [adminTargetCount, setAdminTargetCount] = useState(0);

  const totalUsers = Object.values(stats?.segments || {}).reduce((a, b) => a + b, 0);
  const targetCount = data.adminOnly
    ? adminTargetCount
    : data.allUsers
    ? totalUsers
    : data.segments.reduce((sum, seg) => sum + (stats?.segments[seg] || 0), 0);

  // 當 adminOnly 改變時更新管理者人數
  useEffect(() => {
    if (data.adminOnly) {
      apiPost({
        action: 'count_targets',
        adminOnly: true,
      }).then((res) => setAdminTargetCount(res.count || 0)).catch(() => setAdminTargetCount(0));
    }
  }, [data.adminOnly]);

  const updateButton = (i, field, value) => {
    const btns = [...data.buttons];
    btns[i] = { ...btns[i], [field]: value };
    setData({ ...data, buttons: btns });
  };

  return (
    <div style={styles.customForm}>
      <div style={styles.customHeader}>
        <h3 style={{ margin: 0, fontSize: 16 }}>自訂推播</h3>
        <button onClick={onCancel} style={styles.btnGhost}>✕</button>
      </div>

      <label style={styles.fieldLabel}>訊息內容</label>
      <textarea
        value={data.message}
        onChange={(e) => setData({ ...data, message: e.target.value })}
        style={styles.textarea}
        rows={5}
        placeholder="輸入推播訊息..."
      />

      {[0, 1].map((i) => (
        <div key={i}>
          <label style={styles.fieldLabel}>
            按鈕 {i + 1}{i === 1 && <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>（選填）</span>}
          </label>
          <input
            value={data.buttons[i]?.label || ''}
            onChange={(e) => updateButton(i, 'label', e.target.value)}
            style={{ ...styles.input, marginBottom: 4 }}
            placeholder={i === 0 ? '例如：🎥 觀看說明會回放' : '例如：👇 立即報名'}
          />
          <input
            value={data.buttons[i]?.url || ''}
            onChange={(e) => updateButton(i, 'url', e.target.value)}
            style={styles.input}
            placeholder="https://..."
          />
        </div>
      ))}

      <ImageUpload imageUrl={data.image_url || ''} onChange={(url) => setData({ ...data, image_url: url })} />

      <FlexPreview message={data.message} buttons={data.buttons} imageUrl={data.image_url} />

      <label style={styles.fieldLabel}>推給誰</label>
      <div style={styles.segmentCheckboxes}>
        <label style={{ ...styles.checkbox, fontWeight: 600, color: '#8b5cf6' }}>
          <input
            type="checkbox"
            checked={data.adminOnly || false}
            onChange={(e) => setData({ ...data, adminOnly: e.target.checked, allUsers: false })}
          />
          <span>👨‍💼 僅管理者（測試用）</span>
        </label>
        {!data.adminOnly && (
          <>
            <label style={{ ...styles.checkbox, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={data.allUsers}
                onChange={(e) => setData({ ...data, allUsers: e.target.checked })}
              />
              <span>👥 所有人</span>
            </label>
            {!data.allUsers && Object.entries(SEGMENT_LABELS).map(([key, { label, icon }]) => (
              <label key={key} style={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={data.segments.includes(key)}
                  onChange={(e) => {
                    setData({
                      ...data,
                      segments: e.target.checked
                        ? [...data.segments, key]
                        : data.segments.filter((s) => s !== key),
                    });
                  }}
                />
                <span>{icon} {label}</span>
              </label>
            ))}
          </>
        )}
      </div>

      <label style={{ ...styles.checkbox, marginTop: 4 }}>
        <input
          type="checkbox"
          checked={data.excludeEnrolled}
          onChange={(e) => setData({ ...data, excludeEnrolled: e.target.checked })}
        />
        <span style={{ fontSize: 13, color: '#64748b' }}>排除已報名減重班</span>
      </label>

      <label style={styles.fieldLabel}>模式</label>
      <div style={styles.modeToggle}>
        {Object.entries(MODE_LABELS).map(([key, { label, desc }]) => (
          <button
            key={key}
            style={data.mode === key ? styles.modeActive : styles.modeBtn}
            onClick={() => setData({ ...data, mode: key })}
          >
            <strong>{label}</strong>
            <span style={styles.modeDesc}>{desc}</span>
          </button>
        ))}
      </div>

      {data.mode === 'scheduled' && (
        <>
          <label style={styles.fieldLabel}>排程時間</label>
          <DateTimePicker24
            value={scheduledAt}
            onChange={setScheduledAt}
          />
          {scheduledAt && (
            <div style={{ fontSize: 12, color: '#8b5cf6', marginTop: 4 }}>
              將於 {scheduledAt.replace('T', ' ').replace(/:\d{2}\+.*$/, '')} 送出
            </div>
          )}
        </>
      )}

      <div style={styles.editActions}>
        <span style={styles.targetInfo}>推給 {targetCount} 人</span>
        <button
          onClick={() => {
            const cleanButtons = data.buttons.filter((b) => b.label && b.url);
            onSend({ ...data, buttons: cleanButtons, scheduled_at: scheduledAt || undefined, image_url: data.image_url || undefined });
          }}
          style={styles.btnPrimary}
          disabled={!data.message.trim() || (!data.adminOnly && !data.allUsers && data.segments.length === 0) || (data.mode === 'scheduled' && !scheduledAt)}
        >
          {data.mode === 'scheduled' ? '排程送出' : '送出'}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 確認彈窗
// ============================================================
function ConfirmModal({ template, targetCount, onConfirm, onCancel }) {
  const modeInfo = MODE_LABELS[template.mode || 'instant'];

  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={styles.modalTitle}>確認推播</h2>

        <div style={styles.confirmInfo}>
          <div style={styles.confirmRow}>
            <span style={styles.confirmLabel}>推給</span>
            <span style={styles.confirmValue}>{targetCount} 人</span>
          </div>
          <div style={styles.confirmRow}>
            <span style={styles.confirmLabel}>模式</span>
            <span style={{ ...styles.modeBadge, background: modeInfo.color + '18', color: modeInfo.color }}>
              {modeInfo.label} — {modeInfo.desc}
            </span>
          </div>
        </div>

        <div style={styles.previewBox}>
          <div style={styles.previewLabel}>訊息預覽</div>
          {template.buttons?.length > 0 ? (
            <div style={{ padding: '10px 12px' }}>
              <div style={{ fontWeight: 600, marginBottom: 6, whiteSpace: 'pre-wrap' }}>
                {template.message.split('\n')[0]}
              </div>
              {template.message.split('\n').slice(1).join('\n').trim() && (
                <div style={{ fontSize: 13, color: '#666', marginBottom: 10, whiteSpace: 'pre-wrap' }}>
                  {template.message.split('\n').slice(1).join('\n').trim()}
                </div>
              )}
              {template.buttons.map((btn, i) => (
                <div key={i} style={{
                  padding: '8px 12px', borderRadius: 6, fontSize: 13, textAlign: 'center',
                  marginBottom: 4,
                  background: i === 0 ? '#2a9d6f' : '#f1f5f9',
                  color: i === 0 ? '#fff' : '#334155',
                }}>
                  {btn.label}
                </div>
              ))}
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Flex Message — URL 不顯示給用戶</div>
            </div>
          ) : (
            <div style={styles.previewContent}>
              {template.message}
              {template.link_url && (
                <>
                  {'\n\n'}👉 {template.link_text || '點這裡'}
                  {'\n'}(追蹤連結)
                </>
              )}
            </div>
          )}
        </div>

        <div style={styles.modalActions}>
          <button onClick={onCancel} style={styles.btnGhost}>取消</button>
          <button onClick={onConfirm} style={styles.btnDanger}>
            確認送出給 {targetCount} 人
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 佇列進度彈窗
// ============================================================
function QueueProgressModal({ progress }) {
  const percent = progress.total > 0
    ? Math.round((progress.sent / progress.total) * 100)
    : 0;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <h2 style={styles.modalTitle}>推播中...</h2>
        <p style={{ color: '#666', margin: '0 0 16px' }}>{progress.label}</p>

        <div style={styles.progressBar}>
          <div style={{ ...styles.progressFill, width: `${percent}%` }} />
        </div>

        <div style={styles.progressText}>
          {progress.sent} / {progress.total} 已送出（{percent}%）
        </div>

        <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 12 }}>
          請勿關閉此頁面
        </p>
      </div>
    </div>
  );
}

// ============================================================
// 送出結果彈窗
// ============================================================
function ResultModal({ result, onClose }) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.resultIcon}>✅</div>
        <h2 style={styles.modalTitle}>推播完成</h2>
        <p style={{ color: '#666', margin: '0 0 8px' }}>{result.label}</p>
        <p style={styles.resultNumber}>
          已送達 <strong>{result.sent}</strong> 人
        </p>
        <button onClick={onClose} style={{ ...styles.btnPrimary, marginTop: 16 }}>
          確認
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 排程管理
// ============================================================
function DripTab({ dripStats, onUpdate, onToggleActive, onToggleTestMode, onAddStep, onDeleteStep }) {
  const [editingStep, setEditingStep] = useState(null);
  const [editData, setEditData] = useState({});
  const [toggleError, setToggleError] = useState(null); // { step, msg }
  const [toggling, setToggling] = useState(null); // step number
  const [previewStep, setPreviewStep] = useState(null); // step number to preview before activation
  const [togglingTestMode, setTogglingTestMode] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deletingStep, setDeletingStep] = useState(null); // step number pending delete confirmation
  const [deleteError, setDeleteError] = useState(null);

  const handleToggle = async (stepNumber, currentActive) => {
    setToggleError(null);

    if (!currentActive) {
      // 要啟用 → 先顯示預覽確認
      setPreviewStep(stepNumber);
      return;
    }

    // 停用 → 直接執行
    setToggling(stepNumber);
    const res = await onToggleActive(stepNumber, false);
    setToggling(null);
    if (res?.error) {
      setToggleError({ step: stepNumber, msg: res.error });
    }
  };

  const confirmActivate = async (stepNumber) => {
    setToggleError(null);
    setToggling(stepNumber);
    const res = await onToggleActive(stepNumber, true);
    setToggling(null);
    setPreviewStep(null);
    if (res?.error) {
      setToggleError({ step: stepNumber, msg: res.error });
    }
  };

  return (
    <div>
      {/* 排程統計 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: '排程中', value: dripStats.activeUsers, color: '#3b82f6' },
          { label: '已完成', value: dripStats.completedUsers, color: '#10b981' },
          { label: '已報名', value: dripStats.enrolledUsers, color: '#f59e0b' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            background: '#fff', borderRadius: 10, padding: '12px 16px',
            border: '1px solid #e5e7eb', flex: '1', minWidth: 90, textAlign: 'center',
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 12, color: '#888' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* 測試模式 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        padding: '10px 14px', borderRadius: 8,
        background: dripStats.dripTestMode ? '#fef3c7' : '#f8fafc',
        border: `1px solid ${dripStats.dripTestMode ? '#f59e0b' : '#e5e7eb'}`,
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1 }}>
          <input
            type="checkbox"
            checked={dripStats.dripTestMode || false}
            disabled={togglingTestMode}
            onChange={async (e) => {
              setTogglingTestMode(true);
              await onToggleTestMode(e.target.checked);
              setTogglingTestMode(false);
            }}
            style={{ width: 18, height: 18, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 14, fontWeight: 600, color: dripStats.dripTestMode ? '#92400e' : '#374151' }}>
            🧪 測試模式（僅推管理者）
          </span>
        </label>
        {dripStats.dripTestMode && (
          <span style={{ fontSize: 12, color: '#b45309' }}>
            啟用中 — Cron 只會推給管理者
          </span>
        )}
      </div>

      {/* 文章列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {dripStats.schedule?.map((step) => {
          const isEditing = editingStep === step.step_number;
          const isPreviewing = previewStep === step.step_number;
          const clickRate = step.sent_count > 0 ? `${step.click_rate}%` : '-';
          const isPlaceholder = step.message === '（待填入訊息內容）' || step.link_url?.includes('example.com');

          // 啟用前預覽確認
          if (isPreviewing) {
            return (
              <div key={step.step_number} style={{ ...styles.cardEditing, borderColor: '#2a9d6f' }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  確認啟用第 {step.step_number} 篇：{step.title}
                </div>
                <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
                  啟用後，到期的用戶會自動收到這篇文章。請確認內容正確：
                </div>
                <FlexPreview
                  message={step.message}
                  buttons={step.link_url ? [{ label: step.link_text || '閱讀文章', url: step.link_url }] : []}
                  imageUrl={step.image_url}
                />
                {toggleError?.step === step.step_number && (
                  <div style={{
                    marginTop: 8, padding: '8px 12px', background: '#fef2f2',
                    borderRadius: 6, fontSize: 13, color: '#991b1b',
                  }}>
                    {toggleError.msg}
                  </div>
                )}
                <div style={{ ...styles.editActions, marginTop: 12 }}>
                  <button onClick={() => setPreviewStep(null)} style={styles.btnGhost}>取消</button>
                  <button
                    onClick={() => confirmActivate(step.step_number)}
                    disabled={toggling === step.step_number}
                    style={{ ...styles.btnPrimary, background: '#2a9d6f', opacity: toggling === step.step_number ? 0.6 : 1 }}
                  >
                    {toggling === step.step_number ? '啟用中...' : '確認啟用'}
                  </button>
                </div>
              </div>
            );
          }

          // 編輯模式
          if (isEditing) {
            return (
              <div key={step.step_number} style={styles.cardEditing}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  第 {step.step_number} 篇：{step.title}
                </div>
                <label style={styles.fieldLabel}>文章標題</label>
                <input
                  value={editData.title || ''}
                  onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                  style={styles.input}
                />
                <label style={styles.fieldLabel}>推播訊息</label>
                <textarea
                  value={editData.message || ''}
                  onChange={(e) => setEditData({ ...editData, message: e.target.value })}
                  style={styles.textarea}
                  rows={4}
                />
                <label style={styles.fieldLabel}>文章連結</label>
                <input
                  value={editData.link_url || ''}
                  onChange={(e) => setEditData({ ...editData, link_url: e.target.value })}
                  style={styles.input}
                />
                <label style={styles.fieldLabel}>連結文字</label>
                <input
                  value={editData.link_text || ''}
                  onChange={(e) => setEditData({ ...editData, link_text: e.target.value })}
                  style={styles.input}
                />
                <ImageUpload imageUrl={editData.image_url || ''} onChange={(url) => setEditData({ ...editData, image_url: url })} />
                <label style={styles.fieldLabel}>
                  發送間隔（天）
                  <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>
                    {step.step_number === 1 ? '加入後幾天發送' : '距上一篇幾天後發送'}
                  </span>
                </label>
                <input
                  type="number"
                  min={1}
                  value={editData.delay_days ?? step.delay_days}
                  onChange={(e) => setEditData({ ...editData, delay_days: parseInt(e.target.value, 10) })}
                  style={{ ...styles.input, width: 80 }}
                />
                <FlexPreview
                  message={editData.message}
                  buttons={editData.link_url ? [{ label: editData.link_text || '閱讀文章', url: editData.link_url }] : []}
                  imageUrl={editData.image_url}
                />
                <div style={styles.editActions}>
                  <button onClick={() => setEditingStep(null)} style={styles.btnGhost}>取消</button>
                  <button onClick={() => {
                    onUpdate(step.step_number, editData);
                    setEditingStep(null);
                  }} style={styles.btnPrimary}>儲存</button>
                </div>
              </div>
            );
          }

          // 顯示模式
          return (
            <div key={step.step_number} style={{
              ...styles.card,
              borderLeft: `3px solid ${step.is_active ? '#2a9d6f' : '#d1d5db'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, color: '#888' }}>
                      {step.step_number === 1 ? `加入後 ${step.delay_days} 天` : `上一篇後 ${step.delay_days} 天`}
                    </span>
                    <span style={{
                      fontSize: 11, padding: '1px 6px', borderRadius: 4, fontWeight: 500,
                      background: step.is_active ? '#dcfce7' : '#f1f5f9',
                      color: step.is_active ? '#166534' : '#64748b',
                    }}>
                      {step.is_active ? '啟用中' : '停用'}
                    </span>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>
                    {step.title}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {/* 啟用/停用 toggle */}
                  <button
                    onClick={() => handleToggle(step.step_number, step.is_active)}
                    disabled={toggling === step.step_number}
                    title={step.is_active ? '點擊停用' : '點擊啟用'}
                    style={{
                      padding: '4px 10px', borderRadius: 6, border: '1px solid #e5e7eb',
                      fontSize: 12, cursor: 'pointer',
                      background: step.is_active ? '#fff' : '#2a9d6f',
                      color: step.is_active ? '#666' : '#fff',
                      opacity: toggling === step.step_number ? 0.5 : 1,
                    }}
                  >
                    {toggling === step.step_number ? '...' : step.is_active ? '停用' : '啟用'}
                  </button>
                  <button
                    onClick={() => {
                      setEditingStep(step.step_number);
                      setEditData({
                        title: step.title,
                        message: step.message,
                        link_url: step.link_url || '',
                        link_text: step.link_text || '',
                        image_url: step.image_url || '',
                      });
                    }}
                    style={styles.btnSmallGhost}
                  >
                    ✏️ 編輯
                  </button>
                  {!step.is_active && step.sent_count === 0 && (
                    <button
                      onClick={() => { setDeletingStep(step.step_number); setDeleteError(null); }}
                      style={{ ...styles.btnSmallGhost, color: '#dc2626' }}
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>

              {/* 刪除確認 */}
              {deletingStep === step.step_number && (
                <div style={{
                  marginTop: 8, padding: '8px 12px', background: '#fef2f2',
                  borderRadius: 6, border: '1px solid #fecaca',
                }}>
                  <div style={{ fontSize: 13, color: '#991b1b', marginBottom: 6 }}>
                    確定要刪除「{step.title}」嗎？
                  </div>
                  {deleteError && (
                    <div style={{ fontSize: 12, color: '#991b1b', marginBottom: 6 }}>{deleteError}</div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setDeletingStep(null)} style={styles.btnGhost}>取消</button>
                    <button
                      onClick={async () => {
                        const res = await onDeleteStep(step.step_number);
                        if (res?.error) { setDeleteError(res.error); return; }
                        setDeletingStep(null);
                      }}
                      style={{ ...styles.btnPrimary, background: '#dc2626' }}
                    >確定刪除</button>
                  </div>
                </div>
              )}

              {/* 數據面板 */}
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: '#666' }}>發送 {step.sent_count} 人</span>
                <span style={{ color: '#2a9d6f', fontWeight: 500 }}>點擊 {step.click_count} 人（{clickRate}）</span>
                {step.image_url && <span style={{ color: '#3b82f6' }}>有圖片</span>}
              </div>

              {/* 驗證錯誤 */}
              {toggleError?.step === step.step_number && (
                <div style={{
                  marginTop: 8, padding: '6px 10px', background: '#fef2f2',
                  borderRadius: 4, fontSize: 12, color: '#991b1b',
                }}>
                  {toggleError.msg}
                </div>
              )}

              {/* placeholder 警告 */}
              {isPlaceholder && (
                <div style={{
                  marginTop: 8, padding: '4px 8px', background: '#fef3c7',
                  borderRadius: 4, fontSize: 12, color: '#92400e', display: 'inline-block',
                }}>
                  尚未設定內容
                </div>
              )}
            </div>
          );
        })}

        {/* 新增文章按鈕 */}
        <button
          disabled={adding}
          onClick={async () => {
            setAdding(true);
            await onAddStep();
            setAdding(false);
          }}
          style={{
            marginTop: 8, padding: '10px 16px', borderRadius: 8,
            border: '2px dashed #d1d5db', background: '#fafafa',
            color: '#6b7280', fontSize: 14, cursor: 'pointer',
            width: '100%', textAlign: 'center',
            opacity: adding ? 0.5 : 1,
          }}
        >
          {adding ? '新增中...' : '＋ 新增文章'}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 推播紀錄
// ============================================================
function PushHistory({ logs, onReload }) {
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editMsg, setEditMsg] = useState('');
  const [editScheduledAt, setEditScheduledAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  if (!logs.length) {
    return <p style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>尚無推播紀錄</p>;
  }

  const statusMap = {
    completed: { label: '已完成', bg: '#dcfce7', color: '#166534' },
    sending: { label: '發送中', bg: '#dbeafe', color: '#1e40af' },
    scheduled: { label: '待發送', bg: '#fef3c7', color: '#92400e' },
    failed: { label: '失敗', bg: '#fee2e2', color: '#991b1b' },
  };

  const handleEdit = (log) => {
    setEditingId(log.id);
    setEditMsg(log.message);
    const sa = log.scheduled_at ? new Date(log.scheduled_at) : null;
    if (sa) {
      const y = sa.getFullYear();
      const mo = String(sa.getMonth() + 1).padStart(2, '0');
      const d = String(sa.getDate()).padStart(2, '0');
      const h = String(sa.getHours()).padStart(2, '0');
      const mi = String(sa.getMinutes()).padStart(2, '0');
      setEditScheduledAt(`${y}-${mo}-${d}T${h}:${mi}`);
    } else {
      setEditScheduledAt('');
    }
  };

  const handleSave = async (id) => {
    setSaving(true);
    try {
      const payload = { action: 'update_log', id, message: editMsg };
      if (editScheduledAt) payload.scheduled_at = editScheduledAt;
      await apiPost(payload);
      setEditingId(null);
      if (onReload) await onReload();
    } catch (e) {
      alert('儲存失敗：' + e.message);
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    setSaving(true);
    try {
      await apiPost({ action: 'delete_log', id });
      setConfirmDeleteId(null);
      if (onReload) await onReload();
    } catch (e) {
      alert('刪除失敗：' + e.message);
    }
    setSaving(false);
  };

  return (
    <div style={styles.logList}>
      {logs.map((log) => {
        const date = new Date(log.created_at);
        const dateStr = date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
        const clickRate = log.click_count && log.sent_count
          ? `${Math.round((log.click_count / log.sent_count) * 100)}%`
          : null;
        const scheduledDate = log.scheduled_at ? new Date(log.scheduled_at) : null;
        const scheduledStr = scheduledDate
          ? scheduledDate.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
          : null;
        const st = statusMap[log.status] || { label: log.status, bg: '#f1f5f9', color: '#475569' };
        const isExpanded = expandedId === log.id;
        const isEditing = editingId === log.id;
        const isScheduled = log.status === 'scheduled';

        return (
          <div key={log.id} style={{ ...styles.logItem, cursor: 'pointer' }} onClick={() => {
            if (!isEditing) setExpandedId(isExpanded ? null : log.id);
          }}>
            <div style={styles.logTop}>
              <span style={styles.logDate}>{dateStr}</span>
              <span style={styles.logLabel}>{log.label}</span>
              <span style={{
                ...styles.statusBadge,
                background: st.bg,
                color: st.color,
              }}>
                {st.label}
              </span>
              {scheduledStr && (
                <span style={{ fontSize: 12, color: '#92400e', marginLeft: 4 }}>
                  ⏰ 預計 {scheduledStr} 發送
                </span>
              )}
              <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>
                {isExpanded ? '▲ 收合' : '▼ 展開'}
              </span>
            </div>
            <div style={styles.logStats}>
              {isScheduled ? (
                <span style={{ color: '#92400e' }}>{log.target_count} 人預計送達</span>
              ) : (
                <span>{log.sent_count} 人送達</span>
              )}
              {log.click_count > 0 && (
                <span style={styles.logClick}>
                  {log.click_count} 點擊（{clickRate}）
                </span>
              )}
            </div>
            {log.segments && log.segments.length > 0 && (
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ color: '#94a3b8' }}>推給：</span>
                {log.segments.map((seg) => {
                  const s = SEGMENT_LABELS[seg];
                  return s ? (
                    <span key={seg}>{s.icon} {s.label}</span>
                  ) : (
                    <span key={seg}>{seg}</span>
                  );
                })}
              </div>
            )}

            {/* 收合時只顯示預覽 */}
            {!isExpanded && (
              <div style={styles.logPreview}>
                {log.message.slice(0, 60)}{log.message.length > 60 ? '...' : ''}
              </div>
            )}

            {/* 展開後顯示完整訊息 */}
            {isExpanded && !isEditing && (
              <div onClick={(e) => e.stopPropagation()}>
                <div style={{ fontSize: 13, color: '#334155', marginTop: 8, whiteSpace: 'pre-wrap', lineHeight: 1.6, background: '#f8fafc', borderRadius: 8, padding: 12 }}>
                  {log.message}
                </div>
                {log.image_url && (
                  <div style={{ marginTop: 8 }}>
                    <img src={log.image_url} alt="" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8 }} />
                  </div>
                )}
                {isScheduled && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button onClick={() => handleEdit(log)} style={{ ...styles.btnSmallGhost, fontSize: 12 }}>
                      ✏️ 編輯
                    </button>
                    <button onClick={() => setConfirmDeleteId(log.id)} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', cursor: 'pointer' }}>
                      🗑️ 刪除
                    </button>
                  </div>
                )}
                {confirmDeleteId === log.id && (
                  <div style={{ marginTop: 8, padding: 12, background: '#fef2f2', borderRadius: 8, border: '1px solid #fca5a5' }}>
                    <p style={{ fontSize: 13, color: '#991b1b', margin: '0 0 8px' }}>確定要刪除這筆排程推播嗎？此操作無法復原。</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => handleDelete(log.id)} disabled={saving} style={{ ...styles.btnSmallPrimary, fontSize: 12, background: '#dc2626' }}>
                        {saving ? '刪除中...' : '確定刪除'}
                      </button>
                      <button onClick={() => setConfirmDeleteId(null)} style={{ ...styles.btnSmallGhost, fontSize: 12 }}>
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 編輯模式 */}
            {isExpanded && isEditing && (
              <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 8 }}>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 12, color: '#64748b', marginBottom: 4, display: 'block' }}>訊息內容</label>
                  <textarea
                    value={editMsg}
                    onChange={(e) => setEditMsg(e.target.value)}
                    rows={5}
                    style={{ ...styles.input, resize: 'vertical' }}
                  />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 12, color: '#64748b', marginBottom: 4, display: 'block' }}>預計發送時間</label>
                  <DateTimePicker24
                    value={editScheduledAt}
                    onChange={setEditScheduledAt}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleSave(log.id)} disabled={saving} style={{ ...styles.btnSmallPrimary, fontSize: 12 }}>
                    {saving ? '儲存中...' : '儲存'}
                  </button>
                  <button onClick={() => setEditingId(null)} style={{ ...styles.btnSmallGhost, fontSize: 12 }}>
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// 用戶管理 Tab
// ============================================================
function UsersTab({ usersData, search, filters, sources, page, onSearch, onFilter, onClear, onPageChange, onTagUser, onAddSource, onDeleteSource }) {
  const [searchInput, setSearchInput] = useState(search);
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [newSource, setNewSource] = useState({ id: '', name: '', url: '' });
  const [confirmTag, setConfirmTag] = useState(null);

  const SOURCE_NAMES = {};
  sources.forEach((s) => { SOURCE_NAMES[s.id] = s.name; });

  return (
    <div>
      {/* 搜尋和篩選 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180, display: 'flex', gap: 4 }}>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch(searchInput)}
            placeholder="搜尋 LINE 名稱..."
            style={{ ...styles.input, fontSize: 13 }}
          />
          <button onClick={() => onSearch(searchInput)} style={styles.btnSmallPrimary}>搜尋</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          value={filters.segment}
          onChange={(e) => onFilter({ ...filters, segment: e.target.value })}
          style={{ ...styles.input, width: 'auto', fontSize: 13 }}
        >
          <option value="">全部分群</option>
          {Object.entries(SEGMENT_LABELS).map(([key, { label, icon }]) => (
            <option key={key} value={key}>{icon} {label}</option>
          ))}
        </select>

        <select
          value={filters.source}
          onChange={(e) => onFilter({ ...filters, source: e.target.value })}
          style={{ ...styles.input, width: 'auto', fontSize: 13 }}
        >
          <option value="">全部來源</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        <select
          value={filters.tag}
          onChange={(e) => onFilter({ ...filters, tag: e.target.value })}
          style={{ ...styles.input, width: 'auto', fontSize: 13 }}
        >
          <option value="">全部狀態</option>
          <option value="interested">有興趣</option>
          <option value="enrolled">已報名</option>
          <option value="not_enrolled">未報名</option>
        </select>

        {(filters.segment || filters.source || filters.tag || search) && (
          <button
            onClick={() => {
              setSearchInput('');
              onClear();
            }}
            style={{ ...styles.btnGhost, fontSize: 13, padding: '6px 12px' }}
          >
            清除篩選
          </button>
        )}
      </div>

      {/* 用戶列表 */}
      {usersData && (
        <>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
            共 {usersData.total} 位用戶
            {usersData.totalPages > 1 && `（第 ${usersData.page}/${usersData.totalPages} 頁）`}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {usersData.users.map((user) => {
              const seg = SEGMENT_LABELS[user.segment] || SEGMENT_LABELS.new;
              const joinDate = new Date(user.joined_at);
              const dateStr = joinDate.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric' });
              const isEnrolled = user.tags?.includes('已報名減重班');
              const sourceName = SOURCE_NAMES[user.source] || user.source || '未知';

              return (
                <div key={user.line_user_id} style={{
                  ...styles.card,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 14px',
                  gap: 12,
                  flexWrap: 'wrap',
                }}>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>
                      {user.display_name || '（未知）'}
                    </div>
                    <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                      {dateStr} 加入
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 4,
                      background: '#f0f4f3', color: '#555',
                    }}>
                      {sourceName}
                    </span>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 4,
                      background: seg.color + '18', color: seg.color,
                      fontWeight: 600,
                    }}>
                      {seg.icon} {seg.label}
                    </span>
                    {user.metabolism_type && (
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 4,
                        background: '#ede9fe', color: '#7c3aed',
                      }}>
                        {user.metabolism_type}
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: '#aaa' }}>
                      互動 {user.interaction_count}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {user.tags?.includes('管理者') && (
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 4,
                        background: '#ede9fe', color: '#8b5cf6', fontWeight: 600,
                      }}>
                        👨‍💼 管理者
                      </span>
                    )}
                    {user.tags?.includes('有興趣') && !isEnrolled && (
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 4,
                        background: '#fef3c7', color: '#92400e', fontWeight: 500,
                      }}>
                        有興趣
                      </span>
                    )}
                    {isEnrolled ? (
                      <span style={{
                        fontSize: 12, padding: '4px 12px', borderRadius: 6,
                        background: '#dcfce7', color: '#166534', fontWeight: 500,
                      }}>
                        已報名
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmTag(user)}
                        style={{
                          fontSize: 12, padding: '4px 12px', borderRadius: 6,
                          background: '#fff', color: '#2a9d6f', fontWeight: 500,
                          border: '1px solid #2a9d6f', cursor: 'pointer',
                        }}
                      >
                        標記已報名
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {usersData.users.length === 0 && (
              <p style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>沒有符合條件的用戶</p>
            )}
          </div>

          {/* 分頁 */}
          {usersData.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => onPageChange(page - 1)}
                disabled={page <= 1}
                style={{ ...styles.btnSmallGhost, opacity: page <= 1 ? 0.4 : 1 }}
              >
                上一頁
              </button>
              <span style={{ fontSize: 13, color: '#888', lineHeight: '32px' }}>
                {page} / {usersData.totalPages}
              </span>
              <button
                onClick={() => onPageChange(page + 1)}
                disabled={page >= usersData.totalPages}
                style={{ ...styles.btnSmallGhost, opacity: page >= usersData.totalPages ? 0.4 : 1 }}
              >
                下一頁
              </button>
            </div>
          )}
        </>
      )}

      {/* 來源管理 */}
      <div style={{ marginTop: 32 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: '#1a1a1a' }}>加入來源管理</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sources.map((s) => (
            <div key={s.id} style={{
              ...styles.card,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 14px',
            }}>
              <div>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{s.name}</span>
                <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>({s.id})</span>
                {s.url && (
                  <div style={{ fontSize: 12, color: '#2a9d6f', marginTop: 2 }}>{s.url}</div>
                )}
              </div>
              {!['quiz', 'direct', 'legacy'].includes(s.id) && (
                <button
                  onClick={() => onDeleteSource(s.id)}
                  style={{ ...styles.btnGhost, fontSize: 12, color: '#ef4444', padding: '4px 8px' }}
                >
                  刪除
                </button>
              )}
            </div>
          ))}
        </div>

        {!showSourceForm ? (
          <button
            onClick={() => setShowSourceForm(true)}
            style={{ ...styles.btnOutline, marginTop: 8, fontSize: 13 }}
          >
            + 新增來源
          </button>
        ) : (
          <div style={{ ...styles.card, marginTop: 8 }}>
            <label style={styles.fieldLabel}>來源 ID（英文，用於系統識別）</label>
            <input
              value={newSource.id}
              onChange={(e) => setNewSource({ ...newSource, id: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })}
              style={styles.input}
              placeholder="例如：fb_post"
            />
            <label style={styles.fieldLabel}>來源名稱</label>
            <input
              value={newSource.name}
              onChange={(e) => setNewSource({ ...newSource, name: e.target.value })}
              style={styles.input}
              placeholder="例如：FB 健康貼文"
            />
            <label style={styles.fieldLabel}>加入網址（選填）</label>
            <input
              value={newSource.url}
              onChange={(e) => setNewSource({ ...newSource, url: e.target.value })}
              style={styles.input}
              placeholder="https://lin.ee/..."
            />
            <div style={styles.editActions}>
              <button onClick={() => { setShowSourceForm(false); setNewSource({ id: '', name: '', url: '' }); }} style={styles.btnGhost}>取消</button>
              <button
                onClick={() => {
                  if (newSource.id && newSource.name) {
                    onAddSource(newSource);
                    setNewSource({ id: '', name: '', url: '' });
                    setShowSourceForm(false);
                  }
                }}
                style={styles.btnPrimary}
                disabled={!newSource.id || !newSource.name}
              >
                新增
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 標記已報名確認 */}
      {confirmTag && (
        <div style={styles.overlay} onClick={() => setConfirmTag(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>確認標記已報名</h2>
            <p style={{ textAlign: 'center', color: '#666', margin: '0 0 16px' }}>
              確定要將 <strong>{confirmTag.display_name || '（未知）'}</strong> 標記為「已報名減重班」嗎？
            </p>
            <p style={{ textAlign: 'center', fontSize: 13, color: '#888', margin: '0 0 20px' }}>
              標記後將自動停止推送排程文章
            </p>
            <div style={styles.modalActions}>
              <button onClick={() => setConfirmTag(null)} style={styles.btnGhost}>取消</button>
              <button
                onClick={() => {
                  const newTags = [...(confirmTag.tags || [])];
                  if (!newTags.includes('已報名減重班')) newTags.push('已報名減重班');
                  const filtered = newTags.filter((t) => t !== '未報名減重班');
                  onTagUser(confirmTag.line_user_id, filtered);
                  setConfirmTag(null);
                }}
                style={styles.btnPrimary}
              >
                確認標記
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 設定 Tab
// ============================================================
const SETTING_LABELS = {
  // === 關鍵字自動回覆 ===
  seminar_info: { label: '說明會資訊', desc: '用戶傳「說明會」「直播」「講座」時的回覆' },
  pricing_info: { label: '課程方案', desc: '用戶傳「方案」「價格」「費用」時的回覆' },
  abc_info: { label: 'ABC 簡介', desc: '用戶傳「ABC」「怎麼瘦」「瘦身」時的回覆' },
  welcome_message: { label: '歡迎訊息', desc: '新用戶加入時的歡迎訊息（非測驗用戶）' },
  // === Q5 軟邀請文案（契約 v2.4 Ch.8）===
  q5_soft_invite_passive_text: {
    label: 'Q5 被動軌文案（用戶 Q4 後剛回訊息時）',
    desc: '用戶走完 Q4 後主動傳訊息 + AI 判斷為 continue 時推送。訊息後會附兩個 Quick Reply：「看看做法」「有問題想問」',
  },
  q5_soft_invite_active_text: {
    label: 'Q5 主動軌文案（Q4 後 24h 無回應時）',
    desc: 'Cron 自動推送給 Q4 後 24h 未主動回訊的用戶。文案不應 reference 具體對話內容（契約 B1d）',
  },
  // === /apply 頁設定 ===
  apply_url_base: {
    label: '/apply 頁 URL base',
    desc: '生成 Q5 軟邀請連結的 base URL（例：https://official-yihugh-line-bot.vercel.app/apply）。換 domain 時改這裡',
  },
};

function SettingsTab({ settings, onSave }) {
  const [editing, setEditing] = useState({});
  const [saving, setSaving] = useState(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {Object.entries(SETTING_LABELS).map(([key, { label, desc }]) => {
        const isEditing = editing[key] !== undefined;
        const value = isEditing ? editing[key] : (settings[key] || '');

        return (
          <div key={key} style={{ ...styles.card, padding: 16 }}>
            <div style={{ marginBottom: 8 }}>
              <strong style={{ fontSize: 15 }}>{label}</strong>
              <p style={{ color: '#94a3b8', fontSize: 13, margin: '4px 0 0' }}>{desc}</p>
            </div>
            <textarea
              value={value}
              onChange={(e) => setEditing(prev => ({ ...prev, [key]: e.target.value }))}
              style={{ ...styles.input, minHeight: 120, resize: 'vertical', fontFamily: 'system-ui', lineHeight: 1.5 }}
            />
            {isEditing && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  onClick={async () => {
                    setSaving(key);
                    await onSave(key, editing[key]);
                    setEditing(prev => { const n = { ...prev }; delete n[key]; return n; });
                    setSaving(null);
                  }}
                  style={{ ...styles.btnPrimary, padding: '6px 16px', fontSize: 13 }}
                  disabled={saving === key}
                >
                  {saving === key ? '儲存中...' : '儲存'}
                </button>
                <button
                  onClick={() => setEditing(prev => { const n = { ...prev }; delete n[key]; return n; })}
                  style={{ ...styles.btnOutline, padding: '6px 16px', fontSize: 13, width: 'auto', border: '1px solid #d1d5db', color: '#666' }}
                >
                  取消
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// ApplicationsTab — Phase 4.5 報名管理（列表 + 篩選 + mark paid + 編輯）
// ============================================================
function ApplicationsTab({
  data,
  filter,
  markedBy,
  onMarkedByChange,
  onFilterChange,
  onMarkPaid,
  onCancel,
  onEditPayment,
  onReload,
}) {
  const [editingId, setEditingId] = useState(null);
  const [editMode, setEditMode] = useState(null); // 'mark_paid' | 'cancel' | 'edit'
  const [form, setForm] = useState({ last5: '', amount: '', date: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  if (!data) {
    return <p style={{ color: '#888' }}>載入中...</p>;
  }

  if (data.error) {
    return <p style={{ color: '#ef4444' }}>載入失敗：{data.error}</p>;
  }

  const rows = data.rows || [];

  const startEdit = (row, mode) => {
    setEditingId(row.id);
    setEditMode(mode);
    setErrMsg('');
    if (mode === 'mark_paid') {
      setForm({
        last5: row.payment_last5_masked ? '' : '',
        amount: row.payment_amount != null ? String(row.payment_amount) : '',
        date: row.payment_date || todayStr(),
        notes: row.notes || '',
      });
    } else if (mode === 'cancel') {
      setForm({ last5: '', amount: '', date: '', notes: row.notes || '' });
    } else {
      setForm({
        last5: '',
        amount: row.payment_amount != null ? String(row.payment_amount) : '',
        date: row.payment_date || '',
        notes: row.notes || '',
      });
    }
  };

  const closeEdit = () => {
    setEditingId(null);
    setEditMode(null);
    setForm({ last5: '', amount: '', date: '', notes: '' });
    setErrMsg('');
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setErrMsg('');
    let result;
    try {
      if (editMode === 'mark_paid') {
        if (!/^\d{1,5}$/.test(form.last5)) {
          setErrMsg('後五碼請填數字');
          setSubmitting(false);
          return;
        }
        if (!form.amount || parseFloat(form.amount) <= 0) {
          setErrMsg('金額必填且 > 0');
          setSubmitting(false);
          return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) {
          setErrMsg('日期格式 YYYY-MM-DD');
          setSubmitting(false);
          return;
        }
        result = await onMarkPaid({
          id: editingId,
          last5: form.last5,
          amount: form.amount,
          date: form.date,
        });
      } else if (editMode === 'cancel') {
        if (!confirm(`確認取消報名 #${editingId}？`)) {
          setSubmitting(false);
          return;
        }
        result = await onCancel({ id: editingId, notes: form.notes || undefined });
      } else {
        result = await onEditPayment({
          id: editingId,
          last5: form.last5 || undefined,
          amount: form.amount || undefined,
          date: form.date || undefined,
          notes: form.notes || undefined,
        });
      }
      if (result?.ok) {
        closeEdit();
      } else {
        setErrMsg(result?.error || '操作失敗');
      }
    } catch (err) {
      setErrMsg(err?.message || '操作失敗');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {/* 我是誰 */}
      <div style={{ ...appBox, marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: '#666', marginRight: 12 }}>我是：</span>
        {[
          { v: 'yixiu', label: '一休' },
          { v: 'wanxin', label: '婉馨' },
        ].map((opt) => (
          <button
            key={opt.v}
            onClick={() => onMarkedByChange(opt.v)}
            style={{
              ...appBtn,
              ...(markedBy === opt.v ? appBtnActive : {}),
              marginRight: 8,
            }}
          >
            {opt.label}
          </button>
        ))}
        <span style={{ fontSize: 12, color: '#999', marginLeft: 12 }}>
          （影響操作 audit log）
        </span>
      </div>

      {/* 篩選 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { v: 'all', label: '全部' },
          { v: 'pending', label: '待付款' },
          { v: 'paid', label: '已付款' },
          { v: 'cancelled', label: '已取消' },
        ].map((opt) => (
          <button
            key={opt.v}
            onClick={() => onFilterChange(opt.v)}
            style={{
              ...appBtn,
              ...(filter === opt.v ? appBtnActive : {}),
            }}
          >
            {opt.label}
          </button>
        ))}
        <button onClick={onReload} style={{ ...appBtn, marginLeft: 'auto' }}>🔄 重整</button>
      </div>

      {/* 計數 */}
      <p style={{ fontSize: 13, color: '#666', margin: '0 0 16px' }}>
        共 {data.total || 0} 筆（顯示 {rows.length} 筆）
      </p>

      {/* 列表 */}
      {rows.length === 0 ? (
        <p style={{ color: '#999' }}>沒有資料</p>
      ) : (
        rows.map((row) => (
          <div key={row.id} style={appCard}>
            {/* 主資訊 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                  #{row.id} {row.real_name}
                  <span style={{ ...appBadge(row.status), marginLeft: 8 }}>
                    {statusLabel(row.status)}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: '#555' }}>
                  {planLabel(row.program_choice)} · 📞 {row.phone} · ✉️ {row.email}
                </div>
                {row.address && (
                  <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>📍 {row.address}</div>
                )}
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                  {row.gender === 'male' ? '男' : row.gender === 'female' ? '女' : '其他'} · {row.age} 歲
                  {row.line_id && ` · LINE ID: ${row.line_id}`}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, color: '#888' }}>
                <div>提交：{fmtDate(row.submitted_at)}</div>
                {row.paid_at && <div>付款：{fmtDate(row.paid_at)}</div>}
                {row.paid_marked_by && <div>標記者：{row.paid_marked_by}</div>}
              </div>
            </div>

            {/* 匯款資訊 */}
            {(row.payment_last5_masked || row.payment_amount != null || row.payment_date) && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: '#fff8e1', borderRadius: 6, fontSize: 13 }}>
                💰 後五碼 <strong>{row.payment_last5_masked || '—'}</strong>
                {' · '}金額 <strong>{row.payment_amount != null ? `NT$ ${row.payment_amount}` : '—'}</strong>
                {' · '}匯款日 <strong>{row.payment_date || '—'}</strong>
              </div>
            )}

            {row.notes && (
              <div style={{ marginTop: 6, fontSize: 13, color: '#666' }}>📝 {row.notes}</div>
            )}

            {/* 操作 */}
            {editingId !== row.id && (
              <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                {row.status === 'pending' && (
                  <button onClick={() => startEdit(row, 'mark_paid')} style={{ ...appBtn, ...appBtnPrimary }}>
                    ✅ 標記已付款
                  </button>
                )}
                {row.status !== 'cancelled' && (
                  <button onClick={() => startEdit(row, 'edit')} style={appBtn}>📝 編輯</button>
                )}
                {row.status !== 'cancelled' && (
                  <button onClick={() => startEdit(row, 'cancel')} style={{ ...appBtn, ...appBtnDanger }}>
                    🗑 取消報名
                  </button>
                )}
              </div>
            )}

            {/* 編輯 form（inline 展開） */}
            {editingId === row.id && (
              <div style={{ marginTop: 12, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
                <p style={{ margin: '0 0 10px', fontWeight: 600 }}>
                  {editMode === 'mark_paid' ? '✅ 標記為已付款' :
                   editMode === 'cancel' ? '🗑 取消報名' : '📝 編輯匯款資訊'}
                </p>
                {(editMode === 'mark_paid' || editMode === 'edit') && (
                  <>
                    <label style={appLabel}>
                      匯款後五碼 {editMode === 'mark_paid' && <span style={{ color: '#ef4444' }}>*</span>}
                    </label>
                    <input
                      type="text"
                      value={form.last5}
                      onChange={(e) => setForm({ ...form, last5: e.target.value })}
                      placeholder={editMode === 'edit' && !form.last5 ? '保留原值請留空' : '例：12345'}
                      style={appInput}
                      maxLength={5}
                    />
                    <label style={appLabel}>
                      匯款金額（含手續費）{editMode === 'mark_paid' && <span style={{ color: '#ef4444' }}>*</span>}
                    </label>
                    <input
                      type="number"
                      value={form.amount}
                      onChange={(e) => setForm({ ...form, amount: e.target.value })}
                      placeholder="例：11400"
                      style={appInput}
                      step="0.01"
                    />
                    <label style={appLabel}>
                      匯款日期 {editMode === 'mark_paid' && <span style={{ color: '#ef4444' }}>*</span>}
                    </label>
                    <input
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm({ ...form, date: e.target.value })}
                      style={appInput}
                    />
                  </>
                )}
                <label style={appLabel}>備註</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="選填"
                  style={{ ...appInput, minHeight: 60, fontFamily: 'inherit' }}
                  maxLength={500}
                />
                {errMsg && <p style={{ color: '#ef4444', fontSize: 13, margin: '6px 0' }}>{errMsg}</p>}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    style={{ ...appBtn, ...appBtnPrimary, ...(submitting ? { opacity: 0.5 } : {}) }}
                  >
                    {submitting ? '處理中...' : '確認'}
                  </button>
                  <button onClick={closeEdit} style={appBtn} disabled={submitting}>取消</button>
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ApplicationsTab inline styles
const appCard = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: '14px 16px',
  marginBottom: 12,
};
const appBox = {
  background: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: '8px 12px',
  display: 'inline-block',
};
const appBtn = {
  padding: '6px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 13,
};
const appBtnActive = {
  background: '#2a9d6f',
  color: '#fff',
  borderColor: '#2a9d6f',
};
const appBtnPrimary = {
  background: '#2a9d6f',
  color: '#fff',
  borderColor: '#2a9d6f',
};
const appBtnDanger = {
  background: '#fff',
  color: '#ef4444',
  borderColor: '#ef4444',
};
const appLabel = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  margin: '8px 0 4px',
  color: '#333',
};
const appInput = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  boxSizing: 'border-box',
};
const appBadge = (status) => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  background:
    status === 'paid' ? '#d1fae5' :
    status === 'pending' ? '#fef3c7' :
    status === 'cancelled' ? '#fee2e2' : '#e5e7eb',
  color:
    status === 'paid' ? '#065f46' :
    status === 'pending' ? '#92400e' :
    status === 'cancelled' ? '#991b1b' : '#374151',
});

function statusLabel(s) {
  return s === 'pending' ? '待付款' : s === 'paid' ? '已付款' : s === 'cancelled' ? '已取消' : s;
}
function planLabel(p) {
  return p === '12weeks' ? '12 週完整版' : p === '4weeks_trial' ? '4 週體驗版' : p;
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ============================================================
// 樣式
// ============================================================
const styles = {
  // Page
  page: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    background: '#f4f6f5',
    minHeight: '100vh',
    paddingBottom: 40,
  },

  // Header
  header: {
    background: 'linear-gradient(135deg, #1a7a52, #2a9d6f)',
    padding: '20px 20px 16px',
    color: '#fff',
  },
  headerTitle: { fontSize: 20, fontWeight: 700, margin: 0 },
  headerSub: { fontSize: 13, opacity: 0.8 },

  // Stats
  statsBar: {
    background: '#fff',
    margin: '0 0 2px',
    padding: '16px 20px',
    borderBottom: '1px solid #e5e7eb',
  },
  statMain: { display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 },
  statNumber: { fontSize: 28, fontWeight: 700, color: '#1a1a1a' },
  statLabel: { fontSize: 14, color: '#888' },
  statSegments: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  statChip: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 },
  statChipNum: { fontWeight: 600, color: '#1a1a1a' },
  statChipLabel: { color: '#888' },

  // Tabs
  tabs: {
    display: 'flex',
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
    padding: '0 20px',
  },
  tab: {
    flex: 1,
    padding: '12px 0',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: 500,
    color: '#888',
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    cursor: 'pointer',
  },
  tabActive: {
    flex: 1,
    padding: '12px 0',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: 600,
    color: '#2a9d6f',
    background: 'none',
    border: 'none',
    borderBottom: '2px solid #2a9d6f',
    cursor: 'pointer',
  },

  // Section
  section: { padding: '16px 16px 0' },
  sectionTitle: { fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: '#1a1a1a' },
  sectionDesc: { fontSize: 13, color: '#888', margin: '0 0 16px' },

  // Template Grid
  templateGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: 12,
  },

  // Card
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: 16,
    border: '1px solid #e5e7eb',
  },
  cardEditing: {
    background: '#fff',
    borderRadius: 12,
    padding: 16,
    border: '2px solid #2a9d6f',
  },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  cardIcon: { fontSize: 28 },
  cardName: { fontSize: 15, fontWeight: 600, color: '#1a1a1a' },
  cardMeta: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 },
  cardTarget: { fontSize: 12, color: '#888' },
  cardPreview: {
    fontSize: 13,
    color: '#666',
    lineHeight: 1.5,
    whiteSpace: 'pre-line',
    marginBottom: 10,
    maxHeight: 60,
    overflow: 'hidden',
  },
  cardLink: { fontSize: 12, color: '#2a9d6f', marginBottom: 12 },
  cardActions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },

  // Badges
  modeBadge: {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 4,
  },
  statusBadge: {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 500,
    padding: '2px 8px',
    borderRadius: 4,
  },

  // Form elements
  fieldLabel: { display: 'block', fontSize: 13, fontWeight: 500, color: '#444', margin: '12px 0 4px' },
  input: {
    width: '100%',
    padding: '10px 12px',
    fontSize: 14,
    border: '1px solid #d1d5db',
    borderRadius: 8,
    outline: 'none',
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    fontSize: 14,
    border: '1px solid #d1d5db',
    borderRadius: 8,
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  segmentCheckboxes: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  checkbox: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' },
  modeToggle: { display: 'flex', gap: 8 },
  modeBtn: {
    flex: 1,
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    background: '#fff',
    cursor: 'pointer',
    textAlign: 'center',
    fontSize: 13,
  },
  modeActive: {
    flex: 1,
    padding: '8px 12px',
    border: '2px solid #2a9d6f',
    borderRadius: 8,
    background: '#f0fdf4',
    cursor: 'pointer',
    textAlign: 'center',
    fontSize: 13,
  },
  modeDesc: { display: 'block', fontSize: 11, color: '#888', marginTop: 2 },
  editActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, alignItems: 'center' },
  targetInfo: { fontSize: 13, color: '#888', marginRight: 'auto' },

  // Custom form
  customForm: {
    background: '#fff',
    borderRadius: 12,
    padding: 16,
    border: '1px solid #e5e7eb',
  },
  customHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },

  // Buttons
  btnPrimary: {
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    background: '#2a9d6f',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  btnDanger: {
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    background: '#ef4444',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  btnGhost: {
    padding: '10px 20px',
    fontSize: 14,
    color: '#666',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
  },
  btnOutline: {
    width: '100%',
    padding: '12px',
    fontSize: 14,
    color: '#2a9d6f',
    background: '#fff',
    border: '1px dashed #2a9d6f',
    borderRadius: 12,
    cursor: 'pointer',
  },
  btnSmallGhost: {
    padding: '6px 12px',
    fontSize: 13,
    color: '#888',
    background: 'none',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    cursor: 'pointer',
  },
  btnSmallPrimary: {
    padding: '6px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: '#fff',
    background: '#2a9d6f',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },

  // Modal
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 999,
  },
  modal: {
    background: '#fff',
    borderRadius: 16,
    padding: 24,
    maxWidth: 420,
    width: '100%',
    maxHeight: '80vh',
    overflow: 'auto',
  },
  modalTitle: { fontSize: 18, fontWeight: 600, margin: '0 0 16px', textAlign: 'center' },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 },

  // Confirm
  confirmInfo: { marginBottom: 16 },
  confirmRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: '1px solid #f3f4f6',
  },
  confirmLabel: { fontSize: 14, color: '#888' },
  confirmValue: { fontSize: 16, fontWeight: 600, color: '#1a1a1a' },

  // Preview
  previewBox: {
    background: '#f8faf9',
    borderRadius: 8,
    padding: 12,
    border: '1px solid #e5e7eb',
  },
  previewLabel: { fontSize: 11, color: '#888', marginBottom: 6 },
  previewContent: { fontSize: 13, color: '#333', whiteSpace: 'pre-line', lineHeight: 1.6 },

  // Progress
  progressBar: {
    height: 8,
    background: '#e5e7eb',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #2a9d6f, #34b882)',
    borderRadius: 4,
    transition: 'width 0.3s ease',
  },
  progressText: { textAlign: 'center', fontSize: 14, fontWeight: 500, color: '#1a1a1a' },

  // Result
  resultIcon: { textAlign: 'center', fontSize: 48, marginBottom: 8 },
  resultNumber: { textAlign: 'center', fontSize: 16, color: '#333' },

  // Logs
  logList: { display: 'flex', flexDirection: 'column', gap: 8 },
  logItem: {
    background: '#fff',
    borderRadius: 10,
    padding: '12px 14px',
    border: '1px solid #e5e7eb',
  },
  logTop: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
  logDate: { fontSize: 12, color: '#888', minWidth: 80 },
  logLabel: { fontSize: 13, fontWeight: 600, color: '#1a1a1a' },
  logStats: { display: 'flex', gap: 12, fontSize: 13, color: '#666', marginBottom: 4 },
  logClick: { color: '#2a9d6f', fontWeight: 500 },
  logPreview: { fontSize: 12, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

  // Loading
  loadingBar: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    background: 'linear-gradient(90deg, #2a9d6f, #34b882)',
    animation: 'loading 1s infinite',
  },

  // Login
  loginWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#f4f6f5',
    padding: 20,
  },
  loginCard: {
    background: '#fff',
    borderRadius: 16,
    padding: 32,
    maxWidth: 360,
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
  },
  loginTitle: { fontSize: 18, fontWeight: 600, margin: '0 0 24px', color: '#1a1a1a' },
  error: { color: '#ef4444', fontSize: 13, margin: '8px 0' },
};
