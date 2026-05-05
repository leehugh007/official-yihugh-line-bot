// /admin/user/[userId] — 用戶詳情頁
// handoff push 通知「開對話」連結點過來
// 顯示完整脈絡（Q1-Q4 答案 / 痛點 / v3.2 漏斗進度 / handoff 紀錄 / 報名紀錄）
// 婉馨看完再回 LINE 找學員聊
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Q3_OPTIONS } from '../../../../lib/conversation-path.js';

const PATH_ZH = {
  healthCheck: '健康檢查異常',
  rebound: '以前瘦過又復胖',
  postpartum: '產後',
  eatOut: '外食族',
  other: '其他',
};

const Q4_CONDITION_ZH = {
  ai_final_feedback: 'AI 動態回饋（DYNAMIC）',
  blood_sugar: '血糖紅字',
  cholesterol: '膽固醇紅字',
  blood_pressure: '血壓紅字',
};

const INTENT_ZH = {
  high: '🔥 高（很想瘦）',
  medium: '🟡 中（想瘦但有疑慮）',
  low: '🧊 低（觀望）',
};

// Q3 選項：「3」+ Q3_OPTIONS[path][3].label → 「3 — 血壓紅字」
function q3ChoiceLabel(path, q3Choice) {
  if (!q3Choice) return '—';
  const map = Q3_OPTIONS[path];
  if (!map) return q3Choice;
  const entry = map[Number(q3Choice)];
  if (!entry) return q3Choice;
  return `${q3Choice} — ${entry.label}`;
}

const METAB_ZH = {
  highRPM: '高轉速型',
  rollerCoaster: '雲霄飛車型',
  burnout: '燃燒殆盡型',
  powerSave: '省電模式型',
  steady: '穩定型',
};

const STAGE_ZH = {
  0: '未進入',
  1: 'Q1（體重）',
  2: 'Q2（目標）',
  3: 'Q3（痛點）',
  4: 'Q4（綜合回饋）',
  5: 'Handoff（人工接管）',
  6: 'V3.2 訊息 3 已推（看到價格）',
  7: '已點 /apply',
  8: '已報名',
};

const PROGRAM_ZH = {
  '12weeks': '12 週完整版',
  '4weeks_trial': '4 週體驗版',
};

const STATUS_ZH = {
  pending: '待付款',
  paid: '已付款',
  cancelled: '已取消',
};

const REASON_ZH = {
  q5_msg1_question: '訊息 1（承接故事）後問問題',
  q5_msg2_question: '訊息 2（介紹 ABC）後問問題',
  q5_msg3_question: '訊息 3（課程+早鳥）後問問題',
  q5_msg4_question: '訊息 4（最後提醒）後問問題',
  q5_msg1_freetext: '訊息 1（承接故事）後傳訊息',
  q5_msg2_freetext: '訊息 2（介紹 ABC）後傳訊息',
  q5_msg3_freetext: '訊息 3（課程+早鳥）後傳訊息',
  q5_msg4_freetext: '訊息 4（最後提醒）後傳訊息',
  want_enroll: '想報名',
  asked_price: '問價格',
  asked_family: '問家人',
  high_intent: '高意願',
  q4_continue: 'Q4「想聽聽」',
  q4_maybe: 'Q4「再考慮看看」',
  q4_ai_failed: 'Q4 AI 失敗',
  q4_story_question: '學員故事「有問題想問」',
  q4_followup_before_q5_wire: 'Q4 後有回應',
  q5_non_text_query: 'Q5 階段傳非文字',
};

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params?.userId;

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const secret = (typeof window !== 'undefined' && localStorage.getItem('admin_secret')) || '';
    if (!secret) {
      setError('請先登入 admin');
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/admin?action=user_detail&user_id=${userId}&secret=${secret}`);
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json?.error || `HTTP ${res.status}`);
          return;
        }
        setData(json);
      } catch (e) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  if (loading) {
    return <div style={S.page}><div style={S.center}>載入中…</div></div>;
  }

  if (error) {
    return (
      <div style={S.page}>
        <div style={S.header}>
          <button onClick={() => router.push('/admin')} style={S.backBtn}>← 返回 admin</button>
          <h1 style={S.headerTitle}>用戶詳情</h1>
        </div>
        <div style={S.section}>
          <div style={{ ...S.card, color: '#ef4444' }}>
            載入失敗：{error}
            {error === '請先登入 admin' && (
              <div style={{ marginTop: 12 }}>
                <a href="/admin" style={S.link}>→ 去登入</a>，登入後重新整理本頁
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { user, applications } = data;
  const ai = user.ai_tags || {};
  const pains = Array.isArray(ai['痛點']) ? ai['痛點'].map((x) => x?.value).filter(Boolean) : [];
  const hesitation = Array.isArray(ai['猶豫']) ? ai['猶豫'].map((x) => x?.value).filter(Boolean) : [];
  const focus = Array.isArray(ai['關注']) ? ai['關注'].map((x) => x?.value).filter(Boolean) : [];

  return (
    <div style={S.page}>
      <div style={S.header}>
        <button onClick={() => router.push('/admin')} style={S.backBtn}>← 返回 admin</button>
        <h1 style={S.headerTitle}>{user.display_name || '(無名)'}</h1>
        <div style={S.headerSub}>
          {PATH_ZH[user.path] || '路徑未定'}　·　第 {user.path_stage} 步：{STAGE_ZH[user.path_stage] || '?'}
        </div>
      </div>

      {/* 1. 基本資料 */}
      <div style={S.section}>
        <h2 style={S.sectionTitle}>👤 基本資料</h2>
        <div style={S.card}>
          <Row label="LINE userId" value={<code style={S.code}>{user.line_user_id}</code>} />
          <Row label="顯示名稱" value={user.display_name || '—'} />
          <Row label="代謝類型" value={METAB_ZH[user.metabolism_type] || user.metabolism_type || '未測'} />
          <Row label="來源" value={user.source || '—'} />
          <Row label="分群" value={user.segment || '—'} />
          <Row label="加入時間" value={fmt(user.joined_at)} />
          <Row label="互動次數" value={user.interaction_count} />
          <Row label="最後互動" value={fmt(user.last_interaction_at)} />
          <Row label="最後主動回覆" value={fmt(user.last_user_reply_at)} />
          {user.is_blocked && <Row label="封鎖" value={<span style={{ color: '#ef4444' }}>已封鎖（{fmt(user.blocked_at)}）</span>} />}
        </div>
      </div>

      {/* 2. Q1-Q4 對話路徑 */}
      <div style={S.section}>
        <h2 style={S.sectionTitle}>📋 Q1-Q4 答案</h2>
        <div style={S.card}>
          <Row label="體重 → 目標" value={
            user.current_weight && user.target_weight
              ? `${user.current_weight} → ${user.target_weight} 公斤（差 ${user.current_weight - user.target_weight}）`
              : '—'
          } />
          <Row label="路徑（Q3 主選）" value={PATH_ZH[user.path] || '—'} />
          <Row label="Q3 選項" value={q3ChoiceLabel(user.path, ai.q3_choice)} />
          <Row label="Q3 condition" value={Q4_CONDITION_ZH[ai.q3_condition_selected] || ai.q3_condition_selected || '—'} />
          <Row label="Q4 condition" value={Q4_CONDITION_ZH[ai.q4_condition] || ai.q4_condition || '—'} />
          <Row label="Q4 AI 分類時間" value={fmt(ai.q4_classified_at)} />
        </div>
      </div>

      {/* 3. AI tags 痛點 */}
      <div style={S.section}>
        <h2 style={S.sectionTitle}>🎯 AI tags（痛點 / 猶豫 / 關注）</h2>
        <div style={S.card}>
          <Row label="痛點" value={pains.length ? <TagList items={pains} color="#dc2626" /> : '—'} />
          <Row label="猶豫" value={hesitation.length ? <TagList items={hesitation} color="#d97706" /> : '—'} />
          <Row label="意願" value={INTENT_ZH[ai['意願']] || ai['意願'] || '—'} />
          <Row label="關注" value={focus.length ? <TagList items={focus} color="#2563eb" /> : '—'} />
        </div>
      </div>

      {/* 4. v3.2 漏斗進度 */}
      <div style={S.section}>
        <h2 style={S.sectionTitle}>🚀 V3.2 自動推進漏斗進度</h2>
        <div style={S.card}>
          <MsgRow n={1} label="訊息 1（承接故事）" user={user} />
          <MsgRow n={2} label="訊息 2（介紹 ABC）" user={user} />
          <MsgRow n={3} label="訊息 3（課程+三段價）" user={user} />
          <MsgRow n={4} label="訊息 4（最後提醒）" user={user} />
          <hr style={S.hr} />
          <Row label="點擊歸因（from_msg）" value={user.q5_apply_from_msg || '—'} />
          <Row label="首次點擊 /apply" value={fmt(user.q5_clicked_at)} />
          <Row label="總點擊次數" value={user.q5_click_count || 0} />
        </div>
      </div>

      {/* 5. handoff 紀錄 */}
      {user.handoff_triggered_at && (
        <div style={S.section}>
          <h2 style={S.sectionTitle}>🔴 Handoff 紀錄</h2>
          <div style={{ ...S.card, borderLeft: '4px solid #ef4444' }}>
            <Row label="觸發時間" value={fmt(user.handoff_triggered_at)} />
            <Row label="原因" value={
              <strong>{REASON_ZH[user.handoff_reason] || user.handoff_reason}</strong>
            } />
            <Row label="目前狀態" value={user.path_stage === 5 ? '🔴 仍在 Handoff 中（Bot 不會自動回）' : '已通過'} />
          </div>
        </div>
      )}

      {/* 6. 報名紀錄 */}
      {applications.length > 0 && (
        <div style={S.section}>
          <h2 style={S.sectionTitle}>📝 報名紀錄（{applications.length} 筆）</h2>
          {applications.map((app) => (
            <div key={app.id} style={S.card}>
              <div style={S.appHeader}>
                <div>
                  <strong>#{app.id}</strong>　·　{PROGRAM_ZH[app.program_choice] || app.program_choice}
                </div>
                <div style={{ ...S.statusChip, ...statusStyle(app.status) }}>
                  {STATUS_ZH[app.status] || app.status}
                </div>
              </div>
              <Row label="姓名" value={app.real_name} />
              <Row label="電話" value={app.phone} />
              <Row label="Email" value={app.email} />
              <Row label="地址" value={app.address} />
              <Row label="性別 / 年齡" value={`${app.gender || '—'} / ${app.age || '—'}`} />
              <Row label="報名時間" value={fmt(app.submitted_at)} />
              {app.paid_at && <Row label="付款時間" value={fmt(app.paid_at)} />}
              {app.payment_amount != null && <Row label="付款金額" value={`NT$ ${app.payment_amount}`} />}
              {app.payment_last5 && <Row label="後五碼" value={app.payment_last5} />}
              {app.notes && <Row label="備註" value={app.notes} />}
            </div>
          ))}
        </div>
      )}

      <div style={{ ...S.section, paddingBottom: 40 }}>
        <a href="/admin" style={S.link}>← 返回 admin 首頁</a>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={S.row}>
      <div style={S.rowLabel}>{label}</div>
      <div style={S.rowValue}>{value}</div>
    </div>
  );
}

function MsgRow({ n, label, user }) {
  const sent = user[`q5_msg${n}_sent_at`];
  const replied = user[`q5_msg${n}_replied_at`];
  const maybe = user[`q5_msg${n}_maybe_at`];
  const question = user[`q5_msg${n}_question_at`];

  let status = '—';
  let color = '#999';
  if (question) { status = `❓ 問問題（${fmt(question)}）→ Handoff`; color = '#dc2626'; }
  else if (maybe) { status = `🟡 我再想想（${fmt(maybe)}）`; color = '#d97706'; }
  else if (replied) { status = `✅ 已推進下一段（${fmt(replied)}）`; color = '#16a34a'; }
  else if (sent) { status = `📤 已推送（${fmt(sent)}），未按按鈕`; color = '#2563eb'; }

  return (
    <div style={S.row}>
      <div style={S.rowLabel}>{label}</div>
      <div style={{ ...S.rowValue, color }}>{status}</div>
    </div>
  );
}

function TagList({ items, color }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map((t, i) => (
        <span key={i} style={{
          padding: '3px 10px',
          borderRadius: 12,
          background: color + '15',
          color,
          fontSize: 13,
          fontWeight: 500,
        }}>{t}</span>
      ))}
    </div>
  );
}

function statusStyle(status) {
  if (status === 'paid') return { background: '#16a34a15', color: '#16a34a' };
  if (status === 'cancelled') return { background: '#99999915', color: '#666' };
  return { background: '#d9770615', color: '#d97706' };
}

const S = {
  page: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    background: '#f4f6f5',
    minHeight: '100vh',
  },
  center: { padding: 40, textAlign: 'center', color: '#888' },
  header: {
    background: 'linear-gradient(135deg, #1a7a52, #2a9d6f)',
    padding: '16px 20px 20px',
    color: '#fff',
  },
  headerTitle: { fontSize: 22, fontWeight: 700, margin: '8px 0 4px' },
  headerSub: { fontSize: 13, opacity: 0.9 },
  backBtn: {
    background: 'rgba(255,255,255,0.15)',
    color: '#fff',
    border: 'none',
    padding: '4px 10px',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
  },
  section: { padding: '16px 16px 0' },
  sectionTitle: { fontSize: 16, fontWeight: 600, margin: '0 0 8px', color: '#1a1a1a' },
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: 16,
    border: '1px solid #e5e7eb',
    marginBottom: 12,
  },
  row: {
    display: 'flex',
    padding: '8px 0',
    borderBottom: '1px solid #f3f4f6',
    alignItems: 'flex-start',
    gap: 12,
  },
  rowLabel: { color: '#888', fontSize: 13, minWidth: 110, flexShrink: 0 },
  rowValue: { color: '#1a1a1a', fontSize: 14, flex: 1, wordBreak: 'break-word' },
  code: { fontFamily: 'monospace', fontSize: 12, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 },
  hr: { border: 'none', borderTop: '1px solid #e5e7eb', margin: '12px 0' },
  appHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  statusChip: { padding: '4px 12px', borderRadius: 14, fontSize: 13, fontWeight: 600 },
  link: { color: '#2a9d6f', fontSize: 14, textDecoration: 'none' },
};
