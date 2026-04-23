// Q5 契約 v2.4 Ch.0.9 + Ch.11.3：/apply landing + 報名
//
// 五章骨架（apply頁landing規劃.md）：
//   1. Hero — 觸發渴望
//   2. 可能性 — 我走過，所以我懂（v4 一休原話為骨架）
//   3. 確定感 — 學員故事
//   4. 心理錨點 — 你在買兩個東西（系統/團隊 + 被驗證的方法）
//   5. 方案 + 報名
//
// 技術架構：
//   - 'use client'：全 React state，LIFF init 背景跑
//   - 五章 copy 立即 render（不等 LIFF），改善首屏體驗
//   - LIFF init 成功 → fire-and-forget POST /api/apply/visit（HMAC verify 會拒沒帶 params 的訪客）
//   - URL 少任何 HMAC param → 表單 disable + 顯示「回 LINE 取得專屬連結」
//   - 送出表單 → POST /api/apply/submit（RPC 原子寫 applications + stage=8）
//
// LIFF 2024 policy 備註（歷史教訓）：
//   - isInClient 判斷拿掉（桌面 LINE 會 loop）
//   - userId 一致性比對拿掉（Login channel vs Messaging API namespace 不同 hash 做不到）
//   - authority 全壓在 HMAC signed URL（lib/q5-apply-url.js）

'use client';

import { useEffect, useMemo, useState } from 'react';

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID || '';
const HMAC_KEYS = ['userid', 'source', 'trigger', 'kv', 'ts', 'sig'];
const CONTACT_LINE_URL =
  'https://line.me/R/oaMessage/%40sososo/?%E6%88%91%E8%A6%81%E5%A0%B1%E5%90%8D';

// 共用樣式 —— 手機優先、留白、跟官網調性接近
const S = {
  page: {
    maxWidth: 720,
    margin: '0 auto',
    padding: '24px 20px 80px',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", sans-serif',
    lineHeight: 1.85,
    color: '#222',
    fontSize: 16,
  },
  hr: {
    border: 'none',
    borderTop: '1px solid #e5e5e5',
    margin: '48px 0',
  },
  h1: { fontSize: 32, lineHeight: 1.3, fontWeight: 700, margin: '0 0 20px' },
  h2: {
    fontSize: 24,
    lineHeight: 1.35,
    fontWeight: 700,
    margin: '40px 0 16px',
  },
  h3: { fontSize: 19, lineHeight: 1.4, fontWeight: 700, margin: '28px 0 8px' },
  sub: { fontSize: 18, color: '#444', margin: '0 0 16px' },
  emphasis: {
    fontWeight: 700,
    color: '#111',
  },
  muted: { color: '#888', fontSize: 13 },
  quote: {
    borderLeft: '3px solid #06c755',
    paddingLeft: 16,
    color: '#444',
    margin: '12px 0',
    fontStyle: 'normal',
  },
  storyCard: {
    background: '#f9f9f7',
    borderRadius: 10,
    padding: '20px 20px',
    margin: '16px 0',
  },
  planCard: {
    border: '2px solid #e5e5e5',
    borderRadius: 12,
    padding: '20px 20px',
    margin: '16px 0',
  },
  planCardActive: {
    border: '2px solid #06c755',
    background: '#f0fff5',
  },
  planPrice: {
    fontSize: 26,
    fontWeight: 700,
    color: '#06c755',
    margin: '8px 0',
  },
  label: { display: 'block', fontWeight: 600, margin: '16px 0 6px', fontSize: 15 },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: 6,
    fontSize: 16,
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  inputErr: { borderColor: '#e4572e' },
  errText: { color: '#e4572e', fontSize: 13, margin: '4px 0 0' },
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
    padding: '14px 28px',
    background: '#06c755',
    color: 'white',
    textDecoration: 'none',
    borderRadius: 8,
    fontSize: 17,
    fontWeight: 700,
    border: 'none',
    cursor: 'pointer',
    width: '100%',
    marginTop: 20,
  },
  btnDisabled: { background: '#bdbdbd', cursor: 'not-allowed' },
  btnSecondary: {
    display: 'inline-block',
    padding: '10px 20px',
    background: '#f5f5f5',
    color: '#333',
    textDecoration: 'none',
    borderRadius: 6,
    fontSize: 15,
    margin: '4px 8px 4px 0',
  },
  warnBox: {
    background: '#fff8e1',
    border: '1px solid #ffd54f',
    borderRadius: 8,
    padding: '14px 16px',
    margin: '20px 0',
    fontSize: 14,
    lineHeight: 1.7,
  },
  errBox: {
    background: '#fff0ee',
    border: '1px solid #e4572e',
    borderRadius: 8,
    padding: '14px 16px',
    margin: '20px 0',
    fontSize: 14,
    color: '#b23a1f',
  },
  signature: {
    textAlign: 'center',
    margin: '40px 0 0',
    color: '#555',
    fontSize: 15,
    fontStyle: 'normal',
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
        } catch (_) {
          // profile 失敗不影響主流程
        }

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

  if (submitted) {
    return (
      <div style={S.page}>
        <h1 style={S.h1}>收到了。</h1>
        <p>
          <span style={S.emphasis}>fifi 助教</span>會跟你聯絡，確認匯款方式跟開班資訊。
        </p>
        <p>
          如果你希望更快開始，可以<span style={S.emphasis}>主動傳訊息</span>告訴我們；
          不然就等我們的訊息 —— 遇到假日可能會慢一點，但我們一定會跟你聯絡。
        </p>
        <p>
          <a style={S.btnSecondary} href={CONTACT_LINE_URL}>
            回到 LINE 告訴我們
          </a>
        </p>
        <hr style={S.hr} />
        <p style={S.signature}>我是一休，陪你健康的瘦一輩子。</p>
      </div>
    );
  }

  return (
    <div style={S.page}>
      {/* ---------- 第一章 Hero ---------- */}
      <section>
        <h1 style={S.h1}>你在找的，不是瘦 10 公斤。</h1>
        <p style={S.sub}>
          是那個穿得下、跑得動、早上起床不累的自己。
          <br />
          是照鏡子不用躲、跟孩子跑跳不會喘、夏天不用再躲衣服的日子。
          <br />
          是不用再跟身體打仗，也不用再盤算「我今天可以吃什麼」的那種輕鬆。
        </p>
        <p>如果這些是你要的，往下看。我想跟你說我怎麼做的。</p>
      </section>

      <hr style={S.hr} />

      {/* ---------- 第二章 可能性 ---------- */}
      <section>
        <h2 style={S.h2}>我知道，因為我走過</h2>

        <p>我不是天生瘦。</p>
        <p>
          跟你一樣，我也是那種<span style={S.emphasis}>喝水都會胖</span>的體質。
        </p>
        <p>
          最胖的時候 89 公斤。最瘦的時候 62 公斤。
          中間復胖超過十次 —— 每一次我都以為「這次不會了」，每一次都失敗。
        </p>

        <p style={{ marginTop: 28 }}>但我不願意放棄。</p>
        <p>說實話，我討厭胖的自己。</p>
        <p>沒精神、氣色不好、體力差、穿衣服也不好看。</p>
        <p>連我自己都不愛自己，別人怎麼會愛我。</p>
        <p>我想先好好愛自己。所以我開始改變。</p>

        <p style={{ marginTop: 28 }}>我瘋狂學習、實踐，尋找真正能瘦一輩子的方法。</p>
        <p>高中的時候，我一天只吃蘋果，瘦了 7 公斤，一週後胖回 6 公斤。</p>
        <p>
          後來我每天跑五到十公里，一天吃 1,300 卡。人是瘦下來了，
          但整天都在想食物 —— 一恢復正常吃，馬上彈回來。
        </p>
        <p>近 20 年，我什麼方式都試過 —— 節食、斷食、代餐、瘋狂運動。</p>
        <p>每一個都瘦過。每一個都復胖了。</p>

        <p style={{ marginTop: 28 }}>
          我受夠減肥的苦了。吃著不愛吃的東西，做著痛苦的運動。
        </p>
        <p>
          直到我慢慢明白 ——
          <span style={S.emphasis}>真正最好的瘦身，是你不覺得你在減肥</span>。
        </p>
        <p>
          沒有剝奪感。每一口放進嘴裡的食物，都是你發自內心想吃，也是有意識的選擇。
        </p>
        <p>
          這個方法，我後來叫它 <span style={S.emphasis}>ABC 代謝力重建</span>。
        </p>

        <p style={{ marginTop: 28 }}>因為我胖過、我痛過、我受過苦。</p>
        <p>
          也因為我胖過，我才有辦法解決跟曾經的我一樣、還在痛苦裡的人。
        </p>
        <p>
          過去 4 年，我們幫助超過
          <span style={S.emphasis}>3,000 個學員</span>
          ，一起瘦掉超過
          <span style={S.emphasis}>三萬公斤</span>。
        </p>
        <p>
          我從每一個學員身上看到改變、看到他們綻放的光芒 —— 那是我最大的成就。
        </p>
      </section>

      <hr style={S.hr} />

      {/* ---------- 第三章 確定感 ---------- */}
      <section>
        <h2 style={S.h2}>她們做到了</h2>
        <p>你不用相信我。看看她們。</p>

        <div style={S.storyCard}>
          <h3 style={S.h3}>沛蓁（85 → 67 kg）</h3>
          <p>
            她煮雞湯要征服老公的胃。結果老公的胃是征服了，
            外人卻把她認成老公的媽媽。
          </p>
          <p>
            她沒有節食，沒有吃藥。她是<span style={S.emphasis}>吃飽</span>瘦下來的。
          </p>
          <p style={S.quote}>「以前我從來沒想過減肥可以吃飽。」</p>
        </div>

        <div style={S.storyCard}>
          <h3 style={S.h3}>慧蘭（53 歲）</h3>
          <p>她先生胃痛，查出來是癌症，三週就走了。</p>
          <p>她那時 46 歲，下一餐都不知道怎麼吃。</p>
          <p>
            七年後，她 53 歲，比七年前還年輕。
            不是化妝，是身體裡面的狀態換了。
          </p>
          <p style={S.quote}>
            「不再需要零食、不再跟食物打架」—— 她說這是她這輩子想都沒想過會有的感覺。
          </p>
        </div>

        <div style={S.storyCard}>
          <h3 style={S.h3}>俐臻（127 → 65 kg，一年瘦 62 公斤）</h3>
          <p>她原本連穿襪子都要女兒幫忙彎腰。</p>
          <p>她以前覺得自己這輩子就這樣了，胖是她的命。</p>
          <p style={S.quote}>「原來胖是給我改變的機會。」</p>
          <p>
            她學會的不是「怎麼瘦」，是<span style={S.emphasis}>怎麼溫柔對自己</span>。
          </p>
        </div>

        <div style={S.storyCard}>
          <h3 style={S.h3}>溫溫（產後）</h3>
          <p>她生完小孩之後，陷在暴食跟自責的循環裡三年。</p>
          <p>
            來我這裡之後，第一次發現 —— 原來瘦身可以吃飽、可以不用餓肚子。
          </p>
          <p>三個月瘦十公斤。更重要的是，她家人也跟著改變了。</p>
        </div>

        <div style={S.storyCard}>
          <h3 style={S.h3}>美美（醫美拒絕抽脂）</h3>
          <p>
            她姐姐做過切胃手術。瘦下來，又胖回去，而且胖了更多。
          </p>
          <p>美美去醫美諮詢抽脂，最後決定不做。</p>
          <p style={S.quote}>
            「我不要再走一次我姐的路。」她選擇用這個方法，一次做對。
          </p>
        </div>

        <p style={{ marginTop: 32 }}>我知道每個人的處境不一樣。</p>
        <p>
          但每一個走進來的學員，都是從「我試過太多次了，大概就這樣了」開始的。
        </p>
        <p>她們不是比你厲害。她們只是換了一個方向。</p>
      </section>

      <hr style={S.hr} />

      {/* ---------- 第四章 心理錨點 ---------- */}
      <section>
        <h2 style={S.h2}>這不是一門課的費用。你在買兩個東西。</h2>

        <h3 style={S.h3}>第一個：你在買我的系統、我的教學、我的團隊</h3>
        <p>你不是買一套「我拍一拍上傳」的錄播課。</p>
        <p>你買的是：</p>
        <p>
          —— <span style={S.emphasis}>我</span>
          ，每週親自直播帶你，12 堂直播 + 24 堂錄播，
          從代謝原理講到每天的選擇。
        </p>
        <p>
          ——{' '}
          <span style={S.emphasis}>15 位國家高考合格的營養師</span>
          ，每天看你的餐、回你的問題。不是一個月看一次，是每天。
        </p>
        <p>
          —— <span style={S.emphasis}>150+ 堂運動課</span>
          ，教練線上帶、有強度分層、有姿勢矯正。
        </p>
        <p>
          —— <span style={S.emphasis}>一整班的學員陪你走</span>
          。有教練、有助教、有班長。不是你一個人跟網路課對話。
        </p>

        <h3 style={S.h3}>第二個：你在買一個被驗證過的方法</h3>
        <p>這個方法不只是理論。</p>
        <p>
          更重要的是 —— <span style={S.emphasis}>維持率 70%</span>。
        </p>
        <p>
          市場上多數減肥法，平均維持率是 10%。也就是 10 個瘦下來的人，9 個會胖回去。
        </p>
        <p>這個方法的學員，10 個裡面有 7 個沒有復胖。</p>
        <p>這是這個方法的重點：</p>
        <p>
          —— <span style={S.emphasis}>不算熱量</span>。每一餐都吃飽。
        </p>
        <p>
          —— <span style={S.emphasis}>不復胖</span>
          。你不是瘦一次，是這輩子不用再做這件事。
        </p>
        <p>
          —— <span style={S.emphasis}>教你重建一個健康的自己</span>
          。方法進你身體裡，不用隨身帶著食譜過日子。
        </p>

        <p style={{ marginTop: 28 }}>
          你過去花在瘦身上的錢，加一加，會比這筆多。
        </p>
        <p>差別是 —— 過去那些錢，買的是「再試一次」。</p>
        <p>這一筆，買的是「不用再試了」。</p>
      </section>

      <hr style={S.hr} />

      {/* ---------- 第五章 方案 + 報名 ---------- */}
      <section>
        <h2 style={S.h2}>如果你準備好了</h2>
        <p>如果你看到這裡還沒關掉，我想你已經準備好了。</p>

        {/* 方案 A —— 12 週 */}
        <div
          style={{
            ...S.planCard,
            ...(form.program_choice === '12weeks' ? S.planCardActive : {}),
          }}
        >
          <label style={{ ...S.radioLabel, fontWeight: 700, fontSize: 17 }}>
            <input
              type="radio"
              name="program"
              checked={form.program_choice === '12weeks'}
              onChange={() => setField('program_choice', '12weeks')}
            />
            代謝力重建 12 週完整版（推薦）
          </label>
          <p style={S.planPrice}>NT$ 11,400</p>
          <p style={S.muted}>平均每月 $3,800</p>
          <p style={{ marginTop: 10 }}>
            這是多數學員選的版本。代謝重建需要時間 —— 四週打基礎，八週讓身體習慣，
            十二週讓它變成你的生活。
          </p>
          <p style={{ marginTop: 10 }}>你會拿到：</p>
          <p>— 一休親自直播 12 堂 + 錄播課 24 堂</p>
          <p>— 15 位國家高考營養師，每天幫你看餐</p>
          <p>— 24 堂營養課 + 150+ 堂運動課</p>
          <p>— 班級制（教練、助教、班長全程陪伴）</p>
          <p>
            — <span style={S.emphasis}>加贈：一對一教練課 1 堂（價值 $2,000）</span>
          </p>
        </div>

        {/* 方案 B —— 4 週 */}
        <div
          style={{
            ...S.planCard,
            ...(form.program_choice === '4weeks_trial' ? S.planCardActive : {}),
          }}
        >
          <label style={{ ...S.radioLabel, fontWeight: 700, fontSize: 17 }}>
            <input
              type="radio"
              name="program"
              checked={form.program_choice === '4weeks_trial'}
              onChange={() => setField('program_choice', '4weeks_trial')}
            />
            代謝力重建 4 週體驗版
          </label>
          <p style={S.planPrice}>NT$ 4,980</p>
          <p style={S.muted}>原價 $5,200</p>
          <p style={{ marginTop: 10 }}>適合「想先看看方向對不對再決定」的人。</p>
          <p>一休直播課 + 營養師看餐 + 運動課，體驗一個月。</p>
        </div>

        {/* 退費條款 placeholder */}
        <div
          style={{
            border: '1px solid #eee',
            borderRadius: 8,
            padding: '14px 16px',
            margin: '20px 0',
            fontSize: 14,
            color: '#666',
            background: '#fafafa',
          }}
        >
          <p style={{ fontWeight: 600, margin: 0, color: '#333' }}>退費條款</p>
          <p style={{ margin: '6px 0 0' }}>
            退費條款由一休定稿後更新。（Phase 4.1 尚未定稿，上線前會補上完整條文。）
          </p>
        </div>

        {/* URL 沒帶 HMAC params → 擋掉表單 */}
        {!hasValidUrl && (
          <div style={S.warnBox}>
            <p style={{ margin: 0, fontWeight: 600 }}>這個頁面需要在 LINE 裡開啟</p>
            <p style={{ margin: '6px 0 0' }}>
              請回到 LINE 傳訊息給一休，他會給你一個專屬連結才能送出報名。
            </p>
            <p style={{ margin: '10px 0 0' }}>
              <a style={S.btnSecondary} href={CONTACT_LINE_URL}>
                回 LINE 告訴我們
              </a>
            </p>
          </div>
        )}

        {/* 報名表 */}
        <form onSubmit={handleSubmit} style={{ marginTop: 28 }}>
          <h3 style={S.h3}>填完送出，我們就準備開始</h3>

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
          <p style={S.muted}>
            （LIFF 沒載入成功：{liffError}。不影響報名，只是沒自動帶 LINE 顯示名。）
          </p>
        )}
      </section>

      <hr style={S.hr} />

      <p style={S.signature}>我是一休，陪你健康的瘦一輩子。</p>
    </div>
  );
}
