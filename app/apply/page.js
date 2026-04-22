// Q5 契約 v2.3 Ch.0.9：/apply LIFF Context 驗證（方案 A）
//
// 為什麼要 LIFF 驗證：
//   Q5 軟邀請 Quick Reply「看看做法」會帶 URL ?userid=U_A 進 /apply。
//   如果用戶 U_A 把 URL 分享給朋友 U_B，U_B 在 /apply 填表 → 若不驗證
//   會以 U_A 身份 INSERT application + 寫 stage=7，污染北極星量測 baseline。
//   第四輪 yi-challenge D1 洞，post-review 升級為前置 PR。
//
// 為什麼走方案 A 不走方案 B：
//   方案 B（deep link redirect）只擋瀏覽器直訪，不防 LINE-to-LINE 分享
//   （朋友把 deep link 轉貼到自己 LINE 打開，LIFF 綁朋友身份但 URL userid 仍是原 A）。
//   方案 A 在 SDK 層比對 liff.getContext().userId === URL ?userid，才是真 anti-sharing。
//
// 範圍（Phase 4.0）：
//   - LIFF init + context 驗證
//   - 瀏覽器直訪 → redirect LINE deep link
//   - URL userId 不等於 LIFF context userId → mismatch 提示
//   - 驗證通過 → placeholder 頁（Phase 4.1 才補 landing 五章 + visit 紀錄）

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

        // 瀏覽器直訪（非 LINE in-app browser）→ redirect LINE 開啟
        if (!liff.isInClient()) {
          window.location.href = `line://app/${LIFF_ID}${window.location.search}`;
          return;
        }

        const context = liff.getContext();
        if (!context || !context.userId) {
          if (!cancelled) {
            setView({ status: 'no_context', reason: 'liff.getContext() 未帶 userId' });
          }
          return;
        }

        const urlParams = new URLSearchParams(window.location.search);
        const urlUserId = urlParams.get('userid');
        const source = urlParams.get('source') || 'unknown';
        const trigger = urlParams.get('trigger') || 'unknown';

        // URL userId 不存在或不等於 LIFF userId → 擋下（分享盜用）
        if (urlUserId && urlUserId !== context.userId) {
          if (!cancelled) {
            setView({
              status: 'url_mismatch',
              contextUserId: context.userId,
              urlUserId,
            });
          }
          return;
        }

        // 驗證通過
        if (!cancelled) {
          setView({
            status: 'verified',
            userId: context.userId,
            source,
            trigger,
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

  if (view.status === 'initializing') {
    return <div style={{ ...wrapperStyle, textAlign: 'center' }}>載入中…</div>;
  }

  if (view.status === 'config_error') {
    return (
      <div style={wrapperStyle}>
        <h2>系統未設定</h2>
        <p>這個頁面需要在 LINE 裡開啟。請回到 LINE 傳訊息給一休，他會重新給你一個連結。</p>
        <p style={mutedStyle}>reason: {view.reason}</p>
      </div>
    );
  }

  if (view.status === 'no_context') {
    return (
      <div style={wrapperStyle}>
        <h2>請從 LINE 開啟</h2>
        <p>這個頁面必須從 LINE 裡的訊息點按鈕開啟，不要直接複製連結到瀏覽器。</p>
        <p style={mutedStyle}>reason: {view.reason}</p>
      </div>
    );
  }

  if (view.status === 'url_mismatch') {
    return (
      <div style={wrapperStyle}>
        <h2>這個連結綁的是別人</h2>
        <p>每個人的連結都是專屬的。如果你想看方案，回 LINE 傳「我想報名」給我，我另外給你一個。</p>
        <p style={mutedStyle}>
          URL userid: {view.urlUserId}
          <br />
          LIFF userid: {view.contextUserId}
        </p>
      </div>
    );
  }

  if (view.status === 'liff_error') {
    return (
      <div style={wrapperStyle}>
        <h2>載入失敗</h2>
        <p>請回到 LINE 裡重新點按鈕試試。如果還是不行，傳「載入失敗」給我。</p>
        <p style={mutedStyle}>reason: {view.reason}</p>
      </div>
    );
  }

  // verified — Phase 4.1 landing 五章 placeholder
  return (
    <div style={wrapperStyle}>
      <h2>驗證通過</h2>
      <p>你已經從 LINE 進入了，可以看到完整方案。</p>
      <p style={mutedStyle}>
        userId: {view.userId}
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
