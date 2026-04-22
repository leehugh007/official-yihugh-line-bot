// Q5 契約 v2.3 Ch.0.9：/apply LIFF 驗證（簡化版 v2）
//
// ## 為什麼改成這版（2026-04-23 實測修正）
//
// 原版兩個問題：
//
// 1. **isInClient() redirect loop（桌面 LINE 會爆）**：
//    原 code 若 !liff.isInClient() → redirect 到 liff.line.me/{LIFF_ID}
//    但 LINE 桌面 app 的內建瀏覽器 isInClient() 可能回 false，
//    redirect 後 LINE app 開啟還是桌面 → 還是 false → 無限 loop（「載入中」卡死）。
//    修：移除 isInClient redirect 邏輯，LIFF init 成功就放行。
//
// 2. **LINE 2024 policy 下 userId 比對永遠失敗**：
//    LINE 2024 強制 LIFF 建在 LINE Login channel 下（禁止在 Messaging API channel）。
//    Login channel 的 userId namespace 跟 Messaging API namespace **刻意不同 hash**。
//    URL userid（webhook 寫的 Messaging API ID）≠ liff.getContext().userId（Login ID）。
//    即使綁了 Linked LINE Official Account（= 舊版 Bot link feature）也沒提供
//    cross-namespace mapping，只有 friendship 查詢 + add friend 推促。
//    修：移除 userId 一致性比對。URL userid 保留當 attribution。
//
// ## 簡化版保留什麼
//
//    - LIFF init（讓 /apply 可在 LINE 內 Full size 開啟）
//    - LIFF SDK 可用（Phase 4.1 可能用 closeWindow / shareTargetPicker）
//    - URL userid 當 attribution（server 側存報名時用）
//    - LIFF_ID 未設 / LIFF init 失敗 → 友善錯誤頁 + retry + contact
//
// ## 不再保留
//
//    - isInClient 判斷（誤判 loop 風險 > 實際擋瀏覽器直訪的效益）
//    - userId 比對（做不到）
//    - 非 LINE 瀏覽器 redirect（沒必要，桌面 / 外部 browser 直接看也 OK）
//
// ## LINE-to-LINE 分享污染
//
//    Phase 4.5 觀察期再評估：若觀察到 applications 重複 phone/email 嚴重，
//    再加 signed token（/apply?userid=X&sig=<hmac>&ts=<ts>）或手機驗證碼。
//    目前接受風險（Q5 只推給已做 Q4 的用戶，轉發機率低）。

'use client';

import { useEffect, useState } from 'react';

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID || '';

export default function ApplyPage() {
  const [view, setView] = useState({ status: 'initializing' });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!LIFF_ID) {
        if (!cancelled) {
          setView({ status: 'config_error', reason: 'NEXT_PUBLIC_LIFF_ID not set' });
        }
        return;
      }

      try {
        const liff = (await import('@line/liff')).default;
        await liff.init({ liffId: LIFF_ID });

        // 不做 isInClient redirect（桌面 LINE 會 loop）
        // 不做 userId 一致性比對（LINE 2024 policy 做不到）
        // LIFF init 成功 = 放行，URL userid 當 attribution

        const urlParams = new URLSearchParams(window.location.search);
        const urlUserId = urlParams.get('userid') || '';
        const source = urlParams.get('source') || 'unknown';
        const trigger = urlParams.get('trigger') || 'unknown';

        // 盡力拿 LIFF context（若拿到可 log 用，debug 比對 namespace 差異）
        let liffUserId = '';
        try {
          const ctx = liff.getContext();
          liffUserId = ctx?.userId || '';
        } catch (_) {
          // 忽略 context 讀失敗，不影響主流程
        }

        if (!cancelled) {
          setView({
            status: 'verified',
            urlUserId,
            liffUserId,
            source,
            trigger,
            isInClient: liff.isInClient(),
          });
        }
      } catch (err) {
        console.error('[LIFF] init failed:', err);
        if (!cancelled) {
          setView({
            status: 'liff_error',
            reason: err?.message || String(err),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Phase 4.1 會把這些換成 landing 五章實裝
  const wrapperStyle = {
    padding: 24,
    maxWidth: 560,
    margin: '0 auto',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", sans-serif',
    lineHeight: 1.7,
    color: '#222',
  };
  const mutedStyle = { color: '#888', fontSize: 12 };
  const btnStyle = {
    display: 'inline-block',
    padding: '10px 20px',
    margin: '8px 8px 8px 0',
    background: '#06c755',
    color: 'white',
    textDecoration: 'none',
    borderRadius: 6,
    fontSize: 15,
    border: 'none',
    cursor: 'pointer',
  };
  const btnSecondaryStyle = { ...btnStyle, background: '#f5f5f5', color: '#333' };

  const CONTACT_LINE_URL =
    'https://line.me/R/oaMessage/%40sososo/?%E9%A0%81%E9%9D%A2%E6%89%93%E4%B8%8D%E9%96%8B';

  const ErrorActions = () => (
    <div style={{ marginTop: 20 }}>
      <button style={btnStyle} onClick={() => window.location.reload()}>
        重試
      </button>
      <a style={btnSecondaryStyle} href={CONTACT_LINE_URL}>
        傳訊息告訴一休
      </a>
    </div>
  );

  if (view.status === 'initializing') {
    return <div style={{ ...wrapperStyle, textAlign: 'center' }}>載入中…</div>;
  }

  if (view.status === 'config_error') {
    return (
      <div style={wrapperStyle}>
        <h2>系統未設定</h2>
        <p>這個頁面需要在 LINE 裡開啟。請回到 LINE 傳訊息給一休，他會重新給你一個連結。</p>
        <ErrorActions />
        <p style={mutedStyle}>reason: {view.reason}</p>
      </div>
    );
  }

  if (view.status === 'liff_error') {
    return (
      <div style={wrapperStyle}>
        <h2>載入失敗</h2>
        <p>可能是網路暫時不穩。先按「重試」試一次，如果還是打不開，傳訊息告訴一休。</p>
        <ErrorActions />
        <p style={mutedStyle}>reason: {view.reason}</p>
      </div>
    );
  }

  // verified — Phase 4.1 landing 五章 placeholder
  return (
    <div style={wrapperStyle}>
      <h2>驗證通過</h2>
      <p>你已經進入 /apply 頁，可以看到完整方案（Phase 4.1 才會寫 landing 五章內容）。</p>
      <p style={mutedStyle}>
        URL userid: {view.urlUserId || '(none)'}
        <br />
        LIFF userid: {view.liffUserId || '(none)'}
        <br />
        isInClient: {String(view.isInClient)}
        <br />
        source: {view.source} / trigger: {view.trigger}
      </p>
      <hr style={{ margin: '32px 0', border: 'none', borderTop: '1px solid #eee' }} />
      <p style={mutedStyle}>
        Landing 五章（渴望／可能性／確定感／心理錨點轉換／報名）Phase 4.1 補。
        <br />
        參考 <code>apply頁landing規劃.md</code>
      </p>
    </div>
  );
}
