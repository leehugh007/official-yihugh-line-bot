// Q5 契約 v2.4 Ch.0.9 + Ch.11.3：/apply landing + 報名
//
// v4.2（2026-04-23 晚）整合說明會簡報素材：
//   - Ch.2 加科學段（被鎖住/冷凍庫/附加價值）
//   - Ch.4 細節升級：買兩個 framing 保留，內層改「四大系統」(知識/營養/運動/支持)
//     + 三大堅持 (不依賴產品/不挨餓/不受時空限制)
//     + 市面主流比拼表（瘦瘦針/手術/代餐/ABC）
//   - Ch.5 加雙人早鳥 $3,333/人 anchor 卡（限雙人團報，CTA 回 LINE 人工走，不改 form enum）
//   - 6 月班開放報名中（不寫具體日期）
//   - 「業界平均 10%」改「一般節食減重平均只有 10%」
//
// 視覺層（v4.1 保留）：
//   - Hero 漸層 + badge + 大字
//   - 章節 h2 emoji + 綠色下劃線
//   - Ch.3 storyCard 左綠 accent
//   - Ch.4 anchorCard 數字圓圈 + Bullet list
//   - Ch.5 planCard 推薦徽章
//
// 雙人早鳥不進 form enum（program_choice 仍只接 12weeks / 4weeks_trial），
// 避免動 schema / RPC。視覺顯示「限雙人團報 → 回 LINE 找 fifi 辦」走人工。

'use client';

import { useEffect, useMemo, useState } from 'react';

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID || '';
const HMAC_KEYS = ['userid', 'source', 'trigger', 'kv', 'ts', 'sig'];
const CONTACT_LINE_URL =
  'https://line.me/R/oaMessage/%40sososo/?%E6%88%91%E8%A6%81%E5%A0%B1%E5%90%8D';
const DUO_CONTACT_URL =
  'https://line.me/R/oaMessage/%40sososo/?%E9%9B%99%E4%BA%BA%E6%97%A9%E9%B3%A5';
// Artemis 線上減重班官方 LINE（用於通知付款 + 核對帳務）
const ARTEMIS_PAY_URL =
  'https://line.me/R/oaMessage/%40artemis_fit/?%E6%88%91%E5%B7%B2%E5%AE%8C%E6%88%90%E5%8C%AF%E6%AC%BE%EF%BC%8C%E5%BE%8C%E4%BA%94%E7%A2%BC%EF%BC%9A';
const PROGRAM_URL = 'https://abcmetabolic.com/program';

// ==================== Design tokens ====================
const C = {
  primary: '#06c755',
  primaryDark: '#0b6e39',
  primaryLight: '#f0fff5',
  accent: '#0d5c3a',
  warm: '#fef7ec',
  warmBorder: '#f4e0b8',
  highlight: '#fff3cd',
  text: '#1a1a1a',
  textMid: '#3a3a3a',
  textLight: '#757575',
  border: '#e5e5e5',
  borderLight: '#eeeeee',
  error: '#e4572e',
  errorBg: '#fff0ee',
  cold: '#e8f1f8',
  coldBorder: '#b8d4e8',
};

const S = {
  page: {
    maxWidth: 720,
    margin: '0 auto',
    padding: '0 0 80px',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", sans-serif',
    lineHeight: 1.85,
    color: C.text,
    fontSize: 16,
    background: '#fafafa',
  },

  hero: {
    background: `linear-gradient(180deg, ${C.warm} 0%, #fff 100%)`,
    padding: '60px 24px 48px',
    textAlign: 'center',
    borderBottom: `1px solid ${C.borderLight}`,
  },
  heroBadge: {
    display: 'inline-block',
    padding: '6px 14px',
    background: C.primaryLight,
    color: C.primaryDark,
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: 1,
    marginBottom: 20,
  },
  heroTitle: {
    fontSize: 34,
    lineHeight: 1.25,
    fontWeight: 800,
    margin: '0 0 20px',
    letterSpacing: -0.5,
    color: C.text,
  },
  heroSub: {
    fontSize: 17,
    lineHeight: 2,
    color: C.textMid,
    margin: '0 auto 28px',
    maxWidth: 540,
  },
  heroCTA: { fontSize: 14, color: C.textLight, margin: 0 },
  heroArrow: { fontSize: 24, color: C.primary, marginTop: 16 },

  section: { padding: '56px 20px 16px' },
  h2Wrapper: { marginBottom: 32 },
  h2Emoji: { fontSize: 32, display: 'block', marginBottom: 8 },
  h2: {
    fontSize: 26,
    lineHeight: 1.35,
    fontWeight: 800,
    margin: 0,
    letterSpacing: -0.3,
    color: C.text,
  },
  h2Underline: {
    display: 'block',
    width: 48,
    height: 4,
    background: C.primary,
    borderRadius: 2,
    marginTop: 14,
  },
  h3: {
    fontSize: 19,
    lineHeight: 1.45,
    fontWeight: 700,
    margin: '28px 0 10px',
    color: C.text,
  },
  para: { margin: '0 0 14px', color: C.textMid },
  paraGap: { marginTop: 32 },
  emphasis: { fontWeight: 700, color: C.text },
  highlight: {
    background: C.highlight,
    padding: '2px 4px',
    borderRadius: 3,
    fontWeight: 700,
    color: C.text,
  },
  quoteBlock: {
    borderLeft: `3px solid ${C.primary}`,
    background: C.primaryLight,
    padding: '14px 20px',
    margin: '14px 0',
    borderRadius: '0 6px 6px 0',
    color: C.textMid,
    fontSize: 16,
  },
  coldBox: {
    background: C.cold,
    border: `1px solid ${C.coldBorder}`,
    borderRadius: 10,
    padding: '18px 20px',
    margin: '20px 0',
  },

  storyCard: {
    background: '#fff',
    borderLeft: `4px solid ${C.primary}`,
    borderRadius: '0 10px 10px 0',
    padding: '20px 22px',
    margin: '20px 0',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
  },
  storyName: { fontSize: 18, fontWeight: 700, margin: '0 0 4px', color: C.text },
  storyWeight: {
    fontSize: 15,
    color: C.primaryDark,
    fontWeight: 600,
    margin: '0 0 14px',
  },

  anchorCard: {
    background: '#fff',
    border: `1px solid ${C.borderLight}`,
    borderRadius: 12,
    padding: '24px 22px',
    margin: '20px 0',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
  },
  anchorHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    paddingBottom: 14,
    borderBottom: `1px solid ${C.borderLight}`,
  },
  anchorNum: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: C.primary,
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    fontSize: 16,
    flexShrink: 0,
  },
  anchorTitle: {
    fontSize: 17,
    fontWeight: 700,
    color: C.text,
    margin: 0,
    lineHeight: 1.4,
  },
  bulletItem: { display: 'flex', gap: 10, margin: '10px 0', color: C.textMid },
  bulletDot: {
    color: C.primary,
    fontWeight: 800,
    flexShrink: 0,
    fontSize: 18,
    lineHeight: '24px',
  },
  bigNumber: { fontSize: 22, fontWeight: 800, color: C.primaryDark },

  systemItem: {
    padding: '14px 0',
    borderTop: `1px dashed ${C.borderLight}`,
  },
  systemHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  systemEmoji: { fontSize: 22 },
  systemName: { fontSize: 16, fontWeight: 700, color: C.text },
  systemDesc: {
    fontSize: 15,
    color: C.textMid,
    margin: '4px 0 0',
    lineHeight: 1.7,
  },

  compareWrap: { margin: '28px 0 8px', overflowX: 'auto' },
  compareTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 14,
    background: '#fff',
    borderRadius: 10,
    overflow: 'hidden',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
  },
  compareTh: {
    background: '#f2f2f2',
    color: C.text,
    fontWeight: 700,
    padding: '12px 10px',
    textAlign: 'left',
    borderBottom: `2px solid ${C.border}`,
  },
  compareTd: {
    padding: '12px 10px',
    borderBottom: `1px solid ${C.borderLight}`,
    color: C.textMid,
    verticalAlign: 'top',
  },
  compareTdAbc: {
    padding: '12px 10px',
    borderBottom: `1px solid ${C.borderLight}`,
    background: C.primaryLight,
    color: C.text,
    fontWeight: 600,
  },
  compareX: { color: C.error, fontWeight: 800 },
  compareCheck: { color: C.primary, fontWeight: 800 },

  batchBadge: {
    display: 'inline-block',
    padding: '6px 14px',
    background: '#fff3cd',
    color: '#8a6d0e',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 700,
    margin: '0 0 20px',
  },
  planCard: {
    position: 'relative',
    background: '#fff',
    border: `2px solid ${C.border}`,
    borderRadius: 14,
    padding: '22px 22px',
    margin: '20px 0',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  planCardActive: {
    border: `2px solid ${C.primary}`,
    background: C.primaryLight,
    boxShadow: '0 4px 12px rgba(6, 199, 85, 0.15)',
  },
  planCardDuo: {
    border: `2px dashed ${C.warmBorder}`,
    background: C.warm,
    cursor: 'default',
  },
  planBadge: {
    position: 'absolute',
    top: -12,
    left: 20,
    background: C.primary,
    color: '#fff',
    fontSize: 13,
    fontWeight: 700,
    padding: '4px 12px',
    borderRadius: 999,
    letterSpacing: 0.5,
  },
  planBadgeDuo: {
    position: 'absolute',
    top: -12,
    left: 20,
    background: '#d49a0b',
    color: '#fff',
    fontSize: 13,
    fontWeight: 700,
    padding: '4px 12px',
    borderRadius: 999,
    letterSpacing: 0.5,
  },
  planTitle: {
    fontSize: 18,
    fontWeight: 700,
    marginLeft: 30,
    color: C.text,
  },
  planTitleDuo: {
    fontSize: 18,
    fontWeight: 700,
    marginTop: 6,
    color: C.text,
  },
  planPrice: {
    fontSize: 30,
    fontWeight: 800,
    color: C.primaryDark,
    margin: '10px 0 2px',
  },
  planMeta: { color: C.textLight, fontSize: 13, margin: '0 0 14px' },
  planBulletList: { listStyle: 'none', padding: 0, margin: '14px 0 0' },
  planBullet: {
    display: 'flex',
    gap: 10,
    padding: '6px 0',
    color: C.textMid,
    fontSize: 15,
  },
  planCheckIcon: { color: C.primary, fontWeight: 800, flexShrink: 0 },

  refundBox: {
    background: C.warm,
    border: `1px solid ${C.warmBorder}`,
    borderRadius: 10,
    padding: '20px 22px',
    margin: '28px 0',
  },
  refundTitle: {
    fontSize: 17,
    fontWeight: 700,
    margin: '0 0 12px',
    color: C.text,
  },
  refundYes: {
    fontSize: 18,
    fontWeight: 800,
    color: C.primaryDark,
    marginRight: 4,
  },

  form: {
    background: '#fff',
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: '24px 22px',
    margin: '28px 0',
  },
  label: {
    display: 'block',
    fontWeight: 600,
    margin: '14px 0 6px',
    fontSize: 15,
    color: C.text,
  },
  input: {
    width: '100%',
    padding: '11px 14px',
    border: `1px solid #ddd`,
    borderRadius: 8,
    fontSize: 16,
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    background: '#fff',
  },
  inputErr: { borderColor: C.error },
  errText: { color: C.error, fontSize: 13, margin: '4px 0 0' },
  radioRow: { display: 'flex', gap: 16, flexWrap: 'wrap', margin: '6px 0' },
  radioLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
    fontSize: 15,
  },
  btn: {
    display: 'inline-block',
    padding: '16px 28px',
    background: C.primary,
    color: 'white',
    textDecoration: 'none',
    borderRadius: 10,
    fontSize: 17,
    fontWeight: 700,
    border: 'none',
    cursor: 'pointer',
    width: '100%',
    marginTop: 24,
    boxShadow: '0 2px 8px rgba(6, 199, 85, 0.25)',
  },
  btnDisabled: {
    background: '#bdbdbd',
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  btnSecondary: {
    display: 'inline-block',
    padding: '10px 20px',
    background: '#f5f5f5',
    color: '#333',
    textDecoration: 'none',
    borderRadius: 8,
    fontSize: 15,
    margin: '4px 8px 4px 0',
  },
  btnDuo: {
    display: 'inline-block',
    padding: '10px 18px',
    background: '#d49a0b',
    color: '#fff',
    textDecoration: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 700,
    marginTop: 10,
  },
  warnBox: {
    background: C.warm,
    border: `1px solid ${C.warmBorder}`,
    borderRadius: 10,
    padding: '16px 18px',
    margin: '20px 0',
    fontSize: 14,
    lineHeight: 1.75,
  },
  errBox: {
    background: C.errorBg,
    border: `1px solid ${C.error}`,
    borderRadius: 8,
    padding: '14px 16px',
    margin: '20px 0',
    fontSize: 14,
    color: '#b23a1f',
  },

  signature: {
    textAlign: 'center',
    margin: '56px 0 0',
    color: C.textLight,
    fontSize: 15,
    fontStyle: 'normal',
    padding: '0 20px',
  },
  divider: {
    width: 48,
    height: 3,
    background: C.primary,
    borderRadius: 2,
    margin: '40px auto 20px',
    opacity: 0.5,
  },
};

function extractHmacParams() {
  if (typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search);
  const out = {};
  for (const k of HMAC_KEYS) {
    const v = p.get(k);
    if (!v) return null;
    out[k] = v;
  }
  return out;
}

function SectionHeading({ emoji, title }) {
  return (
    <div style={S.h2Wrapper}>
      <span style={S.h2Emoji}>{emoji}</span>
      <h2 style={S.h2}>{title}</h2>
      <span style={S.h2Underline} />
    </div>
  );
}

function StoryCard({ name, weight, children }) {
  return (
    <div style={S.storyCard}>
      <p style={S.storyName}>{name}</p>
      {weight && <p style={S.storyWeight}>{weight}</p>}
      {children}
    </div>
  );
}

function Bullet({ children }) {
  return (
    <p style={S.bulletItem}>
      <span style={S.bulletDot}>—</span>
      <span>{children}</span>
    </p>
  );
}

function SystemItem({ emoji, name, children }) {
  return (
    <div style={S.systemItem}>
      <div style={S.systemHeader}>
        <span style={S.systemEmoji}>{emoji}</span>
        <span style={S.systemName}>{name}</span>
      </div>
      <p style={S.systemDesc}>{children}</p>
    </div>
  );
}

export default function ApplyPage() {
  const [liffReady, setLiffReady] = useState(false);
  const [liffDisplayName, setLiffDisplayName] = useState('');
  const [liffError, setLiffError] = useState('');

  const hmacParams = useMemo(() => extractHmacParams(), []);
  const hasValidUrl = !!hmacParams;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!LIFF_ID) {
        setLiffError('NEXT_PUBLIC_LIFF_ID not set');
        return;
      }
      try {
        const liff = (await import('@line/liff')).default;
        await liff.init({ liffId: LIFF_ID });
        try {
          if (liff.isLoggedIn && liff.isLoggedIn()) {
            const profile = await liff.getProfile();
            if (!cancelled && profile?.displayName) {
              setLiffDisplayName(profile.displayName);
            }
          }
        } catch (_) {}
        if (!cancelled) setLiffReady(true);
        if (hmacParams) {
          fetch('/api/apply/visit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(hmacParams),
          }).catch((e) => console.warn('[apply] visit failed:', e));
        }
      } catch (err) {
        if (!cancelled) setLiffError(err?.message || String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hmacParams]);

  const [form, setForm] = useState({
    real_name: '',
    phone: '',
    email: '',
    address: '',
    gender: '',
    age: '',
    line_id: '',
    program_choice: '12weeks',
    agreed_refund_policy: false,
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const validate = () => {
    const errs = {};
    if (!form.real_name.trim() || form.real_name.length > 50) errs.real_name = '請填姓名';
    if (!/^09\d{8}$/.test(form.phone)) errs.phone = '手機格式：09 開頭 10 碼';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = '請填正確的 Email';
    if (form.address.trim().length < 5) errs.address = '請填完整地址';
    if (!['male', 'female', 'other'].includes(form.gender)) errs.gender = '請選擇性別';
    const age = parseInt(form.age, 10);
    if (!Number.isInteger(age) || age < 18 || age > 99) errs.age = '年齡 18-99';
    if (!['12weeks', '4weeks_trial'].includes(form.program_choice))
      errs.program_choice = '請選擇方案';
    if (!form.agreed_refund_policy) errs.agreed_refund_policy = '請勾選同意退費條款';
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitErr('');
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    if (!hmacParams) {
      setSubmitErr('這個頁面需要在 LINE 裡開啟。請回到 LINE 傳訊息告訴一休。');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        ...hmacParams,
        real_name: form.real_name.trim(),
        phone: form.phone,
        email: form.email.trim(),
        address: form.address.trim(),
        gender: form.gender,
        age: parseInt(form.age, 10),
        line_id: form.line_id ? form.line_id.trim() : null,
        display_name: liffDisplayName || null,
        program_choice: form.program_choice,
        agreed_refund_policy: true,
      };
      const res = await fetch('/api/apply/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        if (json.error === 'invalid_form') {
          const fieldErrs = {};
          (json.fields || []).forEach((f) => {
            fieldErrs[f] = '這個欄位有問題';
          });
          setFieldErrors(fieldErrs);
          setSubmitErr('表單有幾處需要修正，往上看紅字。');
        } else if (json.error === 'invalid_signature') {
          setSubmitErr('連結可能已過期。請回到 LINE 傳訊息告訴一休，他會給你新的連結。');
        } else if (json.error === 'user_not_found') {
          setSubmitErr('找不到你的帳號。請確認這個連結是從 LINE 傳給你的。');
        } else {
          setSubmitErr('系統有點忙，等 10 秒再送一次。');
        }
        return;
      }
      setSubmitted(true);
    } catch (err) {
      console.error('[apply] submit error:', err);
      setSubmitErr('網路連線不穩，確認網路後再送一次。');
    } finally {
      setSubmitting(false);
    }
  };

  // ============ Success 頁 ============
  if (submitted) {
    return (
      <div style={S.page}>
        <section style={{ ...S.hero, padding: '60px 24px 36px' }}>
          <span style={{ ...S.h2Emoji, fontSize: 48 }}>🌱</span>
          <h1 style={S.heroTitle}>收到了。</h1>
          <p style={S.heroSub}>
            接下來請<span style={S.emphasis}>完成匯款</span>，
            <br />
            然後到 <span style={S.emphasis}>@artemis_fit</span> 告訴我們，
            <br />
            我們確認後就會把你加進班級。
          </p>
        </section>

        {/* 匯款資訊 */}
        <section style={{ ...S.section, paddingTop: 24 }}>
          <SectionHeading emoji="💰" title="匯款資訊" />
          <div
            style={{
              background: '#fff8e1',
              border: '1px solid #f4d76e',
              borderRadius: 10,
              padding: '20px 22px',
              margin: '8px 0 0',
            }}
          >
            <p style={{ ...S.para, margin: '0 0 14px', fontSize: 13, color: C.textLight }}>
              請於報名後 3 天內完成匯款
            </p>
            <p
              style={{
                margin: '8px 0',
                display: 'flex',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 6,
              }}
            >
              <span style={{ color: C.textLight, fontSize: 14 }}>帳戶名稱</span>
              <span style={{ ...S.emphasis, fontSize: 16 }}>亞偍涐斯股份有限公司</span>
            </p>
            <p
              style={{
                margin: '8px 0',
                display: 'flex',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 6,
              }}
            >
              <span style={{ color: C.textLight, fontSize: 14 }}>銀行</span>
              <span style={{ ...S.emphasis, fontSize: 16 }}>永豐銀行（807）德惠分行</span>
            </p>
            <p
              style={{
                margin: '8px 0 0',
                display: 'flex',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 6,
                alignItems: 'center',
              }}
            >
              <span style={{ color: C.textLight, fontSize: 14 }}>帳號</span>
              <span
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: C.error,
                  letterSpacing: 0.5,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                158-018-0006795-9
              </span>
            </p>
          </div>
        </section>

        {/* 通知付款 */}
        <section style={{ ...S.section, paddingTop: 0 }}>
          <SectionHeading emoji="📨" title="匯款後通知我們" />
          <p style={S.para}>
            匯款完成後，請主動傳訊到「Artemis 線上減重班」官方 LINE：
          </p>
          <p
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: C.primaryDark,
              textAlign: 'center',
              margin: '14px 0 12px',
              letterSpacing: 0.5,
            }}
          >
            @artemis_fit
          </p>
          <p style={S.para}>
            告訴我們<span style={S.emphasis}>付款帳號後五碼</span>，我們確認後會把你加進班級。
          </p>
          <a style={{ ...S.btn, marginTop: 18 }} href={ARTEMIS_PAY_URL}>
            加入 @artemis_fit 通知付款 →
          </a>
          <p
            style={{
              ...S.para,
              fontSize: 13,
              color: C.textLight,
              marginTop: 14,
              textAlign: 'center',
            }}
          >
            遇到假日可能會慢一點，但我們一定會跟你聯絡。
          </p>
        </section>

        {/* 完整退費條款 */}
        <section style={S.section}>
          <SectionHeading emoji="📋" title="退費注意事項" />
          <div style={S.refundBox}>
            <p style={S.para}>
              如報名且付款完成後要取消課程，退款機制依下列辦法施行：
            </p>
            <ol
              style={{
                paddingLeft: 22,
                margin: '14px 0 8px',
                color: C.textMid,
                lineHeight: 1.85,
              }}
            >
              <li style={{ marginBottom: 8 }}>
                開課前一天退費將內扣匯款手續費後退還報名費用。
              </li>
              <li style={{ marginBottom: 8 }}>
                報名一個月方案者，課程開始當日後即不退費。
              </li>
              <li style={{ marginBottom: 8 }}>
                報名三個月方案者，扣除已開課月數（按一個月方案原價費用計）並酌收人事處理費 10%，退還剩餘費用。
              </li>
              <li style={{ marginBottom: 8 }}>
                退款帳號如非提供永豐銀行之帳戶，產生之額外手續費須自行承擔。
              </li>
              <li style={{ marginBottom: 8 }}>
                無論何時申請取消活動報名，我們將統一於公司最近一次匯款日處理退還事宜。
              </li>
              <li style={{ marginBottom: 0 }}>
                課程內容上述簡章已完整呈現，如還有問題請與我們詳細詢問是否符合自身需求。
              </li>
            </ol>
            <p
              style={{
                ...S.para,
                fontSize: 13,
                color: C.textLight,
                marginTop: 12,
                marginBottom: 0,
              }}
            >
              *開課月數：以 4 週為一個月。第一個月 1-4 週、第二個月 5-8 週、第三個月 9-12 週。
            </p>
          </div>
        </section>

        <p style={S.signature}>我是一休，陪你健康的瘦一輩子。</p>
      </div>
    );
  }

  // ============ Main Landing ============
  return (
    <div style={S.page}>
      {/* ==================== 第一章 Hero ==================== */}
      <section style={S.hero}>
        <span style={S.heroBadge}>ABC 代謝力重建</span>
        <h1 style={S.heroTitle}>
          你在找的，
          <br />
          不是瘦 10 公斤
        </h1>
        <p style={S.heroSub}>
          是那個穿得下、跑得動、早上起床不累的自己。
          <br />
          是照鏡子不用躲、跟孩子跑跳不會喘、
          <br />
          夏天不用再穿長袖遮手臂的自己。
          <br />
          <br />
          是吃飯不用算熱量、不用每餐糾結「我可以吃什麼」、
          <br />
          也不用每天為了體重跟自己較勁的日子。
        </p>
        <p style={S.heroCTA}>如果這些是你要的，往下看。</p>
        <div style={S.heroArrow}>↓</div>
      </section>

      {/* ==================== Hero 情緒鉤 (land001) ==================== */}
      <section style={{ padding: '8px 20px 0', textAlign: 'center' }}>
        <img
          src="/images/landing/land001.png"
          alt="「你不是控制不了，是身體壞掉了」—— 情緒插畫"
          style={{ width: '100%', maxWidth: 400, display: 'block', margin: '0 auto', borderRadius: 12 }}
        />
      </section>

      {/* ==================== 第二章 可能性 ==================== */}
      <section style={S.section}>
        <SectionHeading emoji="💭" title="我知道，因為我走過" />

        <img
          src="/images/landing/land015.webp"
          alt="一休本人 before/after：胖時的我 vs 瘦了 -25kg 之後的我"
          style={{ width: '100%', maxWidth: 400, display: 'block', margin: '8px auto 28px', borderRadius: 12 }}
        />

        <p style={S.para}>我不是天生瘦。</p>
        <p style={S.para}>
          跟你一樣，我也是那種<span style={S.highlight}>喝水都會胖</span>的體質。
        </p>
        <p style={S.para}>
          最胖的時候 <span style={S.emphasis}>89 公斤</span>。
          最瘦的時候 <span style={S.emphasis}>62 公斤</span>。
          中間復胖超過十次 —— 每一次我都以為「這次不會了」，每一次都失敗。
        </p>

        <p style={{ ...S.para, ...S.paraGap }}>但我不願意放棄。</p>
        <p style={S.para}>說實話，我討厭胖的自己。</p>
        <p style={S.para}>沒精神、氣色不好、體力差、穿衣服也不好看。</p>
        <p style={S.para}>連我自己都不愛自己，別人怎麼會愛我。</p>
        <p style={S.para}>
          <span style={S.emphasis}>我想先好好愛自己。所以我開始改變。</span>
        </p>

        <p style={{ ...S.para, ...S.paraGap }}>
          我瘋狂學習、實踐，尋找真正能瘦一輩子的方法。
        </p>
        <p style={S.para}>
          高中的時候，我一天只吃蘋果，瘦了 7 公斤，一週後胖回 6 公斤。
        </p>
        <p style={S.para}>
          後來我每天跑五到十公里，一天吃 1,300 卡。人是瘦下來了，
          但整天都在想食物 —— 一恢復正常吃，馬上彈回來。
        </p>
        <p style={S.para}>近 20 年，我什麼方式都試過 —— 節食、斷食、代餐、瘋狂運動。</p>
        <p style={S.para}>每一個都瘦過。每一個都復胖了。</p>

        <img
          src="/images/landing/land002.png"
          alt="「我已經試到不知道還能試什麼了」—— 節食/運動/暴食循環插畫"
          style={{ width: '100%', maxWidth: 400, display: 'block', margin: '32px auto', borderRadius: 12 }}
        />

        <p style={{ ...S.para, ...S.paraGap }}>
          我受夠減肥的苦了。吃著不愛吃的東西，做著痛苦的運動。
        </p>
        <p style={S.para}>直到我慢慢明白 ——</p>
        <div style={S.quoteBlock}>
          <span style={{ fontSize: 18, fontWeight: 700, color: C.text }}>
            真正最好的瘦身，是你不覺得你在減肥。
          </span>
          <br />
          <br />
          沒有剝奪感。每一口放進嘴裡的食物，都是你發自內心想吃，也是有意識的選擇。
        </div>

        {/* v4.2 新增科學段 */}
        <p style={{ ...S.para, ...S.paraGap }}>
          那時候我才回頭看，才懂之前那些方法為什麼沒用 ——
        </p>
        <p style={S.para}>
          <span style={S.emphasis}>
            不是我意志力輸，是我的身體根本不在「會瘦」的狀態。
          </span>
        </p>

        <img
          src="/images/landing/land003.png"
          alt="「不是你不自律，是身體卡在會瘦的狀態」—— 身體被鎖住插畫"
          style={{ width: '100%', maxWidth: 400, display: 'block', margin: '32px auto', borderRadius: 12 }}
        />

        <div style={S.coldBox}>
          <p style={{ ...S.para, margin: '0 0 10px', fontWeight: 700, color: C.text }}>
            你的身體不是壞掉，是<span style={S.highlight}>被鎖住了</span>：
          </p>
          <p style={{ ...S.para, margin: 0 }}>
            慢性發炎、胰島素阻抗、能量工廠停擺 —— 脂肪被鎖在「冷凍庫」裡，怎麼挖都挖不出來。
          </p>
        </div>
        <p style={S.para}>
          這時候再去少吃、再去運動，只是在消耗一個已經過勞的身體，不是在瘦。
        </p>
        <p style={{ ...S.para, marginTop: 18 }}>所以方法是反過來的 ——</p>
        <p style={S.para}>
          不是逼身體用力，是先把鎖打開。給它營養、讓它不發炎、讓代謝機器自己轉。
        </p>
        <p style={S.para}>
          <span style={S.highlight}>瘦下來，只是身體變健康之後的「附加價值」。</span>
        </p>

        <img
          src="/images/landing/land004.png"
          alt="「你不用再用力，身體自己會開始變瘦」—— 解鎖後的狀態插畫"
          style={{ width: '100%', maxWidth: 400, display: 'block', margin: '32px auto', borderRadius: 12 }}
        />

        <p style={{ ...S.para, marginTop: 18 }}>
          這個方法，我後來叫它 <span style={S.emphasis}>ABC 代謝力重建</span>。
        </p>

        <p style={{ ...S.para, ...S.paraGap }}>因為我胖過、我痛過、我受過苦。</p>
        <p style={S.para}>
          也因為我胖過，我才有辦法解決跟曾經的我一樣、還在痛苦裡的人。
        </p>
        <p style={S.para}>
          過去 4 年，我們幫助超過
          <span style={S.bigNumber}>3,000</span> 個學員，
          一起瘦掉超過 <span style={S.bigNumber}>三萬公斤</span>。
        </p>
        <p style={S.para}>
          我從每一個學員身上看到改變、看到他們綻放的光芒 —— 那是我最大的成就。
        </p>
      </section>

      {/* ==================== 第三章 確定感 ==================== */}
      <section style={S.section}>
        <SectionHeading emoji="🌸" title="她們做到了" />
        <p style={S.para}>你不用相信我。看看她們。</p>

        <img
          src="/images/landing/land006.png"
          alt="「產後肚子真的回得去」—— 學員產後 before/after"
          style={{ width: '100%', maxWidth: 400, display: 'block', margin: '32px auto', borderRadius: 12 }}
        />

        <StoryCard name="沛蓁" weight="85 → 67 kg（−18 kg）">
          <p style={S.para}>
            她煮雞湯要征服老公的胃。結果老公的胃是征服了，外人卻把她認成老公的媽媽。
          </p>
          <p style={S.para}>
            她沒有節食，沒有吃藥。她是<span style={S.emphasis}>吃飽</span>瘦下來的。
          </p>
          <div style={S.quoteBlock}>「以前我從來沒想過減肥可以吃飽。」</div>
        </StoryCard>

        <img
          src="/images/landing/land008.png"
          alt="沛蓁：她曾經被誤認是他媽媽 —— before/after 對比"
          style={{ width: '100%', maxWidth: 400, display: 'block', margin: '32px auto', borderRadius: 12 }}
        />

        <StoryCard name="慧蘭" weight="53 歲，比 7 年前更年輕">
          <p style={S.para}>她先生胃痛，查出來是癌症，三週就走了。</p>
          <p style={S.para}>她那時 46 歲，下一餐都不知道怎麼吃。</p>
          <p style={S.para}>
            七年後，她 53 歲，比七年前還年輕。
            不是化妝，是身體裡面的狀態換了。
          </p>
          <div style={S.quoteBlock}>
            「不再需要零食、不再跟食物打架」—— 她說這是她這輩子想都沒想過會有的感覺。
          </div>
        </StoryCard>

        <img
          src="/images/landing/land007.png"
          alt="慧蘭：53 歲，她還在變瘦 —— before/after 對比"
          style={{ width: '100%', maxWidth: 400, display: 'block', margin: '32px auto', borderRadius: 12 }}
        />

        <StoryCard name="俐臻" weight="127 → 65 kg（一年 −62 kg）">
          <p style={S.para}>她原本連穿襪子都要女兒幫忙彎腰。</p>
          <p style={S.para}>她以前覺得自己這輩子就這樣了，胖是她的命。</p>
          <div style={S.quoteBlock}>「原來胖是給我改變的機會。」</div>
          <p style={{ ...S.para, marginTop: 14 }}>
            她學會的不是「怎麼瘦」，是<span style={S.emphasis}>怎麼溫柔對自己</span>。
          </p>
        </StoryCard>

        <StoryCard name="溫溫" weight="產後三個月 −10 kg">
          <p style={S.para}>她生完小孩之後，陷在暴食跟自責的循環裡三年。</p>
          <p style={S.para}>
            來我這裡之後，第一次發現 —— 原來瘦身可以吃飽、可以不用餓肚子。
          </p>
          <p style={S.para}>三個月瘦十公斤。更重要的是，她家人也跟著改變了。</p>
        </StoryCard>

        <img
          src="/images/landing/land005.png"
          alt="溫溫：「她沒有更努力，她只是換對方法」—— 不挨餓，讓身體自己變瘦"
          style={{ width: '100%', maxWidth: 400, display: 'block', margin: '32px auto', borderRadius: 12 }}
        />

        <StoryCard name="美美" weight="拒絕抽脂的那個選擇">
          <p style={S.para}>
            她姐姐做過切胃手術。瘦下來，又胖回去，而且胖了更多。
          </p>
          <p style={S.para}>美美去醫美諮詢抽脂，最後決定不做。</p>
          <div style={S.quoteBlock}>「我不要再走一次我姐的路。」</div>
          <p style={{ ...S.para, marginTop: 14 }}>她選擇用這個方法，一次做對。</p>
        </StoryCard>

        <img
          src="/images/landing/land009.png"
          alt="美美：她原本已經準備去抽脂 —— before/after 對比"
          style={{ width: '100%', maxWidth: 400, display: 'block', margin: '32px auto', borderRadius: 12 }}
        />

        <p style={{ ...S.para, marginTop: 36 }}>我知道每個人的處境不一樣。</p>
        <p style={S.para}>
          但每一個走進來的學員，都是從「我試過太多次了，大概就這樣了」開始的。
        </p>
        <p style={S.para}>
          <span style={S.emphasis}>她們不是比你厲害。她們只是換了一個方向。</span>
        </p>
      </section>

      {/* ==================== 第四章 心理錨點 ==================== */}
      <section style={S.section}>
        <SectionHeading emoji="💎" title="這不是一門課的費用" />
        <p style={S.para}>
          <span style={S.emphasis}>你在買兩個東西。</span>
        </p>

        <img
          src="/images/landing/land010.png"
          alt="「這不是一門課的費用，你在買兩個東西」—— 支援系統 + 被驗證過的方法"
          style={{ width: '100%', maxWidth: 400, display: 'block', margin: '32px auto', borderRadius: 12 }}
        />

        {/* 買第一個：四大支援系統 */}
        <div style={S.anchorCard}>
          <div style={S.anchorHeader}>
            <div style={S.anchorNum}>1</div>
            <h3 style={S.anchorTitle}>你在買一整套支援系統</h3>
          </div>
          <p style={S.para}>你不是買一套「拍一拍上傳」的錄播課。</p>
          <p style={{ ...S.para, marginBottom: 6 }}>
            你買的是這 <span style={S.emphasis}>4 個缺一不可</span>的系統：
          </p>

          <img
            src="/images/landing/land012.png"
            alt="「12 週，四大系統」—— 一休親授課 / 營養師看餐 / 線上運動課 / 團體陪伴"
            style={{ width: '100%', maxWidth: 400, display: 'block', margin: '20px auto 28px', borderRadius: 12 }}
          />

          <SystemItem emoji="📚" name="ABC 代謝力重建瘦身系統">
            我每週親自直播帶你 —— <span style={S.emphasis}>12 堂直播 + 24 堂錄播</span>
            ，從代謝原理講到每天的選擇。不是上完就放著的課，是走一季的陪伴。
          </SystemItem>

          <SystemItem emoji="🥗" name="營養系統">
            <span style={S.emphasis}>15 位國家高考合格的營養師</span>
            ，每天看你的餐、回你的問題。
            不是一個月看一次，<span style={S.highlight}>是每天</span>。
          </SystemItem>

          <SystemItem emoji="🏃" name="運動系統">
            <span style={S.emphasis}>150+ 堂運動課</span>
            ，教練線上帶、有強度分層、有姿勢矯正。零基礎到進階都有自己的路徑。
          </SystemItem>

          <SystemItem emoji="🤝" name="支持系統">
            一整班的學員陪你走。有
            <span style={S.emphasis}>教練、助教、班長</span>。
            不是你一個人跟網路課對話，是一群人一起往同一個方向走。
          </SystemItem>

          <img
            src="/images/landing/land011.png"
            alt="「你不是買錄播課，你買的是一整季真人陪伴」—— 休校長直播 / 營養師看餐 / 教練帶練 / 同學同行"
            style={{ width: '100%', maxWidth: 400, display: 'block', margin: '24px auto 4px', borderRadius: 12 }}
          />
        </div>

        {/* 買第二個：被驗證過的方法 */}
        <div style={S.anchorCard}>
          <div style={S.anchorHeader}>
            <div style={S.anchorNum}>2</div>
            <h3 style={S.anchorTitle}>你在買一個被驗證過的方法</h3>
          </div>
          <p style={S.para}>這個方法不只是理論。</p>
          <p style={{ ...S.para, fontSize: 18 }}>
            更重要的是 —— <span style={S.bigNumber}>維持率 70%</span>。
          </p>
          <p style={S.para}>
            一般節食減重平均只有 <span style={S.emphasis}>10%</span> 的維持率。
            也就是 10 個瘦下來的人，9 個會胖回去。
          </p>
          <p style={S.para}>
            這個方法的學員，<span style={S.highlight}>10 個裡面有 7 個沒有復胖</span>。
          </p>

          <img
            src="/images/landing/land013.png"
            alt="「真正重要的不是瘦下來，是不要再胖回去」—— 一般節食 10 個 9 個復胖 vs ABC 10 個 7 個沒復胖"
            style={{ width: '100%', maxWidth: 400, display: 'block', margin: '24px auto', borderRadius: 12 }}
          />

          <p style={{ ...S.para, marginTop: 22, fontWeight: 700, color: C.text }}>
            為什麼做得到？因為這個方法堅持三件事：
          </p>
          <Bullet>
            <span style={S.emphasis}>不依賴產品</span>
            。拒絕瘦瘦針、減肥藥、代餐。只用真正的天然食物。
          </Bullet>
          <Bullet>
            <span style={S.emphasis}>不挨餓</span>
            。食物是啟動代謝的燃料 —— 每一餐都要吃得滿足。
          </Bullet>
          <Bullet>
            <span style={S.emphasis}>不受時空限制</span>
            。無論你是全外食、家庭主婦、應酬多、過年過節，這套系統都能融入你的真實生活。
          </Bullet>

          <p style={{ ...S.para, marginTop: 22, fontWeight: 700, color: C.text }}>
            結果是 ——
          </p>
          <Bullet>
            <span style={S.emphasis}>不算熱量</span>。每一餐都吃飽。
          </Bullet>
          <Bullet>
            <span style={S.emphasis}>不復胖</span>
            。你不是瘦一次，是這輩子不用再做這件事。
          </Bullet>
          <Bullet>
            <span style={S.emphasis}>教你重建一個健康的自己</span>
            。方法進你身體裡，不用隨身帶著食譜過日子。
          </Bullet>
        </div>

        {/* 市面比拼 */}
        <h3 style={{ ...S.h3, marginTop: 40, textAlign: 'center' }}>
          ⚖️ 比一比市面主流減重法
        </h3>
        <div style={S.compareWrap}>
          <table style={S.compareTable}>
            <thead>
              <tr>
                <th style={S.compareTh}>方法</th>
                <th style={S.compareTh}>問題</th>
                <th style={S.compareTh}>長期？</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={S.compareTd}>瘦瘦針（Ozempic）</td>
                <td style={S.compareTd}>高風險、停藥幾乎 100% 復胖、高成本</td>
                <td style={{ ...S.compareTd, textAlign: 'center' }}>
                  <span style={S.compareX}>✕</span>
                </td>
              </tr>
              <tr>
                <td style={S.compareTd}>減重手術</td>
                <td style={S.compareTd}>不可逆副作用、仍要看飲食習慣、極高成本</td>
                <td style={{ ...S.compareTd, textAlign: 'center' }}>
                  <span style={S.compareX}>✕</span>
                </td>
              </tr>
              <tr>
                <td style={S.compareTd}>直銷代餐</td>
                <td style={S.compareTd}>依賴單一產品、停掉就反彈、每月 $1–6 萬</td>
                <td style={{ ...S.compareTd, textAlign: 'center' }}>
                  <span style={S.compareX}>✕</span>
                </td>
              </tr>
              <tr>
                <td style={S.compareTdAbc}>ABC 代謝力重建</td>
                <td style={S.compareTdAbc}>治本無副作用、重建代謝、長期投資</td>
                <td style={{ ...S.compareTdAbc, textAlign: 'center' }}>
                  <span style={S.compareCheck}>✓</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p style={{ ...S.para, marginTop: 18, fontSize: 14, color: C.textLight }}>
          差別不是「你選哪個」，是「你要一次搞定，還是繼續試」。
        </p>

        <p style={{ ...S.para, ...S.paraGap }}>
          你過去花在瘦身上的錢，加一加，會比這筆多。
        </p>
        <p style={S.para}>差別是 —— 過去那些錢，買的是「再試一次」。</p>
        <p style={S.para}>
          <span style={S.highlight}>這一筆，買的是「不用再試了」。</span>
        </p>

        <img
          src="/images/landing/land014.png"
          alt="「過去那些錢買的是再試一次，這一筆買的是不用再試了」—— 代餐/節食/醫美/健身卡/保健品失敗單據"
          style={{ width: '100%', maxWidth: 400, display: 'block', margin: '32px auto 0', borderRadius: 12 }}
        />
      </section>

      {/* ==================== 第五章 方案 + 報名 ==================== */}
      <section style={S.section}>
        <SectionHeading emoji="🌿" title="如果你準備好了" />
        <p style={S.para}>如果你看到這裡還沒關掉，我想你已經準備好了。</p>
        <div>
          <span style={S.batchBadge}>📅 6 月班｜開放報名中</span>
        </div>

        {/* 方案 A */}
        <div
          style={{
            ...S.planCard,
            ...(form.program_choice === '12weeks' ? S.planCardActive : {}),
          }}
          onClick={() => setField('program_choice', '12weeks')}
        >
          <span style={S.planBadge}>⭐ 推薦</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 6 }}>
            <input
              type="radio"
              name="program"
              checked={form.program_choice === '12weeks'}
              onChange={() => setField('program_choice', '12weeks')}
            />
            <span style={S.planTitle}>代謝力重建 12 週完整版</span>
          </label>
          <p style={S.planPrice}>NT$ 3,800 <span style={{ fontSize: 18, fontWeight: 600 }}>/ 月</span></p>
          <p style={S.planMeta}>12 週完整版 · 總價 $11,400</p>
          <p style={S.para}>
            這是多數學員選的版本。代謝重建需要時間 —— 四週打基礎，八週讓身體習慣，
            十二週讓它變成你的生活。
          </p>
          <p style={{ ...S.para, marginTop: 16, fontWeight: 700 }}>你會拿到：</p>
          <ul style={S.planBulletList}>
            <li style={S.planBullet}>
              <span style={S.planCheckIcon}>✓</span>
              <span>一休親自直播 12 堂 + 錄播課 24 堂</span>
            </li>
            <li style={S.planBullet}>
              <span style={S.planCheckIcon}>✓</span>
              <span>15 位國家高考營養師，每天幫你看餐</span>
            </li>
            <li style={S.planBullet}>
              <span style={S.planCheckIcon}>✓</span>
              <span>24 堂營養課 + 150+ 堂運動課</span>
            </li>
            <li style={S.planBullet}>
              <span style={S.planCheckIcon}>✓</span>
              <span>班級制（教練、助教、班長全程陪伴）</span>
            </li>
            <li style={S.planBullet}>
              <span style={S.planCheckIcon}>✓</span>
              <span>
                <span style={S.emphasis}>加贈：一對一教練課 1 堂（價值 $2,000）</span>
              </span>
            </li>
          </ul>
        </div>

        {/* 方案 B */}
        <div
          style={{
            ...S.planCard,
            ...(form.program_choice === '4weeks_trial' ? S.planCardActive : {}),
          }}
          onClick={() => setField('program_choice', '4weeks_trial')}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input
              type="radio"
              name="program"
              checked={form.program_choice === '4weeks_trial'}
              onChange={() => setField('program_choice', '4weeks_trial')}
            />
            <span style={S.planTitle}>代謝力重建 4 週體驗版</span>
          </label>
          <p style={S.planPrice}>NT$ 4,980</p>
          <p style={S.planMeta}>原價 $5,200</p>
          <p style={S.para}>適合「想先看看方向對不對再決定」的人。</p>
          <p style={S.para}>一休直播課 + 營養師看餐 + 運動課，體驗一個月。</p>
        </div>

        {/* 方案 C — 雙人早鳥 anchor */}
        <div style={{ ...S.planCard, ...S.planCardDuo }}>
          <span style={S.planBadgeDuo}>👯 雙人早鳥</span>
          <p style={S.planTitleDuo}>12 週完整版｜雙人團報</p>
          <p style={S.planPrice}>NT$ 3,333 <span style={{ fontSize: 18, fontWeight: 600 }}>/ 月 · 每人</span></p>
          <p style={S.planMeta}>12 週每人總價 $9,999｜<span style={{ ...S.highlight, fontSize: 13 }}>限定 5 組</span></p>
          <p style={S.para}>
            <span style={S.emphasis}>限雙人團報，6 月班只開 5 組</span>
            。找一個想一起改變的人，兩個人一起走完，比一個人容易得多。
          </p>
          <p style={S.para}>
            內容跟 12 週完整版一樣，每人都有自己的直播 / 營養師看餐 / 運動課 / 班級。
          </p>
          <a style={S.btnDuo} href={DUO_CONTACT_URL}>
            回 LINE 找 fifi 團報 →
          </a>
          <p style={{ ...S.para, fontSize: 13, color: C.textLight, marginTop: 12, marginBottom: 0 }}>
            雙人團報走人工處理（確認兩邊身分 + 匯款分配），不走這個報名表。
          </p>
        </div>

        {/* 退費條款 */}
        <div style={S.refundBox}>
          <p style={S.refundTitle}>報名之後可以退費嗎？</p>
          <p style={S.para}>
            <span style={S.refundYes}>可以。</span>
            還沒上課前可以全額退（扣手續費）。開始上課後，當月不退，剩餘的可以退。
          </p>
          <p style={{ ...S.para, marginTop: 14, color: C.text }}>
            但請不要抱著「反正可以退」的試試看心態來參加 ——
            如果你先預設自己會失敗，你就一定會失敗。
          </p>
          <p style={{ ...S.para, fontWeight: 700, color: C.accent }}>
            你只要很認真，我就一定可以幫助你成功。
          </p>
          <p style={{ ...S.para, fontSize: 13, color: C.textLight, marginTop: 16, marginBottom: 0 }}>
            完整退費條款詳見{' '}
            <a
              href={PROGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: C.primary, textDecoration: 'underline' }}
            >
              官網課程頁 Q6
            </a>
            。
          </p>
        </div>

        {/* URL 沒帶 HMAC → 擋表單 */}
        {!hasValidUrl && (
          <div style={S.warnBox}>
            <p style={{ margin: 0, fontWeight: 700 }}>這個頁面需要在 LINE 裡開啟</p>
            <p style={{ margin: '8px 0 0' }}>
              請回到 LINE 傳訊息給一休，他會給你一個專屬連結才能送出報名。
            </p>
            <p style={{ margin: '12px 0 0' }}>
              <a style={S.btnSecondary} href={CONTACT_LINE_URL}>
                回 LINE 告訴我們
              </a>
            </p>
          </div>
        )}

        {/* 報名表 */}
        <form onSubmit={handleSubmit} style={S.form}>
          <h3 style={{ ...S.h3, marginTop: 0 }}>填完送出，我們就準備開始</h3>

          <label style={S.label}>姓名 *</label>
          <input
            style={{ ...S.input, ...(fieldErrors.real_name ? S.inputErr : {}) }}
            value={form.real_name}
            onChange={(e) => setField('real_name', e.target.value)}
            maxLength={50}
            placeholder="真實姓名"
          />
          {fieldErrors.real_name && <p style={S.errText}>{fieldErrors.real_name}</p>}

          <label style={S.label}>手機 *</label>
          <input
            type="tel"
            style={{ ...S.input, ...(fieldErrors.phone ? S.inputErr : {}) }}
            value={form.phone}
            onChange={(e) => setField('phone', e.target.value.replace(/\D/g, ''))}
            maxLength={10}
            placeholder="09XXXXXXXX"
          />
          {fieldErrors.phone && <p style={S.errText}>{fieldErrors.phone}</p>}

          <label style={S.label}>Email *</label>
          <input
            type="email"
            style={{ ...S.input, ...(fieldErrors.email ? S.inputErr : {}) }}
            value={form.email}
            onChange={(e) => setField('email', e.target.value)}
            maxLength={200}
            placeholder="你的 Email"
          />
          {fieldErrors.email && <p style={S.errText}>{fieldErrors.email}</p>}

          <label style={S.label}>地址 *</label>
          <input
            style={{ ...S.input, ...(fieldErrors.address ? S.inputErr : {}) }}
            value={form.address}
            onChange={(e) => setField('address', e.target.value)}
            maxLength={200}
            placeholder="縣市 / 鄉鎮 / 街道號碼"
          />
          {fieldErrors.address && <p style={S.errText}>{fieldErrors.address}</p>}

          <label style={S.label}>性別 *</label>
          <div style={S.radioRow}>
            {[
              { v: 'female', label: '女' },
              { v: 'male', label: '男' },
              { v: 'other', label: '其他' },
            ].map((o) => (
              <label key={o.v} style={S.radioLabel}>
                <input
                  type="radio"
                  name="gender"
                  checked={form.gender === o.v}
                  onChange={() => setField('gender', o.v)}
                />
                {o.label}
              </label>
            ))}
          </div>
          {fieldErrors.gender && <p style={S.errText}>{fieldErrors.gender}</p>}

          <label style={S.label}>年齡 *</label>
          <input
            type="number"
            inputMode="numeric"
            min={18}
            max={99}
            style={{ ...S.input, ...(fieldErrors.age ? S.inputErr : {}) }}
            value={form.age}
            onChange={(e) => setField('age', e.target.value)}
            placeholder="18-99"
          />
          {fieldErrors.age && <p style={S.errText}>{fieldErrors.age}</p>}

          <label style={S.label}>LINE ID（選填）</label>
          <input
            style={S.input}
            value={form.line_id}
            onChange={(e) => setField('line_id', e.target.value)}
            maxLength={50}
            placeholder="方便 fifi 助教聯絡你"
          />

          <label
            style={{
              ...S.radioLabel,
              marginTop: 24,
              fontSize: 15,
              alignItems: 'flex-start',
            }}
          >
            <input
              type="checkbox"
              checked={form.agreed_refund_policy}
              onChange={(e) => setField('agreed_refund_policy', e.target.checked)}
              style={{ marginTop: 4 }}
            />
            <span>我已閱讀並同意退費條款 *</span>
          </label>
          {fieldErrors.agreed_refund_policy && (
            <p style={S.errText}>{fieldErrors.agreed_refund_policy}</p>
          )}

          {submitErr && <div style={S.errBox}>{submitErr}</div>}

          <button
            type="submit"
            disabled={submitting || !hasValidUrl}
            style={{
              ...S.btn,
              ...(submitting || !hasValidUrl ? S.btnDisabled : {}),
            }}
          >
            {submitting ? '送出中…' : '送出報名'}
          </button>
        </form>

        {liffError && (
          <p style={{ color: C.textLight, fontSize: 13, marginTop: 12 }}>
            （LIFF 沒載入成功：{liffError}。不影響報名。）
          </p>
        )}
      </section>

      <div style={S.divider} />
      <p style={S.signature}>我是一休，陪你健康的瘦一輩子。</p>
    </div>
  );
}
