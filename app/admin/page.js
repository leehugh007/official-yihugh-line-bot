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

// 訊息預覽元件：模擬 LINE Flex Message 樣式
function FlexPreview({ message, buttons }) {
  const cleanButtons = (buttons || []).filter((b) => b.label && b.url);
  if (!message && cleanButtons.length === 0) return null;

  const lines = (message || '').split('\n').filter((l) => l.trim());
  const title = lines[0] || '';
  const body = lines.slice(1).join('\n').trim();

  const hasFlex = cleanButtons.length > 0;

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
          <div style={{ padding: '14px 16px' }}>
            {title && <div style={{ fontWeight: 700, fontSize: 15, marginBottom: body ? 6 : 0, whiteSpace: 'pre-wrap' }}>{title}</div>}
            {body && <div style={{ fontSize: 13, color: '#666', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{body}</div>}
          </div>
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
          <PushHistory logs={logs} />
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

  if (isEditing) {
    return (
      <div style={styles.cardEditing}>
        <div style={styles.cardHeader}>
          <span style={styles.cardIcon}>{template.icon}</span>
          <span style={styles.cardName}>{template.name}</span>
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

        <FlexPreview message={editData.message} buttons={editData.buttons} />

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
              onSave({ ...dbData, buttons: cleanButtons });
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
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            style={{ ...styles.input, marginBottom: 4 }}
          />
          {scheduledAt && (
            <div style={{ fontSize: 12, color: '#8b5cf6' }}>
              將於 {new Date(scheduledAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })} 送出
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

      <FlexPreview message={data.message} buttons={data.buttons} />

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
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            style={styles.input}
          />
          {scheduledAt && (
            <div style={{ fontSize: 12, color: '#8b5cf6', marginTop: 4 }}>
              將於 {new Date(scheduledAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })} 送出
            </div>
          )}
        </>
      )}

      <div style={styles.editActions}>
        <span style={styles.targetInfo}>推給 {targetCount} 人</span>
        <button
          onClick={() => {
            const cleanButtons = data.buttons.filter((b) => b.label && b.url);
            onSend({ ...data, buttons: cleanButtons, scheduled_at: scheduledAt || undefined });
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
function DripTab({ dripStats, onUpdate }) {
  const [editingStep, setEditingStep] = useState(null);
  const [editData, setEditData] = useState({});

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

      {/* 文章列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {dripStats.schedule?.map((step) => {
          const isEditing = editingStep === step.step_number;
          const clickRate = step.sent_count > 0
            ? `${step.click_rate}%`
            : '-';

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

          return (
            <div key={step.step_number} style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 13, color: '#888', marginBottom: 2 }}>
                    {step.step_number === 1 ? `加入後 ${step.delay_days} 天` : `上一篇後 ${step.delay_days} 天`}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>
                    {step.title}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setEditingStep(step.step_number);
                    setEditData({
                      title: step.title,
                      message: step.message,
                      link_url: step.link_url || '',
                      link_text: step.link_text || '',
                    });
                  }}
                  style={styles.btnSmallGhost}
                >
                  ✏️ 編輯
                </button>
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13 }}>
                <span style={{ color: '#666' }}>已推 {step.sent_count} 人</span>
                <span style={{ color: '#2a9d6f', fontWeight: 500 }}>點擊 {step.click_count}（{clickRate}）</span>
              </div>
              {step.message === '（待填入訊息內容）' && (
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
      </div>
    </div>
  );
}

// ============================================================
// 推播紀錄
// ============================================================
function PushHistory({ logs }) {
  if (!logs.length) {
    return <p style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>尚無推播紀錄</p>;
  }

  return (
    <div style={styles.logList}>
      {logs.map((log) => {
        const date = new Date(log.created_at);
        const dateStr = date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
        const clickRate = log.click_count && log.sent_count
          ? `${Math.round((log.click_count / log.sent_count) * 100)}%`
          : null;

        return (
          <div key={log.id} style={styles.logItem}>
            <div style={styles.logTop}>
              <span style={styles.logDate}>{dateStr}</span>
              <span style={styles.logLabel}>{log.label}</span>
              <span style={{
                ...styles.statusBadge,
                background: log.status === 'completed' ? '#dcfce7' : '#fef3c7',
                color: log.status === 'completed' ? '#166534' : '#92400e',
              }}>
                {log.status === 'completed' ? '已完成' : log.status === 'sending' ? '發送中' : log.status}
              </span>
            </div>
            <div style={styles.logStats}>
              <span>{log.sent_count} 人送達</span>
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
            <div style={styles.logPreview}>
              {log.message.slice(0, 60)}{log.message.length > 60 ? '...' : ''}
            </div>
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
  seminar_info: { label: '說明會資訊', desc: '用戶傳「說明會」「直播」「講座」時的回覆' },
  pricing_info: { label: '課程方案', desc: '用戶傳「方案」「價格」「費用」時的回覆' },
  abc_info: { label: 'ABC 簡介', desc: '用戶傳「ABC」「怎麼瘦」「瘦身」時的回覆' },
  welcome_message: { label: '歡迎訊息', desc: '新用戶加入時的歡迎訊息（非測驗用戶）' },
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
