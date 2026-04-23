// Q5 契約 v2.4 Ch.0.9 + Ch.11.3：/apply landing + 報名
//
// v4.1（2026-04-23 晚）視覺強化：
//   - Hero 區漸層 + 大字 + 引號裝飾
//   - 章節 h2 加 emoji + 綠色下劃線
//   - Ch.2 自述段落加段落分隔裝飾
//   - Ch.3 學員卡加左綠 accent bar + 體重變化大字
//   - Ch.4「買兩個東西」用對比卡片 + 勾勾列表 + 大數字強調
//   - Ch.5 方案 A 加「⭐ 推薦」徽章 + 價格視覺強化
//   - 退費條款接一休定版文案（有條款 + conviction + 官網連結）
//   - 關鍵句加黃色 highlight background
//
// v4 copy（文字層）骨架在 apply頁landing規劃.md，本檔只改樣式 + 退費條款。
//
// 技術架構：
//   - 'use client'：全 React state，LIFF init 背景跑
//   - 五章 copy 立即 render（不等 LIFF），改善首屏體驗
//   - LIFF init 成功 → fire-and-forget POST /api/apply/visit
//   - URL 少任何 HMAC param → 表單 disable + 顯示「回 LINE 取得專屬連結」
//   - 送出表單 → POST /api/apply/submit（RPC 原子寫 applications + stage=8）

'use client';

import { useEffect, useMemo, useState } from 'react';

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID || '';
const HMAC_KEYS = ['userid', 'source', 'trigger', 'kv', 'ts', 'sig'];
const CONTACT_LINE_URL =
  'https://line.me/R/oaMessage/%40sososo/?%E6%88%91%E8%A6%81%E5%A0%B1%E5%90%8D';
const PROGRAM_URL = 'https://abcmetabolic.com/program';

// ==================== Design tokens ====================
const C = {
  primary: '#06c755', // LINE green
  primaryDark: '#0b6e39',
  primaryLight: '#f0fff5',
  accent: '#0d5c3a',
  warm: '#fef7ec', // 柔和奶油底色
  warmBorder: '#f4e0b8',
  highlight: '#fff3cd', // 關鍵句黃色 highlight
  text: '#1a1a1a',
  textMid: '#3a3a3a',
  textLight: '#757575',
  border: '#e5e5e5',
  borderLight: '#eeeeee',
  error: '#e4572e',
  errorBg: '#fff0ee',
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
  inner: {
    padding: '0 20px',
  },

  // ---- Hero（漸層 block，突破 inner padding）----
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
  heroCTA: {
    fontSize: 14,
    color: C.textLight,
    margin: 0,
  },
  heroArrow: {
    fontSize: 24,
    color: C.primary,
    marginTop: 16,
    animation: 'bounce 2s infinite',
  },

  // ---- Section headings ----
  section: {
    padding: '56px 20px 16px',
  },
  h2Wrapper: {
    marginBottom: 32,
  },
  h2Emoji: {
    fontSize: 32,
    display: 'block',
    marginBottom: 8,
  },
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

  para: {
    margin: '0 0 14px',
    color: C.textMid,
  },
  paraGap: {
    marginTop: 32,
  },

  emphasis: {
    fontWeight: 700,
    color: C.text,
  },
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

  // ---- Ch.3 學員卡 ----
  storyCard: {
    background: '#fff',
    borderLeft: `4px solid ${C.primary}`,
    borderRadius: '0 10px 10px 0',
    padding: '20px 22px',
    margin: '20px 0',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
  },
  storyName: {
    fontSize: 18,
    fontWeight: 700,
    margin: '0 0 4px',
    color: C.text,
  },
  storyWeight: {
    fontSize: 15,
    color: C.primaryDark,
    fontWeight: 600,
    margin: '0 0 14px',
  },

  // ---- Ch.4 錨點卡 ----
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
  bulletItem: {
    display: 'flex',
    gap: 10,
    margin: '10px 0',
    color: C.textMid,
  },
  bulletDot: {
    color: C.primary,
    fontWeight: 800,
    flexShrink: 0,
    fontSize: 18,
    lineHeight: '24px',
  },
  bigNumber: {
    fontSize: 22,
    fontWeight: 800,
    color: C.primaryDark,
  },

  // ---- Ch.5 方案卡 ----
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
  planTitle: {
    fontSize: 18,
    fontWeight: 700,
    marginLeft: 30,
    color: C.text,
  },
  planPrice: {
    fontSize: 30,
    fontWeight: 800,
    color: C.primaryDark,
    margin: '10px 0 2px',
  },
  planMeta: { color: C.textLight, fontSize: 13, margin: '0 0 14px' },
  planBulletList: {
    listStyle: 'none',
    padding: 0,
    margin: '14px 0 0',
  },
  planBullet: {
    display: 'flex',
    gap: 10,
    padding: '6px 0',
    color: C.textMid,
    fontSize: 15,
  },
  planCheckIcon: {
    color: C.primary,
    fontWeight: 800,
    flexShrink: 0,
  },

  // ---- 退費條款 box（v4.1 新定版）----
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

  // ---- Form ----
  form: {
    background: '#fff',
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: '24px 22px',
    margin: '28px 0',
  },
  label: { display: 'block', fontWeight: 600, margin: '14px 0 6px', fontSize: 15, color: C.text },
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

// 章節 heading 共用
function SectionHeading({ emoji, title }) {
  return (
    <div style={S.h2Wrapper}>
      <span style={S.h2Emoji}>{emoji}</span>
      <h2 style={S.h2}>{title}</h2>
      <span style={S.h2Underline} />
    </div>
  );
}

// 學員故事卡
function StoryCard({ name, weight, children }) {
  return (
    <div style={S.storyCard}>
      <p style={S.storyName}>{name}</p>
      {weight && <p style={S.storyWeight}>{weight}</p>}
      {children}
    </div>
  );
}

// 勾勾 bullet
function Bullet({ children }) {
  return (
    <p style={S.bulletItem}>
      <span style={S.bulletDot}>—</span>
      <span>{children}</span>
    </p>
  );
}

// ==================== Main ====================
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
        <section style={{ ...S.hero, padding: '80px 24px 60px' }}>
          <span style={{ ...S.h2Emoji, fontSize: 48 }}>🌱</span>
          <h1 style={S.heroTitle}>收到了。</h1>
          <p style={S.heroSub}>
            <span style={S.emphasis}>fifi 助教</span>會跟你聯絡，
            <br />
            確認匯款方式跟開班資訊。
          </p>
          <p style={{ ...S.heroSub, fontSize: 15 }}>
            如果你希望更快開始，可以
            <span style={S.emphasis}>主動傳訊息</span>
            告訴我們；
            <br />
            不然就等我們的訊息 —— 遇到假日可能會慢一點，
            <br />
            但我們一定會跟你聯絡。
          </p>
          <a style={{ ...S.btn, maxWidth: 280, margin: '20px auto 0' }} href={CONTACT_LINE_URL}>
            回到 LINE 告訴我們
          </a>
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
          夏天不用再躲衣服的日子。
          <br />
          <br />
          是不用再跟身體打仗，
          <br />
          也不用再盤算「我今天可以吃什麼」的那種輕鬆。
        </p>
        <p style={S.heroCTA}>如果這些是你要的，往下看。</p>
        <div style={S.heroArrow}>↓</div>
      </section>

      {/* ==================== 第二章 可能性 ==================== */}
      <section style={S.section}>
        <SectionHeading emoji="💭" title="我知道，因為我走過" />

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
        <p style={{ ...S.para, marginTop: 18 }}>
          這個方法，我後來叫它 <span style={S.highlight}>ABC 代謝力重建</span>。
        </p>

        <p style={{ ...S.para, ...S.paraGap }}>因為我胖過、我痛過、我受過苦。</p>
        <p style={S.para}>
          也因為我胖過，我才有辦法解決跟曾經的我一樣、還在痛苦裡的人。
        </p>
        <p style={S.para}>
          過去 4 年，我們幫助超過{' '}
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

        <StoryCard name="沛蓁" weight="85 → 67 kg（−18 kg）">
          <p style={S.para}>
            她煮雞湯要征服老公的胃。結果老公的胃是征服了，外人卻把她認成老公的媽媽。
          </p>
          <p style={S.para}>
            她沒有節食，沒有吃藥。她是<span style={S.emphasis}>吃飽</span>瘦下來的。
          </p>
          <div style={S.quoteBlock}>「以前我從來沒想過減肥可以吃飽。」</div>
        </StoryCard>

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

        <StoryCard name="美美" weight="拒絕抽脂的那個選擇">
          <p style={S.para}>
            她姐姐做過切胃手術。瘦下來，又胖回去，而且胖了更多。
          </p>
          <p style={S.para}>美美去醫美諮詢抽脂，最後決定不做。</p>
          <div style={S.quoteBlock}>「我不要再走一次我姐的路。」</div>
          <p style={{ ...S.para, marginTop: 14 }}>她選擇用這個方法，一次做對。</p>
        </StoryCard>

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

        <div style={S.anchorCard}>
          <div style={S.anchorHeader}>
            <div style={S.anchorNum}>1</div>
            <h3 style={S.anchorTitle}>你在買我的系統、我的教學、我的團隊</h3>
          </div>
          <p style={S.para}>你不是買一套「我拍一拍上傳」的錄播課。</p>
          <p style={S.para}>你買的是：</p>
          <Bullet>
            <span style={S.emphasis}>我</span>，每週親自直播帶你，
            <span style={S.emphasis}>12 堂直播 + 24 堂錄播</span>
            ，從代謝原理講到每天的選擇。
          </Bullet>
          <Bullet>
            <span style={S.emphasis}>15 位國家高考合格的營養師</span>，
            每天看你的餐、回你的問題。不是一個月看一次，<span style={S.highlight}>是每天</span>。
          </Bullet>
          <Bullet>
            <span style={S.emphasis}>150+ 堂運動課</span>
            ，教練線上帶、有強度分層、有姿勢矯正。
          </Bullet>
          <Bullet>
            <span style={S.emphasis}>一整班的學員陪你走</span>
            。有教練、有助教、有班長。不是你一個人跟網路課對話。
          </Bullet>
        </div>

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
            市場上多數減肥法，平均維持率是 <span style={S.emphasis}>10%</span>。
            也就是 10 個瘦下來的人，9 個會胖回去。
          </p>
          <p style={S.para}>
            這個方法的學員，<span style={S.highlight}>10 個裡面有 7 個沒有復胖</span>。
          </p>
          <p style={{ ...S.para, marginTop: 18 }}>這是這個方法的重點：</p>
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

        <p style={{ ...S.para, ...S.paraGap }}>
          你過去花在瘦身上的錢，加一加，會比這筆多。
        </p>
        <p style={S.para}>差別是 —— 過去那些錢，買的是「再試一次」。</p>
        <p style={S.para}>
          <span style={S.highlight}>這一筆，買的是「不用再試了」。</span>
        </p>
      </section>

      {/* ==================== 第五章 方案 + 報名 ==================== */}
      <section style={S.section}>
        <SectionHeading emoji="🌿" title="如果你準備好了" />
        <p style={S.para}>如果你看到這裡還沒關掉，我想你已經準備好了。</p>

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
          <p style={S.planPrice}>NT$ 11,400</p>
          <p style={S.planMeta}>平均每月 $3,800</p>
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

        {/* 退費條款（v4.1 新定版 — 一休給的文案）*/}
        <div style={S.refundBox}>
          <p style={S.refundTitle}>報名之後可以退費嗎？</p>
          <p style={S.para}>
            <span style={S.refundYes}>可以。</span>
            還沒上課前可以全額退（扣手續費）。
            開始上課後，當月不退，剩餘的可以退。
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
