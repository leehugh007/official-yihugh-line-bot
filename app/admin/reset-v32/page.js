'use client';

// V3.2 試行測試 — 重置自己 DB 到 stage=0 一鍵頁
// URL: /admin/reset-v32?secret=ADMIN_SECRET
// ALLOWLIST：一休 + 婉馨（後端 V32_RESET_ALLOWLIST 鎖死）

import { useState, useEffect } from 'react';

const PRESETS = [
  { label: '一休', userId: 'U51808e2cc195967eba53701518e6f547' },
  { label: '婉馨', userId: 'U3edf3d2114ee03ad81cff1fd35c04600' },
];

export default function ResetV32Page() {
  const [secret, setSecret] = useState('');
  const [userId, setUserId] = useState(PRESETS[0].userId);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('secret');
    if (s) setSecret(s);
  }, []);

  async function handleReset() {
    if (!secret) {
      setError('請輸入 admin secret');
      return;
    }
    if (
      !confirm(
        `確定清 ${userId.slice(0, 8)}... 到 stage=0？\n\n會清掉：\n• path_stage / path / weights\n• ai_tags（q3/q4 全清）\n• v3.2 漏斗 16 欄\n• handoff 狀態\n• Q5 軟邀請軌`
      )
    ) {
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret,
          action: 'reset_v32_test_user',
          userId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
      } else {
        setResult(data.cleared);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        maxWidth: 560,
        margin: '40px auto',
        padding: 20,
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      <h1 style={{ marginBottom: 8 }}>V3.2 試行測試重置</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        清自己 DB 到 stage=0，重新走 Q1-Q4 → 故事 Flex → V3.2 訊息 1/2/3。
      </p>

      <label style={{ display: 'block', marginBottom: 16 }}>
        <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Admin Secret</span>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="ADMIN_SECRET"
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: 14,
            border: '1px solid #ccc',
            borderRadius: 6,
          }}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 24 }}>
        <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>選用戶</span>
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: 14,
            border: '1px solid #ccc',
            borderRadius: 6,
          }}
        >
          {PRESETS.map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.label}（{p.userId.slice(0, 12)}...）
            </option>
          ))}
        </select>
      </label>

      <button
        onClick={handleReset}
        disabled={loading}
        style={{
          width: '100%',
          padding: '14px',
          fontSize: 16,
          fontWeight: 600,
          color: 'white',
          backgroundColor: loading ? '#999' : '#dc2626',
          border: 'none',
          borderRadius: 6,
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? '清除中…' : '🧹 一鍵清到 stage=0'}
      </button>

      {error && (
        <div
          style={{
            marginTop: 20,
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
            marginTop: 20,
            padding: 16,
            backgroundColor: '#dcfce7',
            border: '1px solid #86efac',
            borderRadius: 6,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8, color: '#166534' }}>✅ 已清完！</div>
          <pre
            style={{
              margin: 0,
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {JSON.stringify(result, null, 2)}
          </pre>
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 14, color: '#166534' }}>
            現在打開 LINE 傳「85 → 70」開始測。
          </p>
        </div>
      )}

      <hr
        style={{
          marginTop: 32,
          marginBottom: 16,
          border: 'none',
          borderTop: '1px solid #eee',
        }}
      />
      <p style={{ fontSize: 12, color: '#999' }}>
        保護：ADMIN_SECRET 驗證 + 後端 hardcode userId allowlist（僅一休/婉馨）。
        其他 userId 會回 403。
      </p>
    </div>
  );
}
