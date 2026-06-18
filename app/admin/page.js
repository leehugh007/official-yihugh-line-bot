'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';

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
const BOT_BASE_URL = 'https://official-yihugh-line-bot.vercel.app';

function normalizeAdminPublicUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^https:\/\//i.test(value)) return value;
  if (/^\/(?!\/)/.test(value)) return `${BOT_BASE_URL}${value}`;
  return value;
}

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
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
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
    } catch (err) {
      setError(`上傳失敗：${err?.message || '請稍後再試'}`);
    }
    e.target.value = '';
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
  const cleanButtons = (buttons || []).filter(isUsableRetargetingButton);
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
                  {(btn.actionType === 'message' || (!btn.url && btn.replyText)) && (
                    <span style={{ display: 'block', marginTop: 3, fontSize: 11, fontWeight: 500, opacity: 0.78 }}>
                      文字回覆
                    </span>
                  )}
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
  return `/api/admin?action=${action}&secret=${localStorage.getItem('admin_secret') || ''}`;
}

async function apiPost(data) {
  const secret = localStorage.getItem('admin_secret') || '';
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
  const [loggingIn, setLoggingIn] = useState(false);

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
      secret: localStorage.getItem('admin_secret') || '',
    });
    const res = await fetch(`/api/admin?${params}`);
    const data = await res.json();
    setApplicationsData(data);
  }, []);

  const loadUsers = useCallback(async (page = 1, search = '', filters = {}) => {
    const params = new URLSearchParams({
      action: 'users',
      secret: localStorage.getItem('admin_secret') || '',
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
    const trimmedPassword = password.trim();
    if (!trimmedPassword) {
      setLoginError('請輸入管理密碼');
      return;
    }
    setLoggingIn(true);
    setLoginError('');
    localStorage.setItem('admin_secret', trimmedPassword);
    try {
      const res = await fetch(apiUrl('stats'));
      if (res.ok) {
        setAuthed(true);
        setLoginError('');
        loadData();
      } else {
        setLoginError('密碼錯誤');
        localStorage.removeItem('admin_secret');
      }
    } catch {
      setLoginError('連線失敗');
    } finally {
      setLoggingIn(false);
    }
  };

  // 自動登入（如果 sessionStorage 有密碼）
  useEffect(() => {
    const saved = localStorage.getItem('admin_secret');
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
            onChange={(e) => {
              setPassword(e.target.value);
              if (loginError) setLoginError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="輸入管理密碼"
            style={styles.input}
            autoFocus
          />
          {loginError && <p style={styles.error}>{loginError}</p>}
          <button onClick={handleLogin} style={styles.btnPrimary} disabled={loggingIn}>
            {loggingIn ? '登入中...' : '登入'}
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
          style={tab === 'pricing' ? styles.tabActive : styles.tab}
          onClick={() => setTab('pricing')}
        >
          💰 定價
        </button>
        <button
          style={tab === 'analytics' ? styles.tabActive : styles.tab}
          onClick={() => setTab('analytics')}
        >
          📊 分析
        </button>
        <button
          style={tab === 'audiences' ? styles.tabActive : styles.tab}
          onClick={() => setTab('audiences')}
        >
          🎯 受眾
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
          }} onResetAdminDrip={async () => {
            const res = await apiPost({ action: 'reset_admin_drip' });
            if (res.error) return res;
            const refreshed = await fetch(apiUrl('drip_stats')).then(r => r.json());
            setDripStats(refreshed);
            return res;
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
      {tab === 'pricing' && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>💰 V3.2 三段價控制</h2>
          <p style={styles.sectionDesc}>
            超早鳥 → 一般早鳥 → 原價 三段切換。改 cutoff 立即影響之後進 /apply 的人，已提交訂單 final_price snapshot 不變。
          </p>
          <PricingTab
            settings={settings}
            onUpdated={(key, value) => setSettings(prev => ({ ...prev, [key]: value }))}
          />
        </div>
      )}

      {/* 分析 Tab */}
      {tab === 'analytics' && (
        <div style={styles.section}>
          <AnalyticsTab />
        </div>
      )}

      {tab === 'audiences' && (
        <div style={styles.section}>
          <AudienceRetargetingPrototype />
        </div>
      )}

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
const DRIP_ARTICLE_TYPES = [
  { id: 'student_story', label: '學員故事' },
  { id: 'health_article', label: '健康文章' },
  { id: 'intro', label: '一休介紹' },
  { id: 'method', label: '方法觀念' },
  { id: 'apply', label: '報名 / 優惠' },
  { id: 'other', label: '其他' },
];

const DRIP_ARTICLE_TYPE_LABELS = Object.fromEntries(DRIP_ARTICLE_TYPES.map((item) => [item.id, item.label]));

function DripTab({ dripStats, onUpdate, onToggleActive, onToggleTestMode, onResetAdminDrip, onAddStep, onDeleteStep }) {
  const [editingStep, setEditingStep] = useState(null);
  const [editData, setEditData] = useState({});
  const [toggleError, setToggleError] = useState(null); // { step, msg }
  const [toggling, setToggling] = useState(null); // step number
  const [previewStep, setPreviewStep] = useState(null); // step number to preview before activation
  const [togglingTestMode, setTogglingTestMode] = useState(false);
  const [resettingAdminDrip, setResettingAdminDrip] = useState(false);
  const [adminResetResult, setAdminResetResult] = useState(null);
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
      <div style={styles.dripAdminResetBox}>
        <div>
          <strong>管理者測試重跑</strong>
          <span style={styles.retargetingMuted}>
            若管理者之前已收到排程文章，可重設進度。會保留管理者的真實標籤，測試模式下忽略商業排除條件，下一次 cron 從第 1 篇重新開始。
          </span>
          {adminResetResult && (
            <span style={{ ...styles.retargetingMuted, color: adminResetResult.error ? '#991b1b' : '#166534' }}>
              {adminResetResult.error
                ? adminResetResult.error
                : `已重置 ${adminResetResult.reset} 位管理者，清除 ${adminResetResult.deletedLogs} 筆文章發送紀錄 / ${adminResetResult.deletedClicks} 筆點擊紀錄 / ${adminResetResult.deletedRetargetingLogs || 0} 筆再行銷測試紀錄；目前等待下一次 cron 發送第 1 篇`}
            </span>
          )}
        </div>
        <button
          type="button"
          style={{ ...styles.btnSecondary, color: '#92400e', borderColor: '#fcd34d' }}
          disabled={resettingAdminDrip}
          onClick={async () => {
            const ok = window.confirm('確定要讓所有管理者從第 1 篇排程文章重新開始？這會清除管理者的 drip 測試發送與點擊紀錄。');
            if (!ok) return;
            setResettingAdminDrip(true);
            const res = await onResetAdminDrip();
            setAdminResetResult(res || { ok: true });
            setResettingAdminDrip(false);
          }}
        >
          {resettingAdminDrip ? '重置中...' : '重置管理者排程'}
        </button>
      </div>

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
                <div style={{ fontSize: 12, color: '#2a9d6f', marginBottom: 8 }}>
                  類型：{DRIP_ARTICLE_TYPE_LABELS[step.article_type || 'other'] || DRIP_ARTICLE_TYPE_LABELS.other}
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
                <label style={styles.fieldLabel}>文章類型</label>
                <select
                  value={editData.article_type || 'other'}
                  onChange={(e) => setEditData({ ...editData, article_type: e.target.value })}
                  style={styles.input}
                >
                  {DRIP_ARTICLE_TYPES.map((type) => (
                    <option key={type.id} value={type.id}>{type.label}</option>
                  ))}
                </select>
                <div style={styles.retargetingPrototypeNotice}>
                  這個類型會影響受眾再行銷的「學員故事 / 健康文章」條件與後續成效分析。
                </div>
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
                  <div style={{ fontSize: 12, color: '#2a9d6f', marginTop: 4 }}>
                    {DRIP_ARTICLE_TYPE_LABELS[step.article_type || 'other'] || DRIP_ARTICLE_TYPE_LABELS.other}
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
                        article_type: step.article_type || 'other',
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
                <span style={{ color: '#64748b' }}>類型：{DRIP_ARTICLE_TYPE_LABELS[step.article_type || 'other'] || DRIP_ARTICLE_TYPE_LABELS.other}</span>
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
    observed: { label: '已觀察', bg: '#e0f2fe', color: '#0369a1' },
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
  q5_visit_followup_text: {
    label: '/apply 點擊後未填表追問文案',
    desc: '用戶點進 /apply 但未送出表單，cron 於設定時間後推送一次。第一版為純文字追問，不含 Quick Reply 按鈕',
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
// PricingTab — V3.2 三段價控制（migration_018+019）
// 業務時間軸：~5/18 超早鳥 / 5/19~5/24 一般早鳥 / 5/24 後 原價真實成交
// 改 cutoff 立即影響之後進 /apply 的人；已提交訂單 final_price snapshot 不變
// ============================================================
function toLocalDateTimeInput(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function toTaiwanDisplay(isoStr) {
  if (!isoStr) return '（未設）';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '（無效）';
  return d.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function diffDisplayHHMM(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr).getTime() - Date.now();
  if (d > 0) {
    const days = Math.floor(d / 86400000);
    const hours = Math.floor((d % 86400000) / 3600000);
    return `剩 ${days} 天 ${hours} 小時`;
  }
  return `已過期 ${Math.floor(-d / 86400000)} 天`;
}

const TIER_META = {
  super: { emoji: '🔥', name: '超早鳥優惠中', color: '#dc2626' },
  regular: { emoji: '🌱', name: '一般早鳥優惠中', color: '#0b6e39' },
  anchor: { emoji: '⏸', name: '兩段早鳥皆已結束（原價真實成交）', color: '#92400e' },
};

function PricingTab({ settings, onUpdated }) {
  const super_cutoff_at = settings.super_early_bird_cutoff_at || null;
  const regular_cutoff_at = settings.regular_early_bird_cutoff_at || null;
  const prices = {
    super: parseInt(settings.price_12weeks_super, 10) || 10400,
    regular: parseInt(settings.price_12weeks_regular, 10) || 11400,
    anchor: parseInt(settings.price_12weeks_anchor, 10) || 12600,
    trial: parseInt(settings.price_4weeks_trial, 10) || 4980,
  };
  const now = new Date();
  const superDate = super_cutoff_at ? new Date(super_cutoff_at) : null;
  const regularDate = regular_cutoff_at ? new Date(regular_cutoff_at) : null;
  const superValid = superDate && !isNaN(superDate.getTime());
  const regularValid = regularDate && !isNaN(regularDate.getTime());
  const super_active = !!(superValid && now < superDate);
  const regular_active = !!(!super_active && regularValid && now < regularDate);
  const tier = super_active ? 'super' : regular_active ? 'regular' : 'anchor';
  const tierMeta = TIER_META[tier];

  const [superPicker, setSuperPicker] = useState(toLocalDateTimeInput(super_cutoff_at));
  const [regularPicker, setRegularPicker] = useState(toLocalDateTimeInput(regular_cutoff_at));
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [batchName, setBatchName] = useState(settings.program_batch_name || '下一期班');
  const [batchStartDate, setBatchStartDate] = useState(settings.program_start_date || '');
  const [q5Msg3Template, setQ5Msg3Template] = useState(settings.q5_msg3_template || '');
  const [q5Msg4Template, setQ5Msg4Template] = useState(settings.q5_msg4_template || '');

  // settings 變動（parent reload）→ 同步 picker 預填值
  useEffect(() => {
    setSuperPicker(toLocalDateTimeInput(super_cutoff_at));
    setRegularPicker(toLocalDateTimeInput(regular_cutoff_at));
  }, [super_cutoff_at, regular_cutoff_at]);

  useEffect(() => {
    setBatchName(settings.program_batch_name || '下一期班');
    setBatchStartDate(settings.program_start_date || '');
    setQ5Msg3Template(settings.q5_msg3_template || '');
    setQ5Msg4Template(settings.q5_msg4_template || '');
  }, [
    settings.program_batch_name,
    settings.program_start_date,
    settings.q5_msg3_template,
    settings.q5_msg4_template,
  ]);

  async function saveClassCopySettings() {
    setSaving('class_copy');
    setError(null);
    setResult(null);
    const values = {
      program_batch_name: batchName.trim() || '下一期班',
      program_start_date: batchStartDate,
      q5_msg3_template: q5Msg3Template,
      q5_msg4_template: q5Msg4Template,
    };
    try {
      for (const [key, value] of Object.entries(values)) {
        const data = await apiPost({ action: 'update_setting', key, value });
        if (!data.ok) throw new Error(data.error || `${key} 儲存失敗`);
        if (onUpdated) onUpdated(key, value);
      }
      setResult({ key: '班級與 Q5 文案', cutoff_at: null, classCopy: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  }

  async function callSet(key, cutoff_at, confirmMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setSaving(key);
    setError(null);
    setResult(null);
    try {
      const data = await apiPost({ action: 'set_pricing_cutoff', key, cutoff_at });
      if (!data.ok) {
        setError(data.error || '儲存失敗');
      } else {
        setResult(data);
        if (onUpdated) onUpdated(key, data.cutoff_at);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  }

  function handleApply(key, picker, label) {
    if (!picker) {
      setError('請選日期時間');
      return;
    }
    const localDate = new Date(picker);
    if (isNaN(localDate.getTime())) {
      setError('日期格式錯誤');
      return;
    }
    const future = localDate > new Date();
    callSet(
      key,
      localDate.toISOString(),
      future
        ? `確定 ${label} 截止日設為 ${picker}？`
        : `這個時間已經過了！設下去等於立刻關閉 ${label}。確定？`
    );
  }

  function handleCloseNow(key, label) {
    callSet(
      key,
      new Date().toISOString(),
      `確定立刻關閉「${label}」？\n\n之後進 /apply 的人不再看到這段優惠。`
    );
  }

  const cardStyle = (active) => ({
    padding: 16,
    backgroundColor: active ? '#dcfce7' : '#f3f4f6',
    border: `1px solid ${active ? '#86efac' : '#d1d5db'}`,
    borderRadius: 8,
    marginBottom: 12,
  });
  const btnPrimary = (disabled) => ({
    flex: 1,
    padding: '10px',
    fontSize: 14,
    fontWeight: 600,
    color: 'white',
    backgroundColor: disabled ? '#999' : '#0b6e39',
    border: 'none',
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
  });
  const btnDanger = (disabled) => ({
    ...btnPrimary(disabled),
    backgroundColor: disabled ? '#999' : '#dc2626',
  });

  return (
    <div>
      {/* 當前狀態 */}
      <div
        style={{
          marginBottom: 24,
          padding: 16,
          backgroundColor: '#f0fdf4',
          border: `2px solid ${tierMeta.color}`,
          borderRadius: 10,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 12, color: tierMeta.color }}>
          目前狀態：{tierMeta.emoji} {tierMeta.name}
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.7 }}>
          <div>超早鳥截止：<b>{toTaiwanDisplay(super_cutoff_at)}</b>（{diffDisplayHHMM(super_cutoff_at)}）</div>
          <div>一般早鳥截止：<b>{toTaiwanDisplay(regular_cutoff_at)}</b>（{diffDisplayHHMM(regular_cutoff_at)}）</div>
          <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid #d1d5db' }} />
          <div style={{ fontSize: 13, color: '#374151' }}>
            定價（12 週方案實際成交價）：
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              <li>超早鳥：NT$ {prices.super.toLocaleString()}（NOW &lt; super_cutoff）</li>
              <li>一般早鳥：NT$ {prices.regular.toLocaleString()}（super_cutoff ≤ NOW &lt; regular_cutoff）</li>
              <li>原價：NT$ {prices.anchor.toLocaleString()}（NOW ≥ regular_cutoff，5/24 後真實成交）</li>
              <li>4 週體驗版：NT$ {prices.trial.toLocaleString()}</li>
            </ul>
          </div>
        </div>
      </div>

      <div style={cardStyle(true)}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 15 }}>
          班級名稱、開課日與 Q5 文案
        </div>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px' }}>
          這裡會同步影響 Q5 第 3 / 4 段訊息與報名頁，不再固定顯示 6 月班或 6/1。
        </p>
        <label style={styles.fieldLabel}>班級 / 梯次名稱</label>
        <input
          value={batchName}
          onChange={(e) => setBatchName(e.target.value)}
          style={styles.input}
          placeholder="例如：7 月班"
        />
        <label style={styles.fieldLabel}>開課日期</label>
        <input
          type="date"
          value={batchStartDate}
          onChange={(e) => setBatchStartDate(e.target.value)}
          style={styles.input}
        />
        <label style={styles.fieldLabel}>Q5 第 3 段完整文案（選填）</label>
        <textarea
          value={q5Msg3Template}
          onChange={(e) => setQ5Msg3Template(e.target.value)}
          style={styles.textarea}
          rows={7}
          placeholder="留空使用系統預設。可使用 {{batch_name}}、{{start_date}}、{{price_lines}}。"
        />
        <label style={styles.fieldLabel}>Q5 第 4 段完整文案（選填）</label>
        <textarea
          value={q5Msg4Template}
          onChange={(e) => setQ5Msg4Template(e.target.value)}
          style={styles.textarea}
          rows={7}
          placeholder="留空使用系統預設。可使用 {{batch_name}}、{{start_date}}。"
        />
        <button
          type="button"
          onClick={saveClassCopySettings}
          disabled={saving === 'class_copy'}
          style={btnPrimary(saving === 'class_copy')}
        >
          {saving === 'class_copy' ? '儲存中…' : '儲存班級與 Q5 文案'}
        </button>
      </div>

      {/* 超早鳥區 */}
      <div style={cardStyle(super_active)}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 15 }}>
          🔥 超早鳥截止日 {super_active && '（活躍中）'}
        </div>
        <input
          type="datetime-local"
          value={superPicker}
          onChange={(e) => setSuperPicker(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: 14,
            border: '1px solid #ccc',
            borderRadius: 6,
            marginBottom: 10,
          }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => handleApply('super_early_bird_cutoff_at', superPicker, '超早鳥')}
            disabled={!!saving || !superPicker}
            style={btnPrimary(!!saving || !superPicker)}
          >
            {saving === 'super_early_bird_cutoff_at' ? '儲存中…' : '✅ 套用'}
          </button>
          <button
            onClick={() => handleCloseNow('super_early_bird_cutoff_at', '超早鳥')}
            disabled={!!saving}
            style={btnDanger(!!saving)}
          >
            ⏹ 立刻關閉
          </button>
        </div>
      </div>

      {/* 一般早鳥區 */}
      <div style={cardStyle(regular_active)}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 15 }}>
          🌱 一般早鳥截止日 {regular_active && '（活躍中）'}
        </div>
        <input
          type="datetime-local"
          value={regularPicker}
          onChange={(e) => setRegularPicker(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: 14,
            border: '1px solid #ccc',
            borderRadius: 6,
            marginBottom: 10,
          }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => handleApply('regular_early_bird_cutoff_at', regularPicker, '一般早鳥')}
            disabled={!!saving || !regularPicker}
            style={btnPrimary(!!saving || !regularPicker)}
          >
            {saving === 'regular_early_bird_cutoff_at' ? '儲存中…' : '✅ 套用'}
          </button>
          <button
            onClick={() => handleCloseNow('regular_early_bird_cutoff_at', '一般早鳥')}
            disabled={!!saving}
            style={btnDanger(!!saving)}
          >
            ⏹ 立刻關閉
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            backgroundColor: '#fee2e2',
            border: '1px solid #fca5a5',
            borderRadius: 6,
            color: '#991b1b',
          }}
        >
          ❌ {error}
        </div>
      )}

      {result && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            backgroundColor: '#dcfce7',
            border: '1px solid #86efac',
            borderRadius: 6,
            color: '#166534',
            fontSize: 13,
          }}
        >
          {result.classCopy ? (
            <>✅ 班級名稱、開課日與 Q5 文案已更新</>
          ) : (
            <>
              ✅ 已更新 {result.key} = {toTaiwanDisplay(result.cutoff_at)}
              <br />
              {result.is_future ? '截止日在未來（活躍）' : '截止日已過（不活躍）'}
            </>
          )}
        </div>
      )}
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
  const [exporting, setExporting] = useState(false);

  // 匯出 CSV（依當前 filter）
  async function handleExportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const secret = localStorage.getItem('admin_secret') || '';
      const res = await fetch(`/api/admin?action=export_applications&filter=${filter}&secret=${secret}`);
      const json = await res.json();
      if (!json.ok) {
        alert('匯出失敗：' + (json.error || 'unknown'));
        return;
      }
      downloadApplicationsCsv(json.rows || [], filter);
    } catch (e) {
      alert('匯出失敗：' + (e?.message || String(e)));
    } finally {
      setExporting(false);
    }
  }

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
        <button
          onClick={handleExportCsv}
          disabled={exporting}
          style={{ ...appBtn, marginLeft: 'auto', opacity: exporting ? 0.5 : 1 }}
        >
          {exporting ? '匯出中…' : '📥 匯出 CSV'}
        </button>
        <button onClick={onReload} style={appBtn}>🔄 重整</button>
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
// CSV 匯出 helper（applications）
// ============================================================
// 用 UTF-8 BOM 確保 Excel 開啟中文不亂碼。
// 欄位中文化 + 方案 / 狀態 / 性別 也轉中文 label。
function downloadApplicationsCsv(rows, filter) {
  const headers = [
    'ID', '報名時間', '姓名', '性別', '年齡', '電話', 'Email', '地址',
    'LINE userId', 'LINE 名稱', 'LINE ID', '方案', '來源', '狀態',
    '付款時間', '付款金額', '付款日期', '匯款後五碼', '標記者', '備註',
  ];
  const GENDER_ZH = { male: '男', female: '女', other: '其他' };

  const csvRows = rows.map((r) => [
    r.id,
    fmtDate(r.submitted_at),
    r.real_name,
    GENDER_ZH[r.gender] || r.gender,
    r.age,
    r.phone,
    r.email,
    r.address,
    r.line_user_id,
    r.display_name,
    r.line_id,
    planLabel(r.program_choice),
    r.source,
    statusLabel(r.status),
    fmtDate(r.paid_at),
    r.payment_amount,
    r.payment_date,
    r.payment_last5, // 完整後五碼（export endpoint 不 mask）
    r.paid_marked_by,
    r.notes,
  ]);

  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const csv = '﻿' + [
    headers.join(','),
    ...csvRows.map((row) => row.map(escape).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `applications_${filter}_${todayStr()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

// ============================================================
// 📊 分析 Tab（Q5 漏斗分析）
// ============================================================

const ANALYTICS_PATHS = ['healthCheck', 'rebound', 'postpartum', 'eatOut', 'other'];
const ANALYTICS_METABOLISM = ['highRPM', 'rollerCoaster', 'burnout', 'powerSave', 'steady'];
const ANALYTICS_PATH_LABELS = {
  healthCheck: '健檢紅字',
  rebound: '復胖',
  postpartum: '產後',
  eatOut: '外食',
  other: '其他',
};
const ANALYTICS_METABOLISM_LABELS = {
  highRPM: '高轉速',
  rollerCoaster: '溜溜球',
  burnout: '倦怠',
  powerSave: '省電',
  steady: '穩定',
};
const ANALYTICS_STAGE_LABELS = {
  stuck_msg1: '卡在 msg1（沒回應）',
  stuck_msg2: '卡在 msg2（沒回應）',
  stuck_msg3: '卡在 msg3（沒點 /apply）',
  stuck_msg4: '卡在 msg4（沒點 /apply）',
  clicked_no_submit: '點了 /apply 但沒送單',
  submitted_pending: '送單未付款',
  paid: '已付款',
};
const ANALYTICS_STAGE_KEYS = Object.keys(ANALYTICS_STAGE_LABELS);

function pct(num, denom) {
  if (!denom) return '—';
  return `${((num / denom) * 100).toFixed(1)}%`;
}

function daysAgo(iso) {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return '今天';
  if (days === 1) return '1 天前';
  return `${days} 天前`;
}

function AnalyticsTab() {
  const [range, setRange] = useState('all'); // all | 7d | 30d
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [groupView, setGroupView] = useState('overall'); // overall | by_path | by_metabolism
  const [expandedPaths, setExpandedPaths] = useState({});

  // 下半部
  const [filter, setFilter] = useState({
    paths: [],
    metabolismTypes: [],
    daysStuck: 0,
    enrolled: 'false', // 'all' | 'true' | 'false'
  });
  const [users, setUsers] = useState(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [expandedStages, setExpandedStages] = useState({});

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch(apiUrl('funnel_stats') + `&range=${range}`);
      const data = await res.json();
      setStats(data);
    } finally {
      setStatsLoading(false);
    }
  }, [range]);

  const loadUsers = useCallback(async (overrideFilter) => {
    const f = overrideFilter || filter;
    setUsersLoading(true);
    try {
      const params = new URLSearchParams();
      if (f.paths.length) params.set('paths', f.paths.join(','));
      if (f.metabolismTypes.length) params.set('metabolism', f.metabolismTypes.join(','));
      if (f.daysStuck > 0) params.set('days_stuck', String(f.daysStuck));
      if (f.enrolled === 'true' || f.enrolled === 'false') params.set('enrolled', f.enrolled);
      params.set('range', range);
      const res = await fetch(apiUrl('funnel_users') + '&' + params.toString());
      const data = await res.json();
      setUsers(data);
      setExpandedStages({});
    } finally {
      setUsersLoading(false);
    }
  }, [filter, range]);

  useEffect(() => { loadStats(); }, [loadStats]);

  // 上半部 drill-down「看名單」按鈕：套條件 + 滾下半部
  const handleViewList = (path, metabolismType) => {
    const newFilter = {
      paths: path ? [path] : [],
      metabolismTypes: metabolismType ? [metabolismType] : [],
      daysStuck: 0,
      enrolled: 'false',
    };
    setFilter(newFilter);
    loadUsers(newFilter);
    setTimeout(() => {
      document.getElementById('funnel-users-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const togglePath = (p) => setExpandedPaths((prev) => ({ ...prev, [p]: !prev[p] }));
  const toggleStage = (s) => setExpandedStages((prev) => ({ ...prev, [s]: !prev[s] }));
  const expandAllPaths = () => {
    const next = {};
    ANALYTICS_PATHS.forEach((p) => { next[p] = true; });
    setExpandedPaths(next);
  };
  const collapseAllPaths = () => setExpandedPaths({});

  return (
    <div>
      <h2 style={styles.sectionTitle}>📊 Q5 漏斗分析</h2>
      <p style={styles.sectionDesc}>看用戶卡在哪段、哪種組合轉換最好、撈名單為後續推播做準備</p>

      {/* 時間範圍 */}
      <div style={styles.analyticsToolbar}>
        <span style={{ fontSize: 13, color: '#666', marginRight: 8 }}>時間範圍（依加入時間）：</span>
        {[
          { v: 'all', l: '全部' },
          { v: '7d', l: '近 7 天' },
          { v: '30d', l: '近 30 天' },
        ].map((opt) => (
          <button
            key={opt.v}
            onClick={() => setRange(opt.v)}
            style={range === opt.v ? styles.analyticsChipActive : styles.analyticsChip}
          >
            {opt.l}
          </button>
        ))}
        {statsLoading && <span style={{ fontSize: 12, color: '#888', marginLeft: 12 }}>載入中…</span>}
      </div>

      {!stats?.ok && !statsLoading && (
        <div style={{ ...styles.card, marginTop: 12 }}>
          {stats?.error ? `❌ ${stats.error}` : '尚未載入資料'}
        </div>
      )}

      {stats?.ok && (
        <>
          {/* ============ 上半部：總覽 ============ */}

          {/* 分組視圖切換 */}
          <div style={{ ...styles.analyticsToolbar, marginTop: 16 }}>
            <span style={{ fontSize: 13, color: '#666', marginRight: 8 }}>整體漏斗檢視：</span>
            {[
              { v: 'overall', l: '整體' },
              { v: 'by_path', l: '按 Path' },
              { v: 'by_metabolism', l: '按代謝類型' },
            ].map((opt) => (
              <button
                key={opt.v}
                onClick={() => setGroupView(opt.v)}
                style={groupView === opt.v ? styles.analyticsChipActive : styles.analyticsChip}
              >
                {opt.l}
              </button>
            ))}
          </div>

          {/* 漏斗主表 */}
          {groupView === 'overall' && <OverallFunnel overall={stats.overall} />}
          {groupView === 'by_path' && (
            <GroupedFunnel
              groups={ANALYTICS_PATHS}
              labels={ANALYTICS_PATH_LABELS}
              data={stats.by_path}
            />
          )}
          {groupView === 'by_metabolism' && (
            <GroupedFunnel
              groups={ANALYTICS_METABOLISM}
              labels={ANALYTICS_METABOLISM_LABELS}
              data={stats.by_metabolism}
            />
          )}

          {/* Path × 代謝類型 交叉表 */}
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h3 style={styles.analyticsH3}>Path × 代謝類型（點 ▼ 展開細節，點 👁 撈該組名單）</h3>
              <div>
                <button style={styles.analyticsLinkBtn} onClick={expandAllPaths}>展開全部</button>
                <button style={styles.analyticsLinkBtn} onClick={collapseAllPaths}>收合全部</button>
              </div>
            </div>
            <CrossTable
              data={stats.by_path_metabolism}
              expanded={expandedPaths}
              onToggle={togglePath}
              onViewList={handleViewList}
            />
          </div>

          {/* 每段訊息互動反應 */}
          <div style={{ marginTop: 24 }}>
            <h3 style={styles.analyticsH3}>💬 每段訊息互動反應（看哪段卡住、哪段勾不到人）</h3>
            <MsgReactions reactions={stats.msg_reactions} tracking={stats.tracking} />
          </div>
        </>
      )}

      {/* ============ 下半部：用戶分群分析 ============ */}
      <div id="funnel-users-section" style={{ marginTop: 32, borderTop: '2px solid #e5e7eb', paddingTop: 20 }}>
        <h2 style={styles.sectionTitle}>🔍 用戶分群分析</h2>
        <p style={styles.sectionDesc}>勾選條件 → 看這群人卡在哪段 → 展開拿名單</p>

        <FilterPanel filter={filter} setFilter={setFilter} onApply={() => loadUsers()} loading={usersLoading} />

        {users?.ok && (
          <UsersSummary
            users={users}
            expandedStages={expandedStages}
            onToggleStage={toggleStage}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================
// 上半部子元件
// ============================================================

function OverallFunnel({ overall }) {
  const q5Denom = overall.in_q5 || 1;
  const rows = [
    { label: '總用戶', value: overall.total, denom: null },
    { label: '↓ 獲得檢測報告（含 3 段訊息）', value: overall.got_report, denom: overall.total },
    { label: '↓ 進 Q1（有動作或互動）', value: overall.in_q1, denom: overall.total },
    { label: '↓ 答完 Q1 → 進 Q2（回覆體重）', value: overall.in_q2, denom: overall.total },
    { label: '↓ 答完 Q2 → 進 Q3（path 確定）', value: overall.in_q3, denom: overall.total },
    { label: '↓ 答完 Q3 → 進 Q4', value: overall.in_q4, denom: overall.total },
    { label: '↓ Q4 AI 回饋完成', value: overall.finished_q4, denom: overall.total, divider: true },
    { label: '（中間 Q4 末尾 3 按鈕 + 學員故事 Flex 3 按鈕的點擊分佈，看下面「每段訊息互動反應」表）', hint: true },
    { label: '↓ 進 Q5 漏斗（收到 msg1）', value: overall.in_q5, denom: overall.total },
    { label: '  ↓ 收到 msg2 介紹', value: overall.msg2_sent, denom: q5Denom },
    { label: '  ↓ 收到 msg3 報價', value: overall.msg3_sent, denom: q5Denom },
    { label: '  ↓ 收到 msg4 提醒', value: overall.msg4_sent, denom: q5Denom },
    { label: '  ↓ 點了 /apply', value: overall.clicked_apply, denom: q5Denom },
    { label: '  ↓ 送出表單', value: overall.submitted, denom: q5Denom },
    { label: '  ↓ 完成付款 ⭐', value: overall.paid, denom: q5Denom, gold: true },
  ];
  return (
    <div style={styles.analyticsCard}>
      {rows.map((r, i) => {
        if (r.hint) {
          return (
            <div key={i} style={{ ...styles.analyticsFunnelRow, fontSize: 12, color: '#94a3b8', fontStyle: 'italic', paddingLeft: 16 }}>
              {r.label}
            </div>
          );
        }
        return (
          <div
            key={i}
            style={{
              ...styles.analyticsFunnelRow,
              ...(r.gold ? { background: '#fef9c3' } : {}),
              ...(r.divider ? { borderTop: '1px dashed #d1d5db', marginTop: 4, paddingTop: 8 } : {}),
            }}
          >
            <span style={{ flex: 1 }}>{r.label}</span>
            <span style={{ fontWeight: 600 }}>{r.value}</span>
            <span style={{ color: '#888', minWidth: 60, textAlign: 'right' }}>
              {r.denom ? pct(r.value, r.denom) : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function GroupedFunnel({ groups, labels, data }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.analyticsTable}>
        <thead>
          <tr>
            <th style={styles.analyticsTh}>階段</th>
            {groups.map((g) => (
              <th key={g} style={styles.analyticsTh}>{labels[g]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[
            { key: 'in_q1', label: '進 Q1' },
            { key: 'in_q2', label: '答完 Q1' },
            { key: 'in_q3', label: '答完 Q2' },
            { key: 'in_q4', label: '答完 Q3' },
            { key: 'finished_q4', label: 'Q4 回饋完成', divider: true },
            { key: 'in_q5', label: '進 Q5（收 msg1）' },
            { key: 'msg2_sent', label: '收到 msg2' },
            { key: 'msg3_sent', label: '收到 msg3' },
            { key: 'msg4_sent', label: '收到 msg4' },
            { key: 'clicked_apply', label: '點 /apply' },
            { key: 'submitted', label: '送出表單' },
            { key: 'paid', label: '✅ 付款' },
          ].map((row) => (
            <tr key={row.key} style={row.divider ? { borderBottom: '2px solid #d1d5db' } : undefined}>
              <td style={styles.analyticsTd}>{row.label}</td>
              {groups.map((g) => (
                <td key={g} style={styles.analyticsTd}>{data[g]?.[row.key] || 0}</td>
              ))}
            </tr>
          ))}
          <tr style={{ background: '#fef9c3' }}>
            <td style={{ ...styles.analyticsTd, fontWeight: 600 }}>付款率</td>
            {groups.map((g) => (
              <td key={g} style={{ ...styles.analyticsTd, fontWeight: 600 }}>
                {pct(data[g]?.paid || 0, data[g]?.in_q5 || 0)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CrossTable({ data, expanded, onToggle, onViewList }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.analyticsTable}>
        <thead>
          <tr>
            <th style={styles.analyticsTh}>Path / 代謝類型</th>
            <th style={styles.analyticsTh}>進 Q5</th>
            <th style={styles.analyticsTh}>msg3</th>
            <th style={styles.analyticsTh}>點 apply</th>
            <th style={styles.analyticsTh}>送單</th>
            <th style={styles.analyticsTh}>付款</th>
            <th style={styles.analyticsTh}>付款率</th>
            <th style={styles.analyticsTh}></th>
          </tr>
        </thead>
        <tbody>
          {ANALYTICS_PATHS.map((p) => {
            const pData = data[p];
            if (!pData) return null;
            const pTotal = Object.values(pData).reduce(
              (acc, m) => {
                acc.in_q5 += m.in_q5;
                acc.msg3_sent += m.msg3_sent;
                acc.clicked_apply += m.clicked_apply;
                acc.submitted += m.submitted;
                acc.paid += m.paid;
                return acc;
              },
              { in_q5: 0, msg3_sent: 0, clicked_apply: 0, submitted: 0, paid: 0 }
            );
            return (
              <Fragment key={p}>
                <tr style={{ background: '#f9fafb', fontWeight: 600 }}>
                  <td style={styles.analyticsTd}>
                    <button onClick={() => onToggle(p)} style={styles.analyticsExpandBtn}>
                      {expanded[p] ? '▼' : '▶'} {ANALYTICS_PATH_LABELS[p]}
                    </button>
                  </td>
                  <td style={styles.analyticsTd}>{pTotal.in_q5}</td>
                  <td style={styles.analyticsTd}>{pTotal.msg3_sent}</td>
                  <td style={styles.analyticsTd}>{pTotal.clicked_apply}</td>
                  <td style={styles.analyticsTd}>{pTotal.submitted}</td>
                  <td style={styles.analyticsTd}>{pTotal.paid}</td>
                  <td style={styles.analyticsTd}>{pct(pTotal.paid, pTotal.in_q5)}</td>
                  <td style={styles.analyticsTd}>
                    <button style={styles.analyticsViewBtn} onClick={() => onViewList(p, null)}>👁</button>
                  </td>
                </tr>
                {expanded[p] && ANALYTICS_METABOLISM.map((m) => {
                  const cell = pData[m] || { in_q5: 0, msg3_sent: 0, clicked_apply: 0, submitted: 0, paid: 0 };
                  if (cell.in_q5 === 0) return (
                    <tr key={m} style={{ color: '#cbd5e1' }}>
                      <td style={{ ...styles.analyticsTd, paddingLeft: 28 }}>└ {ANALYTICS_METABOLISM_LABELS[m]}</td>
                      <td style={styles.analyticsTd} colSpan={7}>—</td>
                    </tr>
                  );
                  return (
                    <tr key={m}>
                      <td style={{ ...styles.analyticsTd, paddingLeft: 28 }}>└ {ANALYTICS_METABOLISM_LABELS[m]}</td>
                      <td style={styles.analyticsTd}>{cell.in_q5}</td>
                      <td style={styles.analyticsTd}>{cell.msg3_sent}</td>
                      <td style={styles.analyticsTd}>{cell.clicked_apply}</td>
                      <td style={styles.analyticsTd}>{cell.submitted}</td>
                      <td style={styles.analyticsTd}>{cell.paid}</td>
                      <td style={styles.analyticsTd}>{pct(cell.paid, cell.in_q5)}</td>
                      <td style={styles.analyticsTd}>
                        <button style={styles.analyticsViewBtn} onClick={() => onViewList(p, m)}>👁</button>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MsgReactions({ reactions, tracking }) {
  // 6 段：Q4 末尾 + 中間層 Flex + msg1-4
  // 每段 4 種反應分佈（不是每段都有所有反應，N/A 用 — 顯示）
  const msgs = [
    { key: 'q4',    label: 'Q4 末尾',     hasQuestion: false, hasDecline: true  },
    { key: 'story', label: '中間層 Flex', hasQuestion: true,  hasDecline: false },
    { key: 'msg1',  label: 'msg1',        hasQuestion: true,  hasDecline: false },
    { key: 'msg2',  label: 'msg2',        hasQuestion: true,  hasDecline: false },
    { key: 'msg3',  label: 'msg3',        hasQuestion: true,  hasDecline: false },
    { key: 'msg4',  label: 'msg4',        hasQuestion: true,  hasDecline: false },
  ];
  const cell = (val, sent) => (
    <>
      {val} <span style={{ color: '#888', fontSize: 11 }}>({pct(val, sent)})</span>
    </>
  );
  const buttonStatsStartedAt = tracking?.button_stats_started_at
    ? new Date(tracking.button_stats_started_at).toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : null;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.analyticsTable}>
        <thead>
          <tr>
            <th style={styles.analyticsTh}>反應</th>
            {msgs.map((m) => (
              <th key={m.key} style={styles.analyticsTh}>{m.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr style={{ background: '#f9fafb', fontWeight: 600 }}>
            <td style={styles.analyticsTd}>收到</td>
            {msgs.map((m) => (
              <td key={m.key} style={styles.analyticsTd}>{reactions[m.key]?.sent || 0}</td>
            ))}
          </tr>
          <tr>
            <td style={styles.analyticsTd}>✅ 往下走</td>
            {msgs.map((m) => {
              const r = reactions[m.key] || { next: 0, sent: 0 };
              return <td key={m.key} style={styles.analyticsTd}>{cell(r.next, r.sent)}</td>;
            })}
          </tr>
          <tr>
            <td style={styles.analyticsTd}>🤔 想想 / 再考慮</td>
            {msgs.map((m) => {
              const r = reactions[m.key] || { maybe: 0, sent: 0 };
              return <td key={m.key} style={styles.analyticsTd}>{cell(r.maybe, r.sent)}</td>;
            })}
          </tr>
          <tr>
            <td style={styles.analyticsTd}>❓ 我有問題</td>
            {msgs.map((m) => {
              const r = reactions[m.key] || { question: 0, sent: 0 };
              return (
                <td key={m.key} style={styles.analyticsTd}>
                  {m.hasQuestion ? cell(r.question, r.sent) : <span style={{ color: '#cbd5e1' }}>—</span>}
                </td>
              );
            })}
          </tr>
          <tr>
            <td style={styles.analyticsTd}>❌ 不適合</td>
            {msgs.map((m) => {
              const r = reactions[m.key] || { decline: 0, sent: 0 };
              return (
                <td key={m.key} style={styles.analyticsTd}>
                  {m.hasDecline ? cell(r.decline, r.sent) : <span style={{ color: '#cbd5e1' }}>—</span>}
                </td>
              );
            })}
          </tr>
          <tr style={{ color: '#888' }}>
            <td style={styles.analyticsTd}>🔕 沒回應 / 等待中</td>
            {msgs.map((m) => {
              const r = reactions[m.key] || { sent: 0, next: 0, maybe: 0, question: 0, decline: 0 };
              const noResp = r.sent - r.next - r.maybe - r.question - r.decline;
              return (
                <td key={m.key} style={styles.analyticsTd}>
                  {noResp} <span style={{ fontSize: 11 }}>({pct(noResp, r.sent)})</span>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
        ★ Q4 + 中間層 Flex 是 Q4 → Q5 中間 2 段（migration_023 才開始記資料，新資料逐步累積）。msg3/4「往下走」= 點 /apply。「沒回應」高代表用戶沒按按鈕（等 cron 接 or 流失）。
      </p>
      {buttonStatsStartedAt && (
        <p style={{ fontSize: 12, color: '#b45309', marginTop: 4 }}>
          Q4 末尾與中間層 Flex 按鈕統計從 {buttonStatsStartedAt} 起算；上線前已收到 Q4 的用戶不納入這兩段分母。
        </p>
      )}
    </div>
  );
}

// ============================================================
// 下半部：篩選 + 名單摘要
// ============================================================

function FilterPanel({ filter, setFilter, onApply, loading }) {
  const togglePath = (p) => {
    setFilter((f) => ({
      ...f,
      paths: f.paths.includes(p) ? f.paths.filter((x) => x !== p) : [...f.paths, p],
    }));
  };
  const toggleMetabolism = (m) => {
    setFilter((f) => ({
      ...f,
      metabolismTypes: f.metabolismTypes.includes(m) ? f.metabolismTypes.filter((x) => x !== m) : [...f.metabolismTypes, m],
    }));
  };

  return (
    <div style={styles.analyticsCard}>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 12, alignItems: 'center' }}>
        <div style={{ fontSize: 13, color: '#666' }}>Path（多選）：</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ANALYTICS_PATHS.map((p) => (
            <button
              key={p}
              onClick={() => togglePath(p)}
              style={filter.paths.includes(p) ? styles.analyticsChipActive : styles.analyticsChip}
            >
              {ANALYTICS_PATH_LABELS[p]}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 13, color: '#666' }}>代謝類型（多選）：</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ANALYTICS_METABOLISM.map((m) => (
            <button
              key={m}
              onClick={() => toggleMetabolism(m)}
              style={filter.metabolismTypes.includes(m) ? styles.analyticsChipActive : styles.analyticsChip}
            >
              {ANALYTICS_METABOLISM_LABELS[m]}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 13, color: '#666' }}>停留天數：</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { v: 0, l: '不限' },
            { v: 3, l: '≥ 3 天' },
            { v: 7, l: '≥ 7 天' },
            { v: 14, l: '≥ 14 天' },
          ].map((opt) => (
            <button
              key={opt.v}
              onClick={() => setFilter((f) => ({ ...f, daysStuck: opt.v }))}
              style={filter.daysStuck === opt.v ? styles.analyticsChipActive : styles.analyticsChip}
            >
              {opt.l}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 13, color: '#666' }}>是否已報名：</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { v: 'all', l: '全部' },
            { v: 'false', l: '未報名' },
            { v: 'true', l: '已報名' },
          ].map((opt) => (
            <button
              key={opt.v}
              onClick={() => setFilter((f) => ({ ...f, enrolled: opt.v }))}
              style={filter.enrolled === opt.v ? styles.analyticsChipActive : styles.analyticsChip}
            >
              {opt.l}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={onApply} disabled={loading} style={styles.btnPrimary}>
          {loading ? '載入中…' : '套用篩選'}
        </button>
        <button
          onClick={() => setFilter({ paths: [], metabolismTypes: [], daysStuck: 0, enrolled: 'false' })}
          style={styles.btnGhost}
        >
          清除條件
        </button>
      </div>
    </div>
  );
}

function UsersSummary({ users, expandedStages, onToggleStage }) {
  const total = users.total;
  // 找卡最多的那一段（排除已付款）
  let maxStage = null;
  let maxCount = 0;
  ANALYTICS_STAGE_KEYS.forEach((k) => {
    if (k === 'paid') return;
    if ((users.by_stage[k]?.count || 0) > maxCount) {
      maxCount = users.by_stage[k].count;
      maxStage = k;
    }
  });

  const allUsers = ANALYTICS_STAGE_KEYS.flatMap((k) => users.by_stage[k]?.users || []);

  const copyUserIds = () => {
    const ids = allUsers.map((u) => u.line_user_id).join(',');
    navigator.clipboard.writeText(ids);
    alert(`已複製 ${allUsers.length} 個 userId`);
  };

  const downloadCsv = () => {
    const header = ['line_user_id', 'display_name', 'metabolism_type', 'path', '卡在', '最後互動', '加入時間'].join(',');
    const rows = [];
    ANALYTICS_STAGE_KEYS.forEach((k) => {
      (users.by_stage[k]?.users || []).forEach((u) => {
        rows.push([
          u.line_user_id,
          `"${(u.display_name || '').replace(/"/g, '""')}"`,
          u.metabolism_type || '',
          u.path || '',
          ANALYTICS_STAGE_LABELS[k],
          u.last_interaction_at || '',
          u.joined_at || '',
        ].join(','));
      });
    });
    const csv = '﻿' + header + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `funnel_users_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={styles.analyticsCard}>
        <div style={{ fontSize: 15, marginBottom: 12 }}>
          總計 <strong>{total}</strong> 人
          {total > 0 && (
            <span style={{ float: 'right', display: 'flex', gap: 8 }}>
              <button onClick={copyUserIds} style={styles.analyticsActionBtn}>📋 複製 userId</button>
              <button onClick={downloadCsv} style={styles.analyticsActionBtn}>📥 下載 CSV</button>
            </span>
          )}
        </div>

        <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>📍 卡在哪段：</div>

        {ANALYTICS_STAGE_KEYS.map((k) => {
          const bucket = users.by_stage[k] || { count: 0, users: [] };
          const isMax = k === maxStage && bucket.count > 0;
          const isExpanded = expandedStages[k];
          return (
            <div key={k} style={{ ...styles.analyticsStageRow, ...(isMax ? { background: '#fef3c7' } : {}) }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>
                  {isMax && '★ '}
                  {ANALYTICS_STAGE_LABELS[k]}
                </span>
                <span>
                  <strong style={{ marginRight: 12 }}>{bucket.count} 人</strong>
                  {bucket.count > 0 ? (
                    <button onClick={() => onToggleStage(k)} style={styles.analyticsExpandBtn}>
                      {isExpanded ? '▲ 收合' : '▼ 展開名單'}
                    </button>
                  ) : '—'}
                </span>
              </div>
              {isExpanded && bucket.count > 0 && (
                <div style={{ marginTop: 8, borderTop: '1px solid #e5e7eb', paddingTop: 8 }}>
                  <table style={styles.analyticsTable}>
                    <thead>
                      <tr>
                        <th style={styles.analyticsTh}>顯示名</th>
                        <th style={styles.analyticsTh}>代謝類型</th>
                        <th style={styles.analyticsTh}>Path</th>
                        <th style={styles.analyticsTh}>最後互動</th>
                        <th style={styles.analyticsTh}>userId</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bucket.users.map((u) => (
                        <tr key={u.line_user_id}>
                          <td style={styles.analyticsTd}>{u.display_name || '—'}</td>
                          <td style={styles.analyticsTd}>{ANALYTICS_METABOLISM_LABELS[u.metabolism_type] || '—'}</td>
                          <td style={styles.analyticsTd}>{ANALYTICS_PATH_LABELS[u.path] || '—'}</td>
                          <td style={styles.analyticsTd}>{daysAgo(u.last_interaction_at)}</td>
                          <td style={{ ...styles.analyticsTd, fontFamily: 'monospace', fontSize: 11, color: '#888' }}>
                            {u.line_user_id.slice(0, 10)}…
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// 樣式
// ============================================================
// ============================================================
// 受眾再行銷 Tab（本地原型）
// ============================================================

const AUDIENCE_PRESETS = [
  {
    id: 'dropoff',
    title: '互動下降',
    tone: '喚醒',
    desc: '曾經點過文章，但最近連續幾篇沒有點擊。',
    rules: ['曾點擊至少 2 篇', '最近連續 2 篇未點擊', '尚未報名'],
  },
  {
    id: 'warm',
    title: '暖受眾',
    tone: '教育',
    desc: '近期仍有點擊，但還沒有進入報名。',
    rules: ['近 14 天內有點擊', '尚未報名', '排除已付款'],
  },
  {
    id: 'apply_no_submit',
    title: '高意願未送單',
    tone: '解惑',
    desc: '點過報名頁，但沒有送出報名表。',
    rules: ['點過 /apply', '沒有送出表單', '排除已付款'],
  },
  {
    id: 'pending_payment',
    title: '送單未付款',
    tone: '提醒',
    desc: '已送出報名表，但尚未完成付款。',
    rules: ['已送單', '未付款', '排除已取消'],
  },
  {
    id: 'cold',
    title: '長期冷卻',
    tone: '低頻',
    desc: '收到多篇文章，但從來沒有點擊。',
    rules: ['收到至少 3 篇', '0 點擊', '加入超過 30 天'],
  },
];

const RETARGETING_TEMPLATES = [
  {
    id: 'dropoff_soft',
    title: '互動下降喚醒',
    category: '冷卻喚醒',
    image_url: `${BOT_BASE_URL}/images/landing/land002.png`,
    body: '前面你有看過一些內容，我猜你可能是看到某一段開始覺得「好像有點難」。\n\n如果你願意，我可以用比較生活化的方式，幫你整理一個比較好開始的方向。',
    buttons: [
      { label: '回來看下一篇', url: 'https://example.com/next-article' },
      { label: '看一個真實案例', url: 'https://example.com/story' },
      {
        label: '我想問問題',
        actionType: 'message',
        messageText: '我想問問題',
        replyText: '有什麼問題都可以留言，fifi 助教看到會回覆你。',
      },
    ],
  },
  {
    id: 'warm_story',
    title: '學員故事補強',
    category: '暖受眾教育',
    image_url: `${BOT_BASE_URL}/images/landing/land006.png`,
    body: '你前面看過幾篇內容，代表這件事可能跟你現在的狀態有點關係。\n\n我想補一個更像真實生活的案例給你，不是很完美的人，而是很忙、也卡過的人怎麼開始。',
    buttons: [
      { label: '看學員故事', url: 'https://example.com/story' },
      { label: '看健康文章', url: 'https://example.com/article' },
      { label: '了解陪跑方式', url: 'https://example.com/method' },
    ],
  },
  {
    id: 'apply_faq',
    title: '報名頁未送單 FAQ',
    category: '高意願解惑',
    image_url: `${BOT_BASE_URL}/images/landing/land014.png`,
    body: '你前面有點進報名頁，可能還有一些地方想確認。\n\n如果你是在想費用、時間、飲食或自己做不做得到，可以直接回我，我會請 fifi 幫你看比較適合怎麼安排。',
    buttons: [
      {
        label: '我想問問題',
        actionType: 'message',
        messageText: '我想問問題',
        replyText: '有什麼問題都可以留言，fifi 助教看到會回覆你。',
      },
      { label: '看常見問題', url: 'https://example.com/faq' },
      { label: '回到報名頁', url: 'https://example.com/apply' },
    ],
  },
  {
    id: 'payment_reminder',
    title: '送單未付款提醒',
    category: '付款提醒',
    image_url: `${BOT_BASE_URL}/images/landing/land015.webp`,
    body: '有看到你的報名資料了，這邊幫你保留名額中。\n\n如果你已經匯款，可以直接回傳後五碼；如果付款方式有不清楚，也可以直接回我。',
    buttons: [
      { label: '查看匯款資訊', url: 'https://example.com/payment' },
      { label: '我已完成匯款', url: 'https://example.com/paid' },
      {
        label: '我想問付款問題',
        actionType: 'message',
        messageText: '我想問付款問題',
        replyText: '付款或匯款問題都可以直接留言，fifi 助教看到會協助你確認。',
      },
    ],
  },
];

function normalizeRetargetingButton(button = {}) {
  const actionType = button.actionType || button.type || (button.replyText || button.messageText ? 'message' : 'url');
  return {
    label: button.label || '',
    actionType,
    url: button.url || '',
    messageText: button.messageText || button.text || button.label || '',
    replyText: button.replyText || '',
  };
}

function isUsableRetargetingButton(button = {}) {
  if (!button.label?.trim()) return false;
  if (button.actionType === 'message') return !!String(button.replyText || '').trim();
  return !!button.url?.trim();
}

function hasRetargetingButtonDraftContent(button = {}) {
  return !!String(button.label || button.url || button.replyText || button.messageText || '').trim();
}

function createRetargetingDraft(template) {
  const buttons = [...(template.buttons || [])];
  while (buttons.length < 3) buttons.push({ label: '', url: '' });
  return {
    image_url: template.image_url || template.imageUrl || '',
    body: template.body || template.message || '',
    buttons: buttons.slice(0, 3).map(normalizeRetargetingButton),
  };
}

function createRetargetingLibraryId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function defaultRetargetingEnabledConditions(ruleId = 'dropoff') {
  const base = {
    receivedMin: false,
    clickedMin: false,
    inactiveSteps: false,
    recentDays: false,
    joinedDays: false,
    applyDelayDays: false,
    applyClicks: false,
    paymentDelayDays: false,
    customArticleType: false,
    excludeApplyClickers: false,
    customExcludeSubmitted: false,
    customExcludePaid: false,
  };
  if (ruleId === 'dropoff') return { ...base, receivedMin: true, clickedMin: true, inactiveSteps: true };
  if (ruleId === 'warm') return { ...base, clickedMin: true, recentDays: true, excludeApplyClickers: true, customArticleType: true };
  if (ruleId === 'apply_no_submit') return { ...base, applyClicks: true, applyDelayDays: true, customExcludeSubmitted: true, customExcludePaid: true };
  if (ruleId === 'pending_payment') return { ...base, paymentDelayDays: true };
  if (ruleId === 'cold') return { ...base, receivedMin: true, joinedDays: true, clickedMin: true };
  return { ...base, clickedMin: true, customExcludeSubmitted: true, customExcludePaid: true, customArticleType: true };
}

function retargetingAudienceFromPreset(preset) {
  const enabledConditions = defaultRetargetingEnabledConditions(preset.id);
  return {
    id: preset.id,
    title: preset.title,
    ruleId: preset.id,
    rules: preset.rules || [],
    active: true,
    builtIn: true,
    audienceConditions: {
      presetId: preset.id,
      ruleTitle: preset.title,
      clickedMin: 2,
      inactiveSteps: 2,
      recentDays: 14,
      applyDelayDays: 3,
      applyClicks: 1,
      paymentDelayDays: 2,
      receivedMin: 3,
      joinedDays: 30,
      storyOnly: false,
      excludeApplyClickers: true,
      customAudienceLogic: 'all',
      customArticleType: 'any',
      customMinimumClicks: 1,
      customExcludeSubmitted: true,
      customExcludePaid: true,
      enabledConditions,
    },
  };
}

function retargetingTemplateFromBuiltIn(template) {
  return {
    ...template,
    active: true,
    builtIn: true,
    buttons: (template.buttons || []).map(normalizeRetargetingButton),
  };
}

function defaultRetargetingCycleFlows() {
  const first = RETARGETING_TEMPLATES[0]?.id || '';
  const second = RETARGETING_TEMPLATES[1]?.id || first;
  const third = RETARGETING_TEMPLATES[2]?.id || second;
  return [1, 2, 3].map((cycle) => ({
    cycle,
    enabled: cycle === 1,
    stage1TemplateId: cycle === 1 ? first : second,
    stage1ObserveDays: 3,
    stage2Enabled: false,
    stage2TemplateId: cycle === 1 ? second : first,
    stage2ObserveDays: 3,
    stage3Enabled: false,
    stage3TemplateId: third,
    stage3ObserveDays: 3,
    finalAction: 'cooldown',
  }));
}

function cycleFlowFromConfig(config = {}) {
  const fallbackObserveDays = Math.max(1, Number(config.observeDays || 3));
  const rawFlows = Array.isArray(config.cycleFlows) ? config.cycleFlows : [];
  if (rawFlows.length > 0) {
    const legacy = defaultRetargetingCycleFlows();
    return [1, 2, 3].map((cycle) => {
      const flow = rawFlows.find((item) => Number(item?.cycle) === cycle) || {};
      const stages = Array.isArray(flow.stages) ? flow.stages : [];
      const stage = (stageNumber) => stages.find((item) => Number(item?.stage) === stageNumber) || {};
      return {
        ...legacy[cycle - 1],
        cycle,
        enabled: cycle === 1 ? flow.enabled !== false : !!flow.enabled,
        stage1TemplateId: stage(1).templateId || legacy[cycle - 1].stage1TemplateId,
        stage1ObserveDays: Math.max(1, Number(stage(1).observeDays || fallbackObserveDays)),
        stage2Enabled: !!stage(2).enabled,
        stage2TemplateId: stage(2).templateId || legacy[cycle - 1].stage2TemplateId,
        stage2ObserveDays: Math.max(1, Number(stage(2).observeDays || fallbackObserveDays)),
        stage3Enabled: !!stage(3).enabled,
        stage3TemplateId: stage(3).templateId || legacy[cycle - 1].stage3TemplateId,
        stage3ObserveDays: Math.max(1, Number(stage(3).observeDays || fallbackObserveDays)),
        finalAction: flow.finalAction || legacy[cycle - 1].finalAction,
      };
    });
  }
  const legacy = defaultRetargetingCycleFlows();
  return legacy.map((flow, index) => ({
    ...flow,
    stage1TemplateId: config.stageTemplates?.[index === 0 ? 0 : 1]?.templateId || flow.stage1TemplateId,
    stage1ObserveDays: fallbackObserveDays,
    stage2Enabled: index === 0 ? config.stage2Enabled !== false && !!config.stageTemplates?.[1]?.templateId : false,
    stage2TemplateId: config.stageTemplates?.[1]?.templateId || flow.stage2TemplateId,
    stage2ObserveDays: fallbackObserveDays,
    stage3Enabled: index === 0 ? !!config.stage3Enabled && !!config.stageTemplates?.[2]?.templateId : false,
    stage3TemplateId: config.stageTemplates?.[2]?.templateId || flow.stage3TemplateId,
    stage3ObserveDays: fallbackObserveDays,
    finalAction: config.thirdStageAction || flow.finalAction,
  }));
}

function buildRetargetingAudienceRuleLabels(audience = {}) {
  const conditions = audience.audienceConditions || {};
  const ruleId = audience.ruleId || conditions.presetId || 'custom';
  const enabled = {
    ...defaultRetargetingEnabledConditions(ruleId),
    ...(conditions.enabledConditions || {}),
  };
  if (ruleId === 'dropoff') {
    return [
      enabled.receivedMin && `已收到至少 ${conditions.receivedMin ?? 3} 篇排程文章`,
      enabled.clickedMin && `至少點擊 ${conditions.clickedMin ?? 2} 篇`,
      enabled.inactiveSteps && `最近連續 ${conditions.inactiveSteps ?? 2} 篇沒有點擊`,
    ].filter(Boolean);
  }
  if (ruleId === 'warm') {
    return [
      enabled.recentDays && `最近 ${conditions.recentDays ?? 14} 天有互動`,
      enabled.clickedMin && `至少點擊 ${conditions.clickedMin ?? 1} 篇`,
      enabled.customArticleType
        ? (conditions.customArticleType && conditions.customArticleType !== 'any'
          ? `限定文章類型：${DRIP_ARTICLE_TYPE_LABELS[conditions.customArticleType] || conditions.customArticleType}`
          : '不限文章類型')
        : null,
      enabled.excludeApplyClickers && '排除已點報名頁',
    ].filter(Boolean);
  }
  if (ruleId === 'apply_no_submit') {
    return [
      enabled.applyClicks && `至少點報名頁 ${conditions.applyClicks ?? 1} 次`,
      enabled.applyDelayDays && `點報名頁後等待 ${conditions.applyDelayDays ?? 3} 天`,
      enabled.customExcludeSubmitted && '尚未送出報名',
      enabled.customExcludePaid && '尚未付款',
    ].filter(Boolean);
  }
  if (ruleId === 'pending_payment') {
    return [enabled.paymentDelayDays && `送出報名後等待 ${conditions.paymentDelayDays ?? 2} 天`, '尚未付款'].filter(Boolean);
  }
  if (ruleId === 'cold') {
    return [
      enabled.receivedMin && `已收到至少 ${conditions.receivedMin ?? 3} 篇排程文章`,
      enabled.joinedDays && `加入至少 ${conditions.joinedDays ?? 30} 天`,
      enabled.clickedMin && '排程文章點擊為 0',
    ].filter(Boolean);
  }
  return [
    enabled.customArticleType && `限定文章類型：${DRIP_ARTICLE_TYPE_LABELS[conditions.customArticleType] || '不限類型'}`,
    enabled.clickedMin && `至少點擊 ${conditions.clickedMin ?? conditions.customMinimumClicks ?? 1} 篇`,
    enabled.customExcludeSubmitted && (conditions.customExcludeSubmitted === false ? '可包含已送單' : '排除已送單'),
    enabled.customExcludePaid && (conditions.customExcludePaid === false ? '可包含已付款' : '排除已付款'),
  ].filter(Boolean);
}

function RetargetingNumberField({ label, value, onChange, min = 0 }) {
  return (
    <label style={styles.fieldLabel}>
      {label}
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value || min)))}
        style={{ ...styles.input, marginTop: 4 }}
      />
    </label>
  );
}

function RetargetingConditionNumberField({ label, conditionKey, value, onChange, enabled, onToggle, min = 0 }) {
  return (
    <div style={{ ...styles.retargetingConditionBox, opacity: enabled ? 1 : 0.62 }}>
      <label style={styles.retargetingConditionToggle}>
        <input type="checkbox" checked={!!enabled} onChange={(e) => onToggle(conditionKey, e.target.checked)} />
        <span>{label}</span>
      </label>
      <input
        type="number"
        min={min}
        disabled={!enabled}
        value={value}
        onChange={(e) => onChange(conditionKey, Math.max(min, Number(e.target.value || min)))}
        style={{ ...styles.input, marginBottom: 0 }}
      />
    </div>
  );
}

function RetargetingConditionSwitch({ label, conditionKey, enabled, onToggle, checked, onCheckedChange }) {
  return (
    <div style={{ ...styles.retargetingConditionBox, opacity: enabled ? 1 : 0.62 }}>
      <label style={styles.retargetingConditionToggle}>
        <input type="checkbox" checked={!!enabled} onChange={(e) => onToggle(conditionKey, e.target.checked)} />
        <span>{label}</span>
      </label>
      <label style={{ ...styles.retargetingSwitchRow, marginBottom: 0, background: '#fff', borderColor: '#e5e7eb' }}>
        <input type="checkbox" disabled={!enabled} checked={!!checked} onChange={(e) => onCheckedChange(conditionKey, e.target.checked)} />
        <span><strong>{checked ? '已套用' : '未套用'}</strong><small>勾選左側條件後才會進入實際判斷。</small></span>
      </label>
    </div>
  );
}

function getRetargetingConditionEnabled(audience, key) {
  const ruleId = audience?.ruleId || audience?.audienceConditions?.presetId || 'dropoff';
  const defaults = defaultRetargetingEnabledConditions(ruleId);
  const enabled = audience?.audienceConditions?.enabledConditions || {};
  return enabled[key] ?? defaults[key] ?? false;
}

function hasRetargetingTestMarker(value) {
  return /測試|test/i.test(String(value || ''));
}

function getRetargetingTemplateWarnings(template, label) {
  const warnings = [];
  const imageUrl = normalizeAdminPublicUrl(template?.image_url || template?.imageUrl || '');
  if (imageUrl && !/^https:\/\//i.test(imageUrl)) warnings.push(`${label}圖片不是公開 HTTPS 網址`);
  if (hasRetargetingTestMarker(template?.title) || hasRetargetingTestMarker(template?.category) || hasRetargetingTestMarker(template?.body)) {
    warnings.push(`${label}仍含測試字樣`);
  }
  for (const button of (template?.buttons || []).filter((btn) => btn?.label || btn?.url || btn?.replyText || btn?.messageText)) {
    if (hasRetargetingTestMarker(button.label) || hasRetargetingTestMarker(button.replyText) || hasRetargetingTestMarker(button.messageText)) {
      warnings.push(`${label}按鈕仍含測試字樣`);
    }
    if ((button.actionType || 'url') === 'message') {
      if (!String(button.replyText || '').trim()) warnings.push(`${label}文字回覆按鈕缺少 BOT 回覆文字`);
      continue;
    }
    if (!button.url || button.url.includes('example.com') || !/^https:\/\//i.test(button.url)) {
      warnings.push(`${label}有未完成或非 HTTPS 的連結按鈕`);
    }
  }
  return warnings;
}

function formatRetargetingTime(value) {
  if (!value) return '尚無';
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function getRetargetingSkipNotice(state) {
  if (!state?.lastSkipReason) return null;
  const reason = state.lastSkipReason;
  const timeText = formatRetargetingTime(state.lastSkipAt);
  const windowText = state.lastWindowKey ? `；判斷窗口：${state.lastWindowKey}` : '';
  const nextCheckText = state.nextCheckAfter ? `，預計 ${formatRetargetingTime(state.nextCheckAfter)} 後再判斷` : '';
  const nextSendText = state.nextScheduledAt ? `，預計 ${formatRetargetingTime(state.nextScheduledAt)} 發送` : '';
  const observingText = state.observingUntil ? `，觀察到 ${formatRetargetingTime(state.observingUntil)}` : '';
  const labels = {
    waiting_check_delay: `等待互動檢查中${nextCheckText}`,
    pending_scheduled_send: `已排程待發送${nextSendText}`,
    scheduled_for_later: `符合條件，等待排程發送${nextSendText}`,
    observing_after_retargeting: `再行銷已發送，正在觀察回應${observingText}`,
    window_completed: '此互動窗口已完成處理',
    already_observed_window: '此互動窗口已留下觀察紀錄',
    already_sent_once: '此活動設定為只發一次，已發送過',
    repeat_cooldown: '此會員已進入冷卻，不重複發送',
    no_more_stage: '本輪已沒有下一階段可追發',
    cycle_disabled: '下一輪符合流程未啟用',
    user_stopped: '此會員已停止追蹤',
  };
  return `${labels[reason] || reason}${windowText}；最近檢查：${timeText}`;
}

function AudienceRetargetingPrototype() {
  const builtInAudiences = AUDIENCE_PRESETS.map(retargetingAudienceFromPreset);
  const builtInTemplates = RETARGETING_TEMPLATES.map(retargetingTemplateFromBuiltIn);
  const [dashboard, setDashboard] = useState(null);
  const [audienceLibrary, setAudienceLibrary] = useState([]);
  const [templateLibrary, setTemplateLibrary] = useState([]);
  const [audienceDraft, setAudienceDraft] = useState(() => retargetingAudienceFromPreset(AUDIENCE_PRESETS[0]));
  const [templateDraft, setTemplateDraft] = useState(() => retargetingTemplateFromBuiltIn(RETARGETING_TEMPLATES[0]));
  const [selectedAudienceId, setSelectedAudienceId] = useState(AUDIENCE_PRESETS[0].id);
  const [cycleFlows, setCycleFlows] = useState(() => defaultRetargetingCycleFlows());
  const [checkDelayDays, setCheckDelayDays] = useState(1);
  const [sendMode, setSendMode] = useState('scheduled');
  const [sendDelayDays, setSendDelayDays] = useState(0);
  const [sendAtTime, setSendAtTime] = useState('14:00');
  const [observeDays, setObserveDays] = useState(3);
  const [engagementCriteria, setEngagementCriteria] = useState('any_click_or_reply');
  const [repeatStrategy, setRepeatStrategy] = useState('staged');
  const [thirdStageAction, setThirdStageAction] = useState('cooldown');
  const [enabled, setEnabled] = useState(false);
  const [observeOnly, setObserveOnly] = useState(false);
  const [activityId, setActivityId] = useState(() => createRetargetingLibraryId('activity'));
  const [activityName, setActivityName] = useState('互動下降喚醒活動');
  const [activityPriority, setActivityPriority] = useState(1);
  const [editingActivityId, setEditingActivityId] = useState('new');
  const [creatingActivityDraft, setCreatingActivityDraft] = useState(false);
  const [activityDraftReturnId, setActivityDraftReturnId] = useState(null);
  const [activityAudienceSnapshot, setActivityAudienceSnapshot] = useState(null);
  const [activityTemplateSnapshots, setActivityTemplateSnapshots] = useState([]);
  const [audienceEditorOpen, setAudienceEditorOpen] = useState(false);
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [flowChecked, setFlowChecked] = useState(false);
  const [saving, setSaving] = useState('');
  const [notice, setNotice] = useState(null);

  const baseActiveAudiences = [
    ...builtInAudiences,
    ...audienceLibrary.filter((item) => item.active !== false),
  ];
  const activeAudiences = activityAudienceSnapshot
    && activityAudienceSnapshot.active !== false
    && !baseActiveAudiences.some((item) => item.id === activityAudienceSnapshot.id)
    ? [...baseActiveAudiences, activityAudienceSnapshot]
    : baseActiveAudiences;
  const baseActiveTemplates = [
    ...builtInTemplates,
    ...templateLibrary.filter((item) => item.active !== false),
  ];
  const activeTemplates = [
    ...baseActiveTemplates,
    ...activityTemplateSnapshots.filter((snapshot) => (
      snapshot?.active !== false
      && !baseActiveTemplates.some((item) => item.id === snapshot.id)
    )),
  ];
  const audienceOptions = activeAudiences.some((item) => item.id === audienceDraft.id)
    ? activeAudiences
    : [audienceDraft, ...activeAudiences];
  const templateOptions = activeTemplates.some((item) => item.id === templateDraft.id)
    ? activeTemplates
    : [templateDraft, ...activeTemplates];
  const selectedAudience = (
    activityAudienceSnapshot?.id === selectedAudienceId
      ? activityAudienceSnapshot
      : activeAudiences.find((item) => item.id === selectedAudienceId)
  ) || audienceDraft;
  const findTemplateById = (id, fallbackIndex = 0) => (
    activityTemplateSnapshots.find((item) => item?.active !== false && item.id === id)
    || activeTemplates.find((item) => item.id === id)
    || (templateDraft.id === id ? templateDraft : null)
    || activeTemplates[fallbackIndex]
    || retargetingTemplateFromBuiltIn(RETARGETING_TEMPLATES[0])
  );
  const activityLocked = !!dashboard?.config && !editingActivityId;

  const loadConfigToForm = useCallback((config, libraries = {}) => {
    if (!config) return;
    const audienceOptions = [
      ...AUDIENCE_PRESETS.map(retargetingAudienceFromPreset),
      ...(libraries.audiences || []),
    ];
    const templateOptions = [
      ...RETARGETING_TEMPLATES.map(retargetingTemplateFromBuiltIn),
      ...(libraries.templates || []),
    ];
    const audience = audienceOptions.find((item) => item.id === config.audienceId)
      || {
        id: config.audienceId || config.ruleId,
        title: config.ruleTitle,
        ruleId: config.ruleId,
        rules: config.audienceRules || [],
        audienceConditions: config.audienceConditions || {},
        active: true,
      };
    const embeddedTemplates = [];
    const addEmbeddedTemplate = (stage) => {
      if (!stage?.templateId) return;
      const existsInSnapshot = embeddedTemplates.some((item) => item.id === stage.templateId);
      if (existsInSnapshot) return;
      embeddedTemplates.push({
        id: stage.templateId,
        title: stage.title || '已套用模板',
        category: stage.category || '自動再行銷',
        image_url: stage.imageUrl || '',
        body: stage.message || stage.body || '',
        buttons: (stage.buttons || []).map(normalizeRetargetingButton),
        active: true,
      });
    };
    (config.stageTemplates || []).forEach(addEmbeddedTemplate);
    (config.cycleFlows || []).forEach((flow) => (flow.stages || []).forEach(addEmbeddedTemplate));

    setActivityId(config.activityId || createRetargetingLibraryId('activity'));
    setActivityName(config.activityName || config.ruleTitle || '自動再行銷活動');
    setActivityPriority(Math.max(1, Number(config.priority || 1)));
    setSelectedAudienceId(config.audienceId || audience.id || config.ruleId || 'dropoff');
    const audienceRuleId = audience.ruleId || config.ruleId || 'dropoff';
    setActivityAudienceSnapshot({
      ...audience,
      ruleId: audienceRuleId,
      audienceConditions: {
        ...retargetingAudienceFromPreset(AUDIENCE_PRESETS.find((preset) => preset.id === audienceRuleId) || AUDIENCE_PRESETS[0]).audienceConditions,
        ...(config.audienceConditions || audience.audienceConditions),
      },
    });
    setActivityTemplateSnapshots(embeddedTemplates);
    setCycleFlows(cycleFlowFromConfig(config));
    setCheckDelayDays(Number(config.checkDelayDays || 0));
    setSendMode(config.sendMode === 'instant' ? 'instant' : 'scheduled');
    setSendDelayDays(Number(config.sendDelayDays || 0));
    setSendAtTime(config.sendAtTime || '14:00');
    setObserveDays(Number(config.observeDays || 1));
    setEngagementCriteria(config.engagementCriteria || 'any_click_or_reply');
    setRepeatStrategy(config.repeatStrategy || 'staged');
    setThirdStageAction(config.thirdStageAction || 'cooldown');
    setEnabled(!!config.enabled);
    setObserveOnly(!!config.observeOnly);
  }, []);

  const loadDashboard = useCallback(async () => {
    const result = await fetch(apiUrl('retargeting_dashboard')).then((response) => response.json());
    if (result.error) {
      setNotice({ error: result.error });
      return;
    }
    const audiences = Array.isArray(result.audienceLibrary) ? result.audienceLibrary : [];
    const templates = Array.isArray(result.templateLibrary) ? result.templateLibrary : [];
    setDashboard(result);
    setAudienceLibrary(audiences);
    setTemplateLibrary(templates);
    if (result.config) {
      loadConfigToForm(result.config, { audiences, templates });
      setEditingActivityId(null);
      setCreatingActivityDraft(false);
      setActivityDraftReturnId(null);
    }
  }, [loadConfigToForm]);

  useEffect(() => {
    loadDashboard().catch((error) => setNotice({ error: error.message }));
  }, [loadDashboard]);

  const updateAudienceCondition = (key, value) => {
    setAudienceDraft((draft) => ({
      ...draft,
      audienceConditions: { ...(draft.audienceConditions || {}), [key]: value },
    }));
    setFlowChecked(false);
  };

  const toggleAudienceCondition = (key, checked) => {
    setAudienceDraft((draft) => {
      const ruleId = draft.ruleId || draft.audienceConditions?.presetId || 'dropoff';
      const defaults = defaultRetargetingEnabledConditions(ruleId);
      return {
        ...draft,
        audienceConditions: {
          ...(draft.audienceConditions || {}),
          enabledConditions: {
            ...defaults,
            ...(draft.audienceConditions?.enabledConditions || {}),
            [key]: checked,
          },
        },
      };
    });
    setFlowChecked(false);
  };

  const setAudienceRuleId = (ruleId) => {
    setAudienceDraft((draft) => ({
      ...draft,
      ruleId,
      audienceConditions: {
        ...(draft.audienceConditions || {}),
        presetId: ruleId,
        ruleTitle: draft.title || (AUDIENCE_PRESETS.find((preset) => preset.id === ruleId)?.title || '自訂受眾'),
        enabledConditions: defaultRetargetingEnabledConditions(ruleId),
      },
    }));
    setFlowChecked(false);
  };

  const selectAudience = (id) => {
    const audience = activeAudiences.find((item) => item.id === id);
    if (!audience) return;
    const ruleId = audience.ruleId || audience.audienceConditions?.presetId || 'dropoff';
    setAudienceDraft({
      ...audience,
      ruleId,
      audienceConditions: {
        ...retargetingAudienceFromPreset(AUDIENCE_PRESETS.find((preset) => preset.id === ruleId) || AUDIENCE_PRESETS[0]).audienceConditions,
        ...(audience.audienceConditions || {}),
      },
    });
    setAudienceEditorOpen(false);
    setFlowChecked(false);
  };

  const selectTemplate = (id) => {
    const template = activeTemplates.find((item) => item.id === id);
    if (!template) return;
    const draft = createRetargetingDraft(template);
    setTemplateDraft({
      ...template,
      image_url: draft.image_url,
      body: draft.body,
      buttons: draft.buttons,
    });
    setTemplateEditorOpen(false);
    setFlowChecked(false);
  };

  const updateTemplateButton = (index, field, value) => {
    setTemplateDraft((draft) => {
      const buttons = createRetargetingDraft(draft).buttons;
      buttons[index] = { ...buttons[index], [field]: value };
      if (field === 'label' && buttons[index].actionType === 'message') buttons[index].messageText = value;
      if (field === 'actionType' && value === 'message') buttons[index].messageText = buttons[index].label || '';
      return { ...draft, buttons };
    });
    setFlowChecked(false);
  };

  const updateCycleFlow = (cycle, updates) => {
    setCycleFlows((flows) => flows.map((flow) => (
      Number(flow.cycle) === Number(cycle)
        ? { ...flow, ...updates, cycle }
        : flow
    )));
    setFlowChecked(false);
  };

  const saveLibrary = async (libraryType, items, successText) => {
    setSaving(libraryType);
    setNotice(null);
    const result = await apiPost({ action: 'save_retargeting_library', libraryType, items });
    setSaving('');
    if (result.error) {
      setNotice({ error: result.error });
      return null;
    }
    if (libraryType === 'audience') setAudienceLibrary(result.items || []);
    if (libraryType === 'template') setTemplateLibrary(result.items || []);
    setNotice({ ok: successText });
    return result.items || [];
  };

  const applyAudienceDraft = (audience) => {
    if (!audience) return;
    const ruleId = audience.ruleId || audience.audienceConditions?.presetId || 'dropoff';
    setAudienceDraft({
      ...audience,
      ruleId,
      audienceConditions: {
        ...retargetingAudienceFromPreset(AUDIENCE_PRESETS.find((preset) => preset.id === ruleId) || AUDIENCE_PRESETS[0]).audienceConditions,
        ...(audience.audienceConditions || {}),
      },
    });
    setSelectedAudienceId(audience.id);
  };

  const applyTemplateDraft = (template) => {
    if (!template) return;
    const draft = createRetargetingDraft(template);
    setTemplateDraft({
      ...template,
      image_url: draft.image_url,
      body: draft.body,
      buttons: draft.buttons,
    });
  };

  const saveAudience = async () => {
    const now = new Date().toISOString();
    const isBuiltIn = !!audienceDraft.builtIn;
    const id = isBuiltIn ? createRetargetingLibraryId('audience') : audienceDraft.id;
    const item = {
      ...audienceDraft,
      id,
      builtIn: undefined,
      rules: buildRetargetingAudienceRuleLabels(audienceDraft),
      active: true,
      createdAt: audienceDraft.createdAt || now,
      updatedAt: now,
    };
    const items = [...audienceLibrary.filter((row) => row.id !== id), item];
    const saved = await saveLibrary('audience', items, '受眾已獨立保存');
    if (saved) {
      setAudienceDraft(saved.find((row) => row.id === id) || item);
      setSelectedAudienceId(id);
      setAudienceEditorOpen(false);
    }
  };

  const saveTemplate = async () => {
    const now = new Date().toISOString();
    const isBuiltIn = !!templateDraft.builtIn;
    const id = isBuiltIn ? createRetargetingLibraryId('template') : templateDraft.id;
    const draft = createRetargetingDraft(templateDraft);
    const item = {
      ...templateDraft,
      id,
      builtIn: undefined,
      active: true,
      image_url: normalizeAdminPublicUrl(draft.image_url || ''),
      body: draft.body,
      buttons: draft.buttons.filter(hasRetargetingButtonDraftContent),
      createdAt: templateDraft.createdAt || now,
      updatedAt: now,
    };
    const items = [...templateLibrary.filter((row) => row.id !== id), item];
    const saved = await saveLibrary('template', items, '模板已獨立保存，切換後內容不會消失');
    if (saved) {
      setTemplateDraft(saved.find((row) => row.id === id) || item);
      setTemplateEditorOpen(false);
    }
  };

  const activityUsesTemplate = (activity, templateId) => {
    if (!activity || !templateId) return false;
    const repeat = activity.repeatStrategy || 'staged';
    const flows = Array.isArray(activity.cycleFlows) && activity.cycleFlows.length
      ? activity.cycleFlows
      : [{
          cycle: 1,
          enabled: true,
          stages: Array.isArray(activity.stageTemplates) ? activity.stageTemplates : [],
        }];
    return flows.some((flow) => {
      const cycle = Number(flow?.cycle || 1);
      if (repeat !== 'staged' && cycle !== 1) return false;
      if (cycle !== 1 && flow?.enabled === false) return false;
      const stages = Array.isArray(flow?.stages) && flow.stages.length
        ? flow.stages
        : [1, 2, 3].map((stage) => ({
            stage,
            templateId: flow?.[`stage${stage}TemplateId`],
            enabled: stage === 1 ? true : !!flow?.[`stage${stage}Enabled`],
          }));
      return stages.some((stage) => {
        const stageNumber = Number(stage?.stage || 1);
        if (repeat !== 'staged' && stageNumber !== 1) return false;
        if (stageNumber !== 1 && stage?.enabled === false) return false;
        return String(stage?.templateId || stage?.id || '') === String(templateId);
      });
    });
  };

  const currentTemplateReferences = (templateId) => {
    if (!templateId) return [];
    return cycleFlows.flatMap((flow) => {
      const cycle = Number(flow.cycle || 1);
      if (repeatStrategy !== 'staged' && cycle !== 1) return [];
      if (cycle !== 1 && flow.enabled === false) return [];
      const stages = [
        { stage: 1, templateId: flow.stage1TemplateId, enabled: true },
        { stage: 2, templateId: flow.stage2TemplateId, enabled: repeatStrategy === 'staged' && !!flow.stage2Enabled },
        { stage: 3, templateId: flow.stage3TemplateId, enabled: repeatStrategy === 'staged' && !!flow.stage3Enabled },
      ];
      return stages
        .filter((stage) => stage.enabled && String(stage.templateId || '') === String(templateId))
        .map((stage) => `第 ${cycle} 次符合 / 第 ${stage.stage} 階段`);
    });
  };

  const getLibraryReferenceNotice = (libraryType, id, actionLabel) => {
    if (libraryType === 'audience') {
      if (String(selectedAudienceId || '') === String(id || '')) {
        return `此受眾正被目前編輯的活動使用，請先到第 3 區切換活動受眾或解除引用，再${actionLabel}。`;
      }
      const activeActivity = activityRows.find((activity) => (
        activity?.enabled && String(activity.audienceId || '') === String(id || '')
      ));
      if (activeActivity) {
        return `此受眾正被活動「${activeActivity.activityName || activeActivity.ruleTitle || '未命名活動'}」使用，請先載入該活動切換受眾或停用活動，再${actionLabel}。`;
      }
    }

    if (libraryType === 'template') {
      const references = currentTemplateReferences(id);
      if (references.length > 0) {
        return `此模板正被目前編輯的活動使用（${references.join('、')}），請先切換模板或解除引用，再${actionLabel}。`;
      }
      const activeActivity = activityRows.find((activity) => (
        activity?.enabled && activityUsesTemplate(activity, id)
      ));
      if (activeActivity) {
        return `此模板正被活動「${activeActivity.activityName || activeActivity.ruleTitle || '未命名活動'}」使用，請先載入該活動切換模板或停用活動，再${actionLabel}。`;
      }
    }

    return null;
  };

  const disableOrDeleteLibraryItem = async (libraryType, id, remove = false) => {
    const actionLabel = remove ? '刪除' : '停用';
    const referenceNotice = getLibraryReferenceNotice(libraryType, id, actionLabel);
    if (referenceNotice) {
      setNotice({ error: referenceNotice });
      if (typeof window !== 'undefined') window.alert(referenceNotice);
      return;
    }
    const source = libraryType === 'audience' ? audienceLibrary : templateLibrary;
    const items = remove
      ? source.filter((item) => item.id !== id)
      : source.map((item) => item.id === id ? { ...item, active: false } : item);
    const saved = await saveLibrary(libraryType, items, remove ? '已刪除' : '已停用');
    if (!saved) return;
    if (libraryType === 'audience') {
      const fallback = [...builtInAudiences, ...saved].find((item) => item.active !== false);
      applyAudienceDraft(fallback);
      setAudienceEditorOpen(false);
    }
    if (libraryType === 'template') {
      const fallback = [...builtInTemplates, ...saved].find((item) => item.active !== false);
      applyTemplateDraft(fallback);
      setTemplateEditorOpen(false);
    }
  };

  const newAudience = () => {
    setAudienceDraft({
      ...retargetingAudienceFromPreset(AUDIENCE_PRESETS[0]),
      id: createRetargetingLibraryId('audience'),
      title: '新受眾',
      ruleId: 'dropoff',
      builtIn: false,
    });
    setAudienceEditorOpen(true);
    setFlowChecked(false);
  };

  const newTemplate = () => {
    setTemplateDraft({
      id: createRetargetingLibraryId('template'),
      title: '新模板',
      category: '自訂',
      image_url: '',
      body: '',
      buttons: createRetargetingDraft({ buttons: [] }).buttons,
      active: true,
    });
    setTemplateEditorOpen(true);
    setFlowChecked(false);
  };

  const buildConfig = () => {
    const stageFromTemplate = (templateId, cycle, stage, enabled = true, stageObserveDays = observeDays) => {
      const template = findTemplateById(templateId, stage - 1);
      return {
        cycle,
        stage,
        enabled,
        observeDays: Math.max(1, Number(stageObserveDays || observeDays || 1)),
        templateId: template.id,
        title: template.title,
        category: template.category,
        message: template.body,
        imageUrl: normalizeAdminPublicUrl(template.image_url || ''),
        buttons: (template.buttons || []).filter(isUsableRetargetingButton).map(normalizeRetargetingButton),
      };
    };
    const normalizedCycleFlows = cycleFlows.map((flow) => ({
      cycle: flow.cycle,
      enabled: flow.cycle === 1 ? true : !!flow.enabled,
      finalAction: flow.finalAction || 'cooldown',
      stages: [
        stageFromTemplate(flow.stage1TemplateId, flow.cycle, 1, flow.cycle === 1 ? true : !!flow.enabled, flow.stage1ObserveDays),
        stageFromTemplate(flow.stage2TemplateId, flow.cycle, 2, !!flow.stage2Enabled, flow.stage2ObserveDays),
        stageFromTemplate(flow.stage3TemplateId, flow.cycle, 3, !!flow.stage3Enabled, flow.stage3ObserveDays),
      ],
    }));
    const firstCycleStages = normalizedCycleFlows[0]?.stages || [];

    return {
      activityId,
      activityName,
      priority: activityPriority,
      audienceId: selectedAudience.id,
      firstTemplateId: firstCycleStages[0]?.templateId || '',
      enabled,
      observeOnly,
      ruleId: selectedAudience.ruleId || selectedAudience.audienceConditions?.presetId || 'custom',
      ruleTitle: selectedAudience.title,
      audienceRules: buildRetargetingAudienceRuleLabels(selectedAudience),
      audienceConditions: {
        ...(selectedAudience.audienceConditions || {}),
        presetId: selectedAudience.ruleId || 'custom',
        ruleTitle: selectedAudience.title,
      },
      checkDelayDays,
      sendMode,
      sendDelayDays,
      sendAtTime,
      observeDays: firstCycleStages[0]?.observeDays || observeDays,
      engagementCriteria,
      repeatStrategy,
      stage2Enabled: !!normalizedCycleFlows[0]?.stages?.[1]?.enabled,
      stage3Enabled: !!normalizedCycleFlows[0]?.stages?.[2]?.enabled,
      thirdStageAction: normalizedCycleFlows[0]?.finalAction || thirdStageAction,
      stageTemplates: firstCycleStages,
      cycleFlows: normalizedCycleFlows,
    };
  };

  const applyConfig = async () => {
    setSaving('config');
    setNotice(null);
    const result = await apiPost({ action: 'save_retargeting_admin_config', config: buildConfig() });
    setSaving('');
    if (result.error) {
      setNotice({ error: result.error });
      return;
    }
    setNotice({ ok: result.config.enabled ? '設定已正式保存，等待下一次 cron 自動檢查' : '設定已保存但目前停用' });
    setEditingActivityId(null);
    setCreatingActivityDraft(false);
    setActivityDraftReturnId(null);
    await loadDashboard();
  };

  const disableActivityById = async (targetActivity) => {
    const targetId = targetActivity?.activityId || targetActivity?.id;
    if (!targetId) return;
    setSaving(`disable-${targetId}`);
    setNotice(null);
    const result = await apiPost({ action: 'disable_retargeting_activity', activityId: targetId });
    setSaving('');
    if (result.error) {
      setNotice({ error: result.error });
      return;
    }
    setNotice({ ok: '活動已停用，既有紀錄仍會保留。' });
    await loadDashboard();
  };

  const deleteActivityById = async (targetActivity) => {
    const targetId = targetActivity?.activityId || targetActivity?.id;
    if (!targetId) return;
    if (!window.confirm('確定刪除這個活動設定？既有發送紀錄仍會保留。')) return;
    setSaving(`delete-${targetId}`);
    setNotice(null);
    const result = await apiPost({ action: 'delete_retargeting_activity', activityId: targetId });
    setSaving('');
    if (result.error) {
      setNotice({ error: result.error });
      return;
    }
    setNotice({ ok: '活動設定已刪除，既有紀錄仍會保留。' });
    await loadDashboard();
  };

  const duplicateActivity = (targetActivity) => {
    loadConfigToForm(targetActivity, { audiences: audienceLibrary, templates: templateLibrary });
    setActivityDraftReturnId(targetActivity.activityId || targetActivity.id || targetActivity.ruleId || null);
    setActivityId(createRetargetingLibraryId('activity'));
    setActivityName(`${targetActivity.activityName || targetActivity.ruleTitle || '自動再行銷活動'} 副本`);
    setActivityPriority(Math.max(1, Number(targetActivity.priority || activityRows.length + 1)));
    setEditingActivityId('new');
    setCreatingActivityDraft(true);
    setEnabled(false);
    setFlowChecked(false);
    setNotice({ ok: '已複製成新活動草稿；正式保存後會依優先順序加入自動檢查。' });
  };

  const startNewActivity = () => {
    const firstAudience = activeAudiences[0] || retargetingAudienceFromPreset(AUDIENCE_PRESETS[0]);
    const returnActivityId = editingActivityId && editingActivityId !== 'new'
      ? editingActivityId
      : (config?.activityId || config?.id || activityRows[0]?.activityId || activityRows[0]?.id || activityRows[0]?.ruleId || null);
    setActivityDraftReturnId(returnActivityId);
    setActivityId(createRetargetingLibraryId('activity'));
    setActivityName('新再行銷活動');
    setActivityPriority((activityRows?.length || 0) + 1);
    setActivityAudienceSnapshot(null);
    setActivityTemplateSnapshots([]);
    setSelectedAudienceId(firstAudience.id);
    setCycleFlows(defaultRetargetingCycleFlows());
    setCheckDelayDays(1);
    setSendMode('scheduled');
    setSendDelayDays(0);
    setSendAtTime('14:00');
    setObserveDays(3);
    setEngagementCriteria('any_click_or_reply');
    setRepeatStrategy('staged');
    setThirdStageAction('cooldown');
    setEnabled(false);
    setObserveOnly(false);
    setEditingActivityId('new');
    setCreatingActivityDraft(true);
    setFlowChecked(false);
    setNotice({ ok: '已建立新的再行銷活動草稿；保存前不會影響已啟用活動。' });
  };

  const config = dashboard?.config;
  const activityContext = dashboard?.testMode ? 'admin' : 'member';
  const activityLibrary = Array.isArray(dashboard?.activityLibrary) ? dashboard.activityLibrary : [];
  const activityOutcomes = dashboard?.activityOutcomes || {};
  const activityStates = dashboard?.testMode
    ? (dashboard?.adminActivityStates || {})
    : (dashboard?.memberActivityStates || {});
  const activityRows = activityLibrary.length
    ? activityLibrary
    : (config ? [{ ...config, id: config.activityId, activityId: config.activityId, isCurrentConfig: true }] : []);
  const cancelActivityEdit = () => {
    const targetActivity = activityRows.find((activity) => (
      String(activity.activityId || activity.id || activity.ruleId || '') === String(editingActivityId || '')
    )) || config;
    if (targetActivity) {
      loadConfigToForm(targetActivity, { audiences: audienceLibrary, templates: templateLibrary });
    }
    setEditingActivityId(null);
    setCreatingActivityDraft(false);
    setActivityDraftReturnId(null);
    setFlowChecked(false);
    setNotice({ ok: '已取消編輯，表單已還原為目前保存的活動內容。' });
  };

  const cancelNewActivityDraft = () => {
    const targetActivity = activityRows.find((activity) => (
      String(activity.activityId || activity.id || activity.ruleId || '') === String(activityDraftReturnId || '')
    )) || config || activityRows[0] || null;

    if (targetActivity) {
      loadConfigToForm(targetActivity, { audiences: audienceLibrary, templates: templateLibrary });
    } else {
      const firstAudience = activeAudiences[0] || retargetingAudienceFromPreset(AUDIENCE_PRESETS[0]);
      setActivityId(createRetargetingLibraryId('activity'));
      setActivityName('新再行銷活動');
      setActivityPriority(1);
      setActivityAudienceSnapshot(null);
      setActivityTemplateSnapshots([]);
      setSelectedAudienceId(firstAudience.id);
      setCycleFlows(defaultRetargetingCycleFlows());
      setCheckDelayDays(1);
      setSendMode('scheduled');
      setSendDelayDays(0);
      setSendAtTime('14:00');
      setObserveDays(3);
      setEngagementCriteria('any_click_or_reply');
      setRepeatStrategy('staged');
      setThirdStageAction('cooldown');
      setEnabled(false);
      setObserveOnly(false);
    }

    setEditingActivityId(targetActivity ? null : 'new');
    setCreatingActivityDraft(false);
    setActivityDraftReturnId(null);
    setFlowChecked(false);
    setNotice({ ok: '已取消新增活動，未保存草稿已丟棄。' });
  };
  const logsForActivity = (activity) => (dashboard?.logs || []).filter((log) => {
    const key = activity?.activityId || activity?.id || activity?.ruleId;
    return key
      && String(log.template_id || '').startsWith(`retargeting_auto_${key}_`)
      && Array.isArray(log.segments)
      && log.segments.includes(activityContext);
  });
  const outcomeForActivity = (activity) => activityOutcomes[activity?.activityId || activity?.id || activity?.ruleId] || {};
  const stateForActivity = (activity) => activityStates[activity?.activityId || activity?.id || activity?.ruleId] || {};
  const stageMetricsForActivity = (activity, rowLogs = [], rowState = {}) => {
    const flows = Array.isArray(activity?.cycleFlows) && activity.cycleFlows.length
      ? activity.cycleFlows
      : [{
          cycle: 1,
          enabled: true,
          stages: Array.isArray(activity?.stageTemplates) ? activity.stageTemplates : [],
        }];
    const metrics = flows.filter((flow) => flow.enabled !== false).flatMap((flow) => [1, 2, 3]
      .filter((stage) => stage === 1 || flow.stages?.[stage - 1]?.enabled || flow[`stage${stage}Enabled`])
      .map((stage) => {
        const cycle = Number(flow.cycle || 1);
        const stageLogs = rowLogs.filter((log) => String(log.template_id || '').includes(`_c${cycle}_s${stage}`));
        const stateMetric = rowState?.cycleStageCounts?.[String(cycle)]?.[String(stage)]
          || rowState?.stageCounts?.[stage]
          || {};
        return {
          cycle,
          stage,
          pending: stateMetric.pending || 0,
          sent: stageLogs.reduce((sum, log) => sum + Number(log.sent_count || 0), 0) || stateMetric.sent || 0,
          failed: stageLogs.filter((log) => log.status === 'failed').length || stateMetric.failed || 0,
          observing: stateMetric.observing || 0,
          observed: stageLogs.filter((log) => log.status === 'observed').length,
          clicks: stageLogs.reduce((sum, log) => sum + Number(log.click_count || 0), 0),
        };
      }));
    if (metrics.length) return metrics;
    return [1, 2, 3].map((stage) => {
      const stageLogs = rowLogs.filter((log) => String(log.template_id || '').includes(`_s${stage}`));
      const stateMetric = rowState?.stageCounts?.[stage] || {};
      return {
        cycle: 1,
        stage,
        pending: stateMetric.pending || 0,
        sent: stageLogs.reduce((sum, log) => sum + Number(log.sent_count || 0), 0) || stateMetric.sent || 0,
        failed: stageLogs.filter((log) => log.status === 'failed').length || stateMetric.failed || 0,
        observing: stateMetric.observing || 0,
        observed: stageLogs.filter((log) => log.status === 'observed').length,
        clicks: stageLogs.reduce((sum, log) => sum + Number(log.click_count || 0), 0),
      };
    });
  };
  const activityRecordItemsFor = (rowLogs = [], rowState = {}) => {
    const sentTotal = rowLogs.reduce((sum, log) => sum + Number(log.sent_count || 0), 0);
    const targetTotal = rowLogs.reduce((sum, log) => sum + Number(log.target_count || 0), 0);
    const failedTotal = rowLogs.filter((log) => log.status === 'failed').length;
    return [
      { label: '已處理', value: `${rowState.users || 0} 人` },
      { label: '待發', value: `${rowState.pending || 0} 人` },
      { label: '觀察回應中', value: `${rowState.observing || 0} 人` },
      { label: '實際發送', value: `${sentTotal} 人` },
      { label: '失敗', value: `${failedTotal || rowState.failed || 0} 筆` },
      { label: '真實紀錄', value: `${rowLogs.length} 筆` },
      { label: '目標累計', value: `${targetTotal} 人次` },
    ];
  };
  const outcomeItemsFor = (outcome = {}, rowLogs = []) => {
    const fallbackClicks = rowLogs.reduce((sum, log) => sum + Number(log.click_count || 0), 0);
    return [
      { label: '點擊', value: `${outcome.clickCount ?? fallbackClicks} 次` },
      { label: '回覆', value: `${outcome.repliedUsers || 0} 人` },
      { label: '進報名頁', value: `${outcome.applyClickUsers || 0} 人` },
      { label: '送單', value: `${outcome.submittedUsers || 0} 人` },
      { label: '付款', value: `${outcome.paidUsers || 0} 人` },
      { label: '停止追蹤', value: `${outcome.blockedUsers || 0} 人` },
    ];
  };
  const configuredCycleTemplates = cycleFlows.flatMap((flow) => {
    if (flow.enabled === false) return [];
    if (repeatStrategy !== 'staged') {
      return flow.cycle === 1
        ? [{ label: '第 1 次符合 / 第 1 階段', template: findTemplateById(flow.stage1TemplateId, 0), enabled: true }]
        : [];
    }
    return [
      { label: `第 ${flow.cycle} 次符合 / 第 1 階段`, template: findTemplateById(flow.stage1TemplateId, 0), enabled: true },
      { label: `第 ${flow.cycle} 次符合 / 第 2 階段`, template: findTemplateById(flow.stage2TemplateId, 1), enabled: !!flow.stage2Enabled },
      { label: `第 ${flow.cycle} 次符合 / 第 3 階段`, template: findTemplateById(flow.stage3TemplateId, 2), enabled: !!flow.stage3Enabled },
    ].filter((item) => item.enabled);
  });
  const readinessWarnings = enabled
    ? configuredCycleTemplates.flatMap((item) => getRetargetingTemplateWarnings(item.template, item.label))
    : [];
  const hasRequiredFirstTemplate = !!configuredCycleTemplates.find((item) => (
    item.label === '第 1 次符合 / 第 1 階段'
    && item.template?.body?.trim()
  ));
  return (
    <div>
      <h2 style={styles.sectionTitle}>受眾再行銷</h2>
      <p style={styles.sectionDesc}>
        受眾、模板與流程分開保存；可同時啟用多個再行銷活動，但同一輪 cron 同一會員最多只會收到一則，並依活動優先順序處理。
      </p>

      {activityLocked && (
        <div style={styles.retargetingPrototypeNotice}>
          目前第 3-4 區顯示已保存活動，活動流程預設為唯讀；第 1-2 區的受眾與模板資料庫仍可直接新增、修改或刪除。
        </div>
      )}
      {notice && (
        <div style={{
          ...styles.retargetingPrototypeNotice,
          color: notice.error ? '#991b1b' : '#166534',
          borderColor: notice.error ? '#fecaca' : '#bbf7d0',
          background: notice.error ? '#fef2f2' : '#f0fdf4',
        }}>
          {notice.error || notice.ok}
        </div>
      )}

      <div>
        <div style={styles.retargetingLayout}>
          <section style={styles.retargetingPanel}>
            <div style={styles.retargetingPanelHead}>
              <span style={styles.retargetingStep}>1</span>
              <div>
                <h3 style={styles.analyticsH3}>受眾資料庫</h3>
                <p style={styles.retargetingMuted}>先保存受眾條件，之後可重複套用到不同活動。</p>
              </div>
            </div>
            <div style={styles.retargetingFooter}>
              <select value={audienceDraft.id} onChange={(e) => selectAudience(e.target.value)} style={styles.input}>
                {audienceOptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
              <button type="button" style={styles.btnSecondary} onClick={newAudience}>＋ 新增受眾</button>
            </div>
            {!audienceEditorOpen && (
              <div style={styles.retargetingRuleBox}>
                <div style={styles.retargetingRuleTitle}>
                  {audienceDraft.title || '未命名受眾'}{audienceDraft.builtIn ? '（內建，可另存）' : ''}
                </div>
                {buildRetargetingAudienceRuleLabels(audienceDraft).map((rule) => (
                  <span key={rule} style={styles.retargetingRuleChip}>{rule}</span>
                ))}
                <div style={{ ...styles.retargetingActivityActions, marginTop: 12 }}>
                  <button type="button" style={styles.btnSecondary} onClick={() => setAudienceEditorOpen(true)}>
                    {audienceDraft.builtIn ? '編輯並另存受眾' : '編輯受眾'}
                  </button>
                </div>
              </div>
            )}
            {audienceEditorOpen && (
              <>
            <label style={styles.fieldLabel}>受眾名稱</label>
            <input value={audienceDraft.title || ''} onChange={(e) => setAudienceDraft((draft) => ({ ...draft, title: e.target.value }))} style={styles.input} />
            <label style={styles.fieldLabel}>主要判斷類型</label>
            <select value={audienceDraft.ruleId || 'dropoff'} onChange={(e) => setAudienceRuleId(e.target.value)} style={styles.input}>
              <option value="dropoff">互動下降</option>
              <option value="warm">近期有互動</option>
              <option value="apply_no_submit">點報名頁但未送單</option>
              <option value="pending_payment">已送單但未付款</option>
              <option value="cold">長期冷受眾</option>
              <option value="custom">自訂點擊條件</option>
            </select>
            <div style={styles.retargetingLayout}>
              <RetargetingConditionNumberField label="已收到至少幾篇排程文章" conditionKey="receivedMin" min={0} value={audienceDraft.audienceConditions?.receivedMin ?? 3} enabled={getRetargetingConditionEnabled(audienceDraft, 'receivedMin')} onToggle={toggleAudienceCondition} onChange={updateAudienceCondition} />
              <RetargetingConditionNumberField label="至少點擊幾篇" conditionKey="clickedMin" min={0} value={audienceDraft.audienceConditions?.clickedMin ?? 2} enabled={getRetargetingConditionEnabled(audienceDraft, 'clickedMin')} onToggle={toggleAudienceCondition} onChange={updateAudienceCondition} />
              <RetargetingConditionNumberField label="最近連續幾篇沒有點擊" conditionKey="inactiveSteps" min={1} value={audienceDraft.audienceConditions?.inactiveSteps ?? 2} enabled={getRetargetingConditionEnabled(audienceDraft, 'inactiveSteps')} onToggle={toggleAudienceCondition} onChange={updateAudienceCondition} />
              <RetargetingConditionNumberField label="最近幾天有互動" conditionKey="recentDays" min={1} value={audienceDraft.audienceConditions?.recentDays ?? 14} enabled={getRetargetingConditionEnabled(audienceDraft, 'recentDays')} onToggle={toggleAudienceCondition} onChange={updateAudienceCondition} />
              <RetargetingConditionNumberField label="加入至少幾天" conditionKey="joinedDays" min={0} value={audienceDraft.audienceConditions?.joinedDays ?? 30} enabled={getRetargetingConditionEnabled(audienceDraft, 'joinedDays')} onToggle={toggleAudienceCondition} onChange={updateAudienceCondition} />
              <RetargetingConditionNumberField label="點報名頁後等待幾天" conditionKey="applyDelayDays" min={0} value={audienceDraft.audienceConditions?.applyDelayDays ?? 3} enabled={getRetargetingConditionEnabled(audienceDraft, 'applyDelayDays')} onToggle={toggleAudienceCondition} onChange={updateAudienceCondition} />
              <RetargetingConditionNumberField label="至少點報名頁幾次" conditionKey="applyClicks" min={1} value={audienceDraft.audienceConditions?.applyClicks ?? 1} enabled={getRetargetingConditionEnabled(audienceDraft, 'applyClicks')} onToggle={toggleAudienceCondition} onChange={updateAudienceCondition} />
              <RetargetingConditionNumberField label="送單後等待付款幾天" conditionKey="paymentDelayDays" min={0} value={audienceDraft.audienceConditions?.paymentDelayDays ?? 2} enabled={getRetargetingConditionEnabled(audienceDraft, 'paymentDelayDays')} onToggle={toggleAudienceCondition} onChange={updateAudienceCondition} />
            </div>
            <div style={styles.retargetingConditionBox}>
              <label style={styles.retargetingConditionToggle}>
                <input type="checkbox" checked={getRetargetingConditionEnabled(audienceDraft, 'customArticleType')} onChange={(e) => toggleAudienceCondition('customArticleType', e.target.checked)} />
                <span>限定文章類型</span>
              </label>
              <select
                disabled={!getRetargetingConditionEnabled(audienceDraft, 'customArticleType')}
                value={audienceDraft.audienceConditions?.customArticleType || 'any'}
                onChange={(e) => updateAudienceCondition('customArticleType', e.target.value)}
                style={{ ...styles.input, marginBottom: 0 }}
              >
                <option value="any">不限類型</option>
                {DRIP_ARTICLE_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
              </select>
            </div>
            <div style={styles.retargetingLayout}>
              <RetargetingConditionSwitch label="排除已點報名頁" conditionKey="excludeApplyClickers" enabled={getRetargetingConditionEnabled(audienceDraft, 'excludeApplyClickers')} onToggle={toggleAudienceCondition} checked={audienceDraft.audienceConditions?.excludeApplyClickers !== false} onCheckedChange={updateAudienceCondition} />
              <RetargetingConditionSwitch label="排除已送單" conditionKey="customExcludeSubmitted" enabled={getRetargetingConditionEnabled(audienceDraft, 'customExcludeSubmitted')} onToggle={toggleAudienceCondition} checked={audienceDraft.audienceConditions?.customExcludeSubmitted !== false} onCheckedChange={updateAudienceCondition} />
              <RetargetingConditionSwitch label="排除已付款" conditionKey="customExcludePaid" enabled={getRetargetingConditionEnabled(audienceDraft, 'customExcludePaid')} onToggle={toggleAudienceCondition} checked={audienceDraft.audienceConditions?.customExcludePaid !== false} onCheckedChange={updateAudienceCondition} />
            </div>
            <div style={styles.retargetingRuleBox}>
              <div style={styles.retargetingRuleTitle}>目前實際判斷條件</div>
              {buildRetargetingAudienceRuleLabels(audienceDraft).map((rule) => (
                <span key={rule} style={styles.retargetingRuleChip}>{rule}</span>
              ))}
            </div>
            <div style={styles.retargetingActivityActions}>
              <button type="button" style={styles.btnPrimary} disabled={saving === 'audience'} onClick={saveAudience}>
                {saving === 'audience'
                  ? '儲存中...'
                  : audienceDraft.builtIn
                    ? '另存為自訂受眾'
                    : '儲存受眾修改'}
              </button>
              {!audienceDraft.builtIn && (
                <>
                  <button type="button" style={styles.btnSecondary} onClick={() => {
                    setAudienceDraft((draft) => ({ ...draft, id: createRetargetingLibraryId('audience'), title: `${draft.title} 副本`, builtIn: false }));
                    setAudienceEditorOpen(true);
                  }}>複製</button>
                  <button type="button" style={styles.btnSecondary} onClick={() => disableOrDeleteLibraryItem('audience', audienceDraft.id)}>停用</button>
                  <button type="button" style={styles.btnSecondary} onClick={() => disableOrDeleteLibraryItem('audience', audienceDraft.id, true)}>刪除</button>
                </>
              )}
            </div>
              </>
            )}
          </section>

          <section style={styles.retargetingPanel}>
            <div style={styles.retargetingPanelHead}>
              <span style={styles.retargetingStep}>2</span>
              <div>
                <h3 style={styles.analyticsH3}>模板資料庫</h3>
                <p style={styles.retargetingMuted}>模板獨立保存；活動流程會從這裡選用要發送的模板。</p>
              </div>
            </div>
            <div style={styles.retargetingFooter}>
              <select value={templateDraft.id} onChange={(e) => selectTemplate(e.target.value)} style={styles.input}>
                {templateOptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
              <button type="button" style={styles.btnSecondary} onClick={newTemplate}>＋ 新增模板</button>
            </div>
            {!templateEditorOpen && (
              <div style={styles.retargetingRuleBox}>
                <div style={styles.retargetingRuleTitle}>
                  {templateDraft.title || '未命名模板'}{templateDraft.builtIn ? '（內建，可另存）' : ''}
                </div>
                <div style={styles.retargetingMuted}>分類：{templateDraft.category || '未分類'}</div>
                <div style={{ ...styles.retargetingMuted, marginTop: 6 }}>
                  {(templateDraft.body || '尚未設定訊息文字').slice(0, 90)}
                  {(templateDraft.body || '').length > 90 ? '...' : ''}
                </div>
                {createRetargetingDraft(templateDraft).buttons.filter(hasRetargetingButtonDraftContent).length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {createRetargetingDraft(templateDraft).buttons.filter(hasRetargetingButtonDraftContent).map((button, index) => (
                      <span key={`${button.label || button.url || button.replyText}-${index}`} style={styles.retargetingRuleChip}>
                        {button.label || `按鈕 ${index + 1}`}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ ...styles.retargetingActivityActions, marginTop: 12 }}>
                  <button type="button" style={styles.btnSecondary} onClick={() => setTemplateEditorOpen(true)}>
                    {templateDraft.builtIn ? '編輯並另存模板' : '編輯模板'}
                  </button>
                </div>
              </div>
            )}
            {templateEditorOpen && (
              <>
            <label style={styles.fieldLabel}>模板名稱</label>
            <input value={templateDraft.title || ''} onChange={(e) => setTemplateDraft((draft) => ({ ...draft, title: e.target.value }))} style={styles.input} />
            <label style={styles.fieldLabel}>分類</label>
            <input value={templateDraft.category || ''} onChange={(e) => setTemplateDraft((draft) => ({ ...draft, category: e.target.value }))} style={styles.input} />
            <ImageUpload imageUrl={templateDraft.image_url || ''} onChange={(url) => setTemplateDraft((draft) => ({ ...draft, image_url: url }))} />
            <label style={styles.fieldLabel}>訊息文字</label>
            <textarea value={templateDraft.body || ''} onChange={(e) => setTemplateDraft((draft) => ({ ...draft, body: e.target.value }))} style={styles.textarea} rows={6} />
            {[0, 1, 2].map((index) => (
              <div key={index} style={styles.retargetingButtonEditor}>
                <label style={styles.fieldLabel}>按鈕 {index + 1}</label>
                <input value={templateDraft.buttons?.[index]?.label || ''} onChange={(e) => updateTemplateButton(index, 'label', e.target.value)} style={styles.input} placeholder="按鈕文字" />
                <select value={templateDraft.buttons?.[index]?.actionType || 'url'} onChange={(e) => updateTemplateButton(index, 'actionType', e.target.value)} style={styles.input}>
                  <option value="url">開啟連結</option>
                  <option value="message">文字回覆</option>
                </select>
                {(templateDraft.buttons?.[index]?.actionType || 'url') === 'message' ? (
                  <textarea value={templateDraft.buttons?.[index]?.replyText || ''} onChange={(e) => updateTemplateButton(index, 'replyText', e.target.value)} style={styles.textarea} rows={3} placeholder="使用者點擊後，BOT 回覆的文字" />
                ) : (
                  <input value={templateDraft.buttons?.[index]?.url || ''} onChange={(e) => updateTemplateButton(index, 'url', e.target.value)} style={styles.input} placeholder="https://..." />
                )}
              </div>
            ))}
            <div style={styles.retargetingActivityActions}>
              <button type="button" style={styles.btnPrimary} disabled={saving === 'template' || !templateDraft.body?.trim()} onClick={saveTemplate}>
                {saving === 'template'
                  ? '儲存中...'
                  : templateDraft.builtIn
                    ? '另存為自訂模板'
                    : '儲存模板修改'}
              </button>
              {!templateDraft.builtIn && (
                <>
                  <button type="button" style={styles.btnSecondary} onClick={() => {
                    setTemplateDraft((draft) => ({ ...draft, id: createRetargetingLibraryId('template'), title: `${draft.title} 副本`, builtIn: false }));
                    setTemplateEditorOpen(true);
                  }}>複製</button>
                  <button type="button" style={styles.btnSecondary} onClick={() => disableOrDeleteLibraryItem('template', templateDraft.id)}>停用</button>
                  <button type="button" style={styles.btnSecondary} onClick={() => disableOrDeleteLibraryItem('template', templateDraft.id, true)}>刪除</button>
                </>
              )}
            </div>
            <FlexPreview message={templateDraft.body} buttons={templateDraft.buttons} imageUrl={templateDraft.image_url || undefined} />
              </>
            )}
          </section>
        </div>

        <section style={{ ...styles.retargetingPanel, marginTop: 16 }}>
          <div style={styles.retargetingPanelHead}>
            <span style={styles.retargetingStep}>3</span>
            <div>
              <h3 style={styles.analyticsH3}>新增 / 編輯再行銷活動</h3>
              <p style={styles.retargetingMuted}>先命名活動，再選這次活動要套用的受眾與每一輪要發送的模板。</p>
            </div>
          </div>
          <div style={styles.retargetingActivityActions}>
            <button type="button" style={styles.btnSecondary} onClick={startNewActivity}>＋ 新增再行銷活動</button>
            {activityLocked && <span style={styles.retargetingMuted}>目前活動流程為唯讀；按「新增再行銷活動」可建立新活動草稿，或從第 5 區載入既有活動編輯。</span>}
          </div>
          <fieldset disabled={activityLocked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <label style={styles.fieldLabel}>活動名稱</label>
          <input value={activityName || ''} onChange={(e) => { setActivityName(e.target.value); setFlowChecked(false); }} style={styles.input} />
          <RetargetingNumberField label="活動優先順序（數字越小越先檢查，同一輪 cron 同人最多發一則）" min={1} value={activityPriority} onChange={(v) => { setActivityPriority(v); setFlowChecked(false); }} />
          <label style={styles.fieldLabel}>這次活動要使用的受眾</label>
          <select value={selectedAudienceId} onChange={(e) => { setSelectedAudienceId(e.target.value); setFlowChecked(false); }} style={styles.input}>
            {activeAudiences.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
          <div style={styles.retargetingRuleBox}>
            <div style={styles.retargetingRuleTitle}>此活動實際受眾條件</div>
            {buildRetargetingAudienceRuleLabels(selectedAudience).map((rule) => (
              <span key={rule} style={styles.retargetingRuleChip}>{rule}</span>
            ))}
          </div>
          <div style={styles.retargetingTimeline}>
            <div style={styles.retargetingTimelineItem}>
              <span style={styles.retargetingTimelineStep}>1</span>
              <div style={styles.retargetingTimelineBody}>
                <strong>每篇排程文章發出後，先等待再檢查目前受眾條件</strong>
                <RetargetingNumberField label="等待幾天後檢查" min={0} value={checkDelayDays} onChange={(v) => { setCheckDelayDays(v); setFlowChecked(false); }} />
              </div>
            </div>
            <div style={styles.retargetingTimelineItem}>
              <span style={styles.retargetingTimelineStep}>2</span>
              <div style={styles.retargetingTimelineBody}>
                <strong>符合條件後，何時發送本輪第 1 階段模板</strong>
                <select value={sendMode} onChange={(e) => { setSendMode(e.target.value); setFlowChecked(false); }} style={styles.input}>
                  <option value="instant">檢查符合後立即發送</option>
                  <option value="scheduled">檢查符合後排程發送</option>
                </select>
                {sendMode === 'scheduled' && (
                  <>
                    <RetargetingNumberField label="符合後等待幾天發送" min={0} value={sendDelayDays} onChange={(v) => { setSendDelayDays(v); setFlowChecked(false); }} />
                    <label style={styles.fieldLabel}>發送時間<input type="time" value={sendAtTime} onChange={(e) => { setSendAtTime(e.target.value); setFlowChecked(false); }} style={styles.input} /></label>
                  </>
                )}
              </div>
            </div>
            <div style={styles.retargetingTimelineItem}>
              <span style={styles.retargetingTimelineStep}>3</span>
              <div style={styles.retargetingTimelineBody}>
                <strong>設定所有階段共用的有效互動判定</strong>
                <label style={styles.fieldLabel}>什麼算有效互動</label>
                <select value={engagementCriteria} onChange={(e) => { setEngagementCriteria(e.target.value); setFlowChecked(false); }} style={styles.input}>
                  <option value="any_click_or_reply">任一連結點擊或 LINE 回覆，其中一個就算</option>
                  <option value="reply_only">只計 LINE 回覆</option>
                  <option value="conversion">只計報名頁 / 送單 / 付款</option>
                  <option value="effective">有效互動：回覆、報名或付款其中一個</option>
                </select>
              </div>
            </div>
            <div style={styles.retargetingTimelineItem}>
              <span style={styles.retargetingTimelineStep}>4</span>
              <div style={styles.retargetingTimelineBody}>
                <strong>每一次符合受眾後，要發哪一輪、哪一階段模板</strong>
                <select value={repeatStrategy} onChange={(e) => { setRepeatStrategy(e.target.value); setFlowChecked(false); }} style={styles.input}>
                  <option value="staged">每輪可追發 3 階段</option>
                  <option value="once">只發第 1 次符合的第 1 階段</option>
                  <option value="cooldown">發一次後進入冷卻</option>
                </select>
                {repeatStrategy !== 'staged' && (
                  <div style={styles.retargetingPrototypeNotice}>
                    目前模式只會發第 1 階段；若要「沒互動追第 2/3 階段」以及「再次符合再跑下一輪」，請選「每輪可追發 3 階段」。
                  </div>
                )}
                {repeatStrategy === 'staged' && (
                  <div style={styles.retargetingCycleGrid}>
                    {cycleFlows.map((flow) => (
                      <div key={flow.cycle} style={styles.retargetingCycleBox}>
                        <label style={styles.retargetingSwitchRow}>
                          <input
                            type="checkbox"
                            checked={flow.cycle === 1 || flow.enabled}
                            disabled={flow.cycle === 1}
                            onChange={(e) => updateCycleFlow(flow.cycle, { enabled: e.target.checked })}
                          />
                          <span>
                            <strong>第 {flow.cycle} 次符合</strong>
                            <small>
                              {flow.cycle === 1
                                ? '第一次符合受眾條件時一定會檢查這一輪。'
                                : '上一輪有互動後，未來又再次符合受眾條件時才會進入這一輪。'}
                            </small>
                          </span>
                        </label>
                        {(flow.cycle === 1 || flow.enabled) && (
                          <>
                            <label style={styles.fieldLabel}>第 1 階段模板</label>
                            <select value={flow.stage1TemplateId} onChange={(e) => updateCycleFlow(flow.cycle, { stage1TemplateId: e.target.value })} style={styles.input}>
                              {activeTemplates.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                            </select>
                            <RetargetingNumberField
                              label="第 1 階段送出後觀察幾天"
                              min={1}
                              value={flow.stage1ObserveDays}
                              onChange={(value) => updateCycleFlow(flow.cycle, { stage1ObserveDays: value })}
                            />
                            <label style={styles.retargetingSwitchRow}>
                              <input
                                type="checkbox"
                                checked={!!flow.stage2Enabled}
                                onChange={(e) => updateCycleFlow(flow.cycle, { stage2Enabled: e.target.checked, stage3Enabled: e.target.checked ? flow.stage3Enabled : false })}
                              />
                              <span><strong>第 2 階段追發</strong><small>第 1 階段送出後，觀察期內沒有有效互動才會發。</small></span>
                            </label>
                            {flow.stage2Enabled && (
                              <>
                                <label style={styles.fieldLabel}>第 2 階段模板</label>
                                <select value={flow.stage2TemplateId} onChange={(e) => updateCycleFlow(flow.cycle, { stage2TemplateId: e.target.value })} style={styles.input}>
                                  {activeTemplates.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                                </select>
                                <RetargetingNumberField
                                  label="第 2 階段送出後觀察幾天"
                                  min={1}
                                  value={flow.stage2ObserveDays}
                                  onChange={(value) => updateCycleFlow(flow.cycle, { stage2ObserveDays: value })}
                                />
                              </>
                            )}
                            <label style={styles.retargetingSwitchRow}>
                              <input
                                type="checkbox"
                                disabled={!flow.stage2Enabled}
                                checked={!!flow.stage2Enabled && !!flow.stage3Enabled}
                                onChange={(e) => updateCycleFlow(flow.cycle, { stage3Enabled: e.target.checked })}
                              />
                              <span><strong>第 3 階段追發</strong><small>第 2 階段後仍沒有有效互動才會發。</small></span>
                            </label>
                            {flow.stage3Enabled && (
                              <>
                                <label style={styles.fieldLabel}>第 3 階段模板</label>
                                <select value={flow.stage3TemplateId} onChange={(e) => updateCycleFlow(flow.cycle, { stage3TemplateId: e.target.value })} style={styles.input}>
                                  {activeTemplates.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                                </select>
                                <RetargetingNumberField
                                  label="第 3 階段送出後觀察幾天"
                                  min={1}
                                  value={flow.stage3ObserveDays}
                                  onChange={(value) => updateCycleFlow(flow.cycle, { stage3ObserveDays: value })}
                                />
                              </>
                            )}
                            <label style={styles.fieldLabel}>本輪沒有下一階段可追發時</label>
                            <select value={flow.finalAction || 'cooldown'} onChange={(e) => updateCycleFlow(flow.cycle, { finalAction: e.target.value })} style={styles.input}>
                              <option value="cooldown">進入冷卻</option>
                              <option value="manual">人工查看</option>
                              <option value="stop">停止追蹤</option>
                            </select>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <button type="button" style={styles.btnSecondary} onClick={() => { setFlowChecked(true); setNotice({ ok: '流程檢查完成；尚未啟用，請到第 4 區正式保存。' }); }}>
            完成流程檢查
          </button>
          </fieldset>
        </section>

        <section style={{ ...styles.retargetingPanel, marginTop: 16 }}>
          <div style={styles.retargetingPanelHead}>
            <span style={styles.retargetingStep}>4</span>
            <div>
              <h3 style={styles.analyticsH3}>正式保存並啟用自動再行銷</h3>
              <p style={styles.retargetingMuted}>這裡才會保存並套用第 1-3 區設定。</p>
            </div>
          </div>
          <fieldset disabled={activityLocked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div style={styles.retargetingPrototypeNotice}>
            目前執行對象：{dashboard?.testMode ? `管理者測試（共 ${dashboard?.managerCount || 0} 位）` : '一般會員正式流程'}。
            {dashboard?.testMode ? '排程測試模式啟用時，再行銷會跟著只對管理者自動檢查。' : '取消排程測試模式後，下一次 cron 會改為一般會員正式流程。'}
          </div>
          {readinessWarnings.length > 0 && (
            <div style={{ ...styles.retargetingPrototypeNotice, color: '#991b1b', borderColor: '#fecaca', background: '#fef2f2' }}>
              正式會員啟用前需修正：{readinessWarnings.slice(0, 4).join('；')}
              {readinessWarnings.length > 4 ? `，另有 ${readinessWarnings.length - 4} 項` : ''}
            </div>
          )}
          <label style={styles.retargetingSwitchRow}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span><strong>啟用自動再行銷</strong><small>關閉時只保存設定，不會檢查或發送。</small></span>
          </label>
          <label style={styles.retargetingSwitchRow}>
            <input type="checkbox" checked={observeOnly} onChange={(e) => setObserveOnly(e.target.checked)} />
            <span><strong>觀察模式</strong><small>符合條件時只留下紀錄，不實際發送。</small></span>
          </label>
          <div style={styles.retargetingActivityActions}>
            <button type="button" style={styles.btnPrimary} disabled={saving === 'config' || !flowChecked || !hasRequiredFirstTemplate} onClick={applyConfig}>
              {saving === 'config'
                ? '保存中...'
                : !enabled
                  ? '保存設定（目前停用）'
                  : editingActivityId && editingActivityId !== 'new'
                    ? '儲存更新並套用'
                    : '正式保存並啟用自動再行銷'}
            </button>
            {editingActivityId === 'new' && creatingActivityDraft && (
              <button type="button" style={styles.btnSecondary} onClick={cancelNewActivityDraft}>
                取消新增
              </button>
            )}
            {editingActivityId && editingActivityId !== 'new' && (
              <button type="button" style={styles.btnSecondary} onClick={cancelActivityEdit}>
                取消編輯
              </button>
            )}
          </div>
          {!flowChecked && <p style={styles.retargetingMuted}>請先在第 3 區按「完成流程檢查」。</p>}
          </fieldset>
        </section>
      </div>

      <section style={{ ...styles.retargetingPanel, marginTop: 16 }}>
        <div style={styles.retargetingPanelHead}>
          <span style={styles.retargetingStep}>5</span>
          <div>
            <h3 style={styles.analyticsH3}>發送紀錄 / 活動紀錄</h3>
            <p style={styles.retargetingMuted}>只顯示真實保存設定、cron 狀態與實際發送紀錄。</p>
          </div>
        </div>
        {activityRows.length > 0 && (
          <>
            <div style={styles.retargetingRuleTitle}>再行銷活動列表</div>
            <div style={styles.retargetingMetricGrid}>
              {activityRows.map((activity) => {
                const key = activity.activityId || activity.id || activity.ruleId;
                const rowLogs = logsForActivity(activity);
                const outcome = outcomeForActivity(activity);
                const rowState = stateForActivity(activity);
                const isCurrent = config?.activityId === key;
                const rowSentCount = outcome.sentCount ?? rowLogs.reduce((sum, log) => sum + Number(log.sent_count || 0), 0);
                const rowClickCount = outcome.clickCount ?? rowLogs.reduce((sum, log) => sum + Number(log.click_count || 0), 0);
                const rowFailedCount = rowLogs.filter((log) => log.status === 'failed').length || rowState.failed || 0;
                const rowStatus = !activity.enabled
                  ? '已停用'
                  : activity.observeOnly
                    ? '觀察模式'
                    : rowFailedCount > 0
                      ? '發送失敗，等待修正後重試'
                    : rowState.observing > 0
                      ? '再行銷訊息已送出，觀察回應中'
                    : rowState.pending > 0
                      ? '已排程待發送'
                    : rowSentCount > 0
                      ? '已發送'
                      : '規則已保存，尚未觸發發送';
                const rowStageMetrics = stageMetricsForActivity(activity, rowLogs, rowState);
                const rowRecordItems = activityRecordItemsFor(rowLogs, rowState);
                const rowOutcomeItems = outcomeItemsFor(outcome, rowLogs);
                const rowSkipNotice = getRetargetingSkipNotice(rowState);
                const rowCoverageNotice = outcome.trackedUsers
                  ? null
                  : '完整回覆、報名與付款歸因會從本次更新後的新再行銷紀錄開始累積；舊紀錄若沒有 user 標記，只能回溯發送與點擊。';
                return (
                  <article key={key} style={styles.retargetingMetricBox}>
                    <strong>{activity.activityName || activity.ruleTitle || '自動再行銷活動'}</strong>
                    <span>優先 {activity.priority || 1}｜{isCurrent ? '目前編輯活動' : '活動庫'}｜{rowStatus}</span>
                    <span>待發 {rowState.pending || 0}｜觀察中 {rowState.observing || 0}｜錯誤 {rowState.failed || 0}</span>
                    <span>已發 {rowSentCount}｜點擊 {rowClickCount}</span>
                    <span>回覆 {outcome.repliedUsers || 0}｜報名頁 {outcome.applyClickUsers || 0}｜送單 {outcome.submittedUsers || 0}｜付款 {outcome.paidUsers || 0}</span>
                    <div style={styles.retargetingActivityActions}>
                      <button type="button" style={styles.btnSecondary} onClick={() => {
                        loadConfigToForm(activity, { audiences: audienceLibrary, templates: templateLibrary });
                        setEditingActivityId(key || 'current');
                        setCreatingActivityDraft(false);
                        setActivityDraftReturnId(null);
                        setFlowChecked(false);
                        setNotice({ ok: `正在編輯「${activity.activityName || activity.ruleTitle || '自動再行銷活動'}」；修改後請重新完成流程檢查，再儲存更新。` });
                      }}>
                        載入編輯
                      </button>
                      <button type="button" style={styles.btnSecondary} onClick={() => duplicateActivity(activity)}>
                        複製成新活動
                      </button>
                      <button type="button" style={styles.btnSecondary} disabled={saving === `disable-${key}` || !activity.enabled} onClick={() => disableActivityById(activity)}>
                        {saving === `disable-${key}` ? '停用中...' : activity.enabled ? '停用活動' : '已停用'}
                      </button>
                      <button type="button" style={styles.btnSecondary} disabled={saving === `delete-${key}`} onClick={() => deleteActivityById(activity)}>
                        {saving === `delete-${key}` ? '刪除中...' : '刪除活動'}
                      </button>
                    </div>
                    <details style={{ ...styles.retargetingAnalysisDetails, marginTop: 12 }}>
                      <summary>展開活動細節</summary>
                      <div style={styles.retargetingAnalysisBody}>
                        <div style={styles.retargetingRuleTitle}>活動紀錄</div>
                        <div style={styles.retargetingActivityNumbers}>
                          {rowRecordItems.map((item) => (
                            <span key={item.label}>{item.label} {item.value}</span>
                          ))}
                        </div>
                        {(rowState?.lastError || rowState?.lastAttemptAt) && (
                          <div style={{ ...styles.retargetingPrototypeNotice, color: '#991b1b', borderColor: '#fecaca', background: '#fef2f2' }}>
                            最近嘗試：{formatRetargetingTime(rowState?.lastAttemptAt)}；錯誤：{rowState?.lastError || '尚無'}
                          </div>
                        )}
                        {rowSkipNotice && (
                          <div style={styles.retargetingPrototypeNotice}>
                            最近未發送原因：{rowSkipNotice}
                          </div>
                        )}

                        <div style={styles.retargetingRuleTitle}>各階段紀錄</div>
                        <div style={styles.retargetingActivityNumbers}>
                          {rowStageMetrics.map((metric) => (
                            <span key={`${metric.cycle}-${metric.stage}`}>
                              第 {metric.cycle} 次 / 第 {metric.stage} 階段：待發 {metric.pending || 0}｜已發 {metric.sent || 0}｜觀察 {metric.observing || 0}｜點擊 {metric.clicks || 0}｜失敗 {metric.failed || 0}
                            </span>
                          ))}
                        </div>

                        <div style={styles.retargetingRuleTitle}>成效分析</div>
                        <div style={styles.retargetingActivityNumbers}>
                          {rowOutcomeItems.map((item) => (
                            <span key={item.label}>{item.label} {item.value}</span>
                          ))}
                        </div>
                        {rowCoverageNotice && (
                          <div style={styles.retargetingPrototypeNotice}>{rowCoverageNotice}</div>
                        )}

                        <div style={styles.retargetingRuleBox}>
                          {(activity.audienceRules || []).map((rule, index) => (
                            <span key={`${rule}-${index}`} style={styles.retargetingRuleChip}>{rule}</span>
                          ))}
                        </div>
                        <details style={styles.retargetingAnalysisDetails}>
                          <summary>最近真實發送 / 觀察紀錄</summary>
                          <div style={styles.retargetingAnalysisBody}>
                            {rowLogs.length === 0 ? (
                              <span>規則已保存，尚未觸發發送。</span>
                            ) : rowLogs.slice(0, 10).map((log) => (
                              <span key={log.id}>{formatRetargetingTime(log.created_at)}｜{log.label}｜{log.status}｜發送 {log.sent_count || 0}｜點擊 {log.click_count || 0}</span>
                            ))}
                          </div>
                        </details>
                      </div>
                    </details>
                  </article>
                );
              })}
            </div>
          </>
        )}
        {activityRows.length === 0 && (
          <div style={styles.retargetingPrototypeNotice}>尚未保存自動再行銷活動，未完成的畫面草稿不會顯示在這裡。</div>
        )}
      </section>
    </div>
  );
}

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
  modeToggle: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  modeBtn: {
    flex: '1 1 160px',
    minWidth: 140,
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    background: '#fff',
    cursor: 'pointer',
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 1.4,
  },
  modeActive: {
    flex: '1 1 160px',
    minWidth: 140,
    padding: '8px 12px',
    border: '2px solid #2a9d6f',
    borderRadius: 8,
    background: '#f0fdf4',
    cursor: 'pointer',
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 1.4,
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
  btnSecondary: {
    padding: '10px 14px',
    fontSize: 14,
    fontWeight: 600,
    color: '#1f7a55',
    background: '#fff',
    border: '1px solid #bbf7d0',
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
  dripAdminResetBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
    padding: '12px 14px',
    border: '1px solid #fde68a',
    borderRadius: 8,
    background: '#fffbeb',
    flexWrap: 'wrap',
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

  // ============ 📊 分析 Tab 樣式 ============
  analyticsToolbar: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    padding: '8px 0',
  },
  analyticsChip: {
    padding: '6px 12px',
    fontSize: 13,
    border: '1px solid #d1d5db',
    borderRadius: 16,
    background: '#fff',
    color: '#555',
    cursor: 'pointer',
  },
  analyticsChipActive: {
    padding: '6px 12px',
    fontSize: 13,
    border: '1px solid #2a9d6f',
    borderRadius: 16,
    background: '#2a9d6f',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 500,
  },
  analyticsCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  analyticsH3: {
    fontSize: 14,
    fontWeight: 600,
    margin: '0 0 8px',
    color: '#1a1a1a',
  },
  analyticsFunnelRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 4px',
    fontSize: 14,
    borderRadius: 6,
  },
  analyticsTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
    marginTop: 4,
  },
  analyticsTh: {
    textAlign: 'left',
    padding: '8px 10px',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    fontWeight: 600,
    color: '#444',
  },
  analyticsTd: {
    padding: '8px 10px',
    borderBottom: '1px solid #f1f5f9',
    color: '#1a1a1a',
  },
  analyticsExpandBtn: {
    border: 'none',
    background: 'none',
    color: '#2a9d6f',
    cursor: 'pointer',
    fontSize: 13,
    padding: 0,
  },
  analyticsViewBtn: {
    border: '1px solid #d1d5db',
    background: '#fff',
    cursor: 'pointer',
    fontSize: 14,
    borderRadius: 6,
    padding: '2px 8px',
  },
  analyticsLinkBtn: {
    border: 'none',
    background: 'none',
    color: '#2a9d6f',
    cursor: 'pointer',
    fontSize: 12,
    marginLeft: 8,
  },
  analyticsMaybeGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 8,
  },
  analyticsKpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 8,
  },
  analyticsKpi: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '10px 12px',
    textAlign: 'center',
  },
  analyticsKpiNum: {
    fontSize: 22,
    fontWeight: 700,
    color: '#1a1a1a',
  },
  analyticsKpiLabel: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  analyticsStageRow: {
    padding: '10px 12px',
    borderBottom: '1px solid #f1f5f9',
    fontSize: 14,
  },
  analyticsActionBtn: {
    fontSize: 12,
    padding: '4px 10px',
    border: '1px solid #2a9d6f',
    background: '#fff',
    color: '#2a9d6f',
    borderRadius: 6,
    cursor: 'pointer',
  },
  retargetingLayout: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
    gap: 16,
    alignItems: 'start',
  },
  retargetingPanel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 16,
  },
  retargetingPanelHead: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 14,
  },
  retargetingStep: {
    width: 26,
    height: 26,
    borderRadius: 13,
    background: '#1f7a55',
    color: '#fff',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
  },
  retargetingMuted: {
    display: 'block',
    color: '#64748b',
    fontSize: 12,
    lineHeight: 1.5,
    marginTop: 2,
  },
  retargetingPresetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 8,
  },
  retargetingPreset: {
    border: '1px solid #e5e7eb',
    background: '#fff',
    borderRadius: 8,
    padding: 12,
    textAlign: 'left',
    cursor: 'pointer',
    minHeight: 118,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  retargetingPresetActive: {
    borderColor: '#1f7a55',
    boxShadow: '0 0 0 2px rgba(31,122,85,0.12)',
    background: '#f7fbf8',
  },
  retargetingPresetTitle: {
    fontWeight: 700,
    color: '#111827',
    fontSize: 14,
  },
  retargetingPresetTone: {
    alignSelf: 'flex-start',
    border: '1px solid #bbf7d0',
    background: '#f0fdf4',
    color: '#166534',
    borderRadius: 999,
    padding: '2px 8px',
    fontSize: 11,
  },
  retargetingPresetDesc: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 1.45,
  },
  retargetingTuning: {
    marginTop: 14,
    padding: 12,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#fafafa',
  },
  retargetingRange: {
    width: '100%',
    accentColor: '#1f7a55',
    margin: '4px 0 12px',
  },
  retargetingConditionBox: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 10,
    background: '#f8fafc',
    display: 'grid',
    gap: 8,
    minWidth: 0,
  },
  retargetingConditionToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: '#334155',
    fontSize: 13,
    fontWeight: 700,
  },
  retargetingRuleBox: {
    marginTop: 14,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  retargetingRuleTitle: {
    width: '100%',
    color: '#475569',
    fontSize: 12,
    fontWeight: 700,
  },
  retargetingRuleChip: {
    border: '1px solid #cbd5e1',
    borderRadius: 999,
    padding: '5px 10px',
    color: '#334155',
    background: '#fff',
    fontSize: 12,
  },
  retargetingTemplateList: {
    display: 'grid',
    gap: 8,
    marginBottom: 12,
  },
  retargetingTemplateBtn: {
    border: '1px solid #e5e7eb',
    background: '#fff',
    borderRadius: 8,
    padding: '10px 12px',
    textAlign: 'left',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    color: '#111827',
  },
  retargetingTemplateBtnActive: {
    borderColor: '#1f7a55',
    background: '#f7fbf8',
  },
  retargetingButtonEditor: {
    padding: '8px 0',
    borderTop: '1px solid #f1f5f9',
  },
  retargetingInlineHint: {
    padding: '8px 10px',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#f8fafc',
    color: '#64748b',
    fontSize: 12,
    marginBottom: 4,
  },
  retargetingFlowGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
    gap: 16,
  },
  retargetingScheduleBox: {
    marginTop: 12,
    padding: 12,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#f8fafc',
    display: 'grid',
    gap: 8,
  },
  retargetingStageRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: '8px 10px',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#fff',
    color: '#334155',
    fontSize: 13,
    flexWrap: 'wrap',
  },
  retargetingTimeline: {
    display: 'grid',
    gap: 12,
  },
  retargetingTimelineItem: {
    display: 'grid',
    gridTemplateColumns: '32px minmax(0, 1fr)',
    gap: 10,
    alignItems: 'flex-start',
  },
  retargetingTimelineStep: {
    width: 28,
    height: 28,
    borderRadius: 14,
    background: '#e6f7ef',
    color: '#1f7a55',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 13,
    border: '1px solid #b7e4ce',
  },
  retargetingTimelineBody: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12,
    background: '#fff',
    display: 'grid',
    gap: 10,
    minWidth: 0,
  },
  retargetingCycleGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
    gap: 12,
  },
  retargetingCycleBox: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12,
    background: '#f8fafc',
    minWidth: 0,
  },
  retargetingAutomationPreview: {
    marginTop: 16,
    display: 'flex',
    alignItems: 'stretch',
    gap: 8,
    flexWrap: 'wrap',
  },
  retargetingFlowNode: {
    border: '1px solid #d1fae5',
    background: '#f0fdf4',
    color: '#14532d',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 13,
    minWidth: 130,
  },
  retargetingFlowArrow: {
    color: '#94a3b8',
    display: 'flex',
    alignItems: 'center',
    fontWeight: 700,
  },
  retargetingFlowSplit: {
    border: '1px solid #e5e7eb',
    background: '#f8fafc',
    borderRadius: 8,
    padding: '9px 12px',
    fontSize: 13,
    color: '#334155',
    display: 'grid',
    gap: 4,
    minWidth: 220,
  },
  retargetingFooter: {
    marginTop: 16,
    paddingTop: 14,
    borderTop: '1px solid #e5e7eb',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  retargetingPrototypeNotice: {
    marginTop: 12,
    border: '1px solid #fde68a',
    borderRadius: 8,
    padding: '10px 12px',
    background: '#fffbeb',
    color: '#92400e',
    fontSize: 13,
    lineHeight: 1.5,
  },
  retargetingSwitchRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    border: '1px solid #d1fae5',
    borderRadius: 8,
    background: '#f7fbf8',
    color: '#111827',
    fontSize: 14,
    lineHeight: 1.45,
    marginBottom: 14,
  },
  retargetingActivityGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
    gap: 12,
  },
  retargetingActivityCard: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 14,
    background: '#fff',
  },
  retargetingActivityCardActive: {
    borderColor: '#1f7a55',
    boxShadow: '0 0 0 2px rgba(31,122,85,0.12)',
  },
  retargetingActivityTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  retargetingActivityName: {
    display: 'block',
    color: '#111827',
    fontSize: 15,
  },
  retargetingStatusPill: {
    border: '1px solid',
    borderRadius: 999,
    padding: '3px 9px',
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    background: '#fff',
  },
  retargetingActivityMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    color: '#475569',
    fontSize: 12,
  },
  retargetingActivityNumbers: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))',
    gap: 8,
    marginTop: 12,
    color: '#334155',
    fontSize: 12,
  },
  retargetingMetricGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))',
    gap: 8,
    marginTop: 12,
  },
  retargetingMetricBox: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '8px 10px',
    background: '#f8fafc',
    display: 'grid',
    gap: 2,
    color: '#475569',
    fontSize: 12,
  },
  retargetingAnalysisDetails: {
    marginTop: 12,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '9px 10px',
    color: '#334155',
    fontSize: 13,
    background: '#fff',
  },
  retargetingAnalysisBody: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    marginTop: 10,
    lineHeight: 1.6,
  },
  retargetingActivityEditRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
    gap: 10,
    marginTop: 12,
  },
  retargetingActivityActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap',
  },
};
