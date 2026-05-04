'use client';

// V3.2 超早鳥優惠控制台
// URL: /admin/super-early-bird?secret=ADMIN_SECRET
//
// 操作：
//   1. 立刻關閉：cutoff_at = NOW()
//   2. 設新截止日：DateTimePicker 選時間（未來 / 過去都可）
//
// 背後都改同一個 setting：super_early_bird_cutoff_at
// /apply landing 即時生效（下一個 visit fetch 會看到新 cutoff）

import { useState, useEffect, useCallback } from 'react';

export default function SuperEarlyBirdPage() {
  const [secret, setSecret] = useState('');
  const [pricing, setPricing] = useState(null);
  const [pickerValue, setPickerValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('secret');
    if (s) setSecret(s);
  }, []);

  // 載入當前定價狀態（用既有 GET admin?action=settings 撈所有 settings）
  const loadPricing = useCallback(async () => {
    if (!secret) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin?action=settings&secret=${encodeURIComponent(secret)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      // settings 回傳是 array of { key, value }
      const map = {};
      (data.settings || data || []).forEach((s) => {
        if (s.key) map[s.key] = s.value;
      });
      const cutoff_at = map.super_early_bird_cutoff_at || null;
      const cutoffDate = cutoff_at ? new Date(cutoff_at) : null;
      const now = new Date();
      const super_early_active = !!(cutoffDate && !isNaN(cutoffDate.getTime()) && now < cutoffDate);
      setPricing({
        super_early_active,
        cutoff_at,
        prices: {
          super: parseInt(map.price_12weeks_super, 10) || 10400,
          regular: parseInt(map.price_12weeks_regular, 10) || 11400,
          anchor: parseInt(map.price_12weeks_anchor, 10) || 12600,
          trial: parseInt(map.price_4weeks_trial, 10) || 4980,
        },
      });
      // 預填 DateTimePicker 為當前 cutoff（local 時區字串給 datetime-local input）
      if (cutoffDate && !isNaN(cutoffDate.getTime())) {
        const local = new Date(cutoffDate.getTime() - cutoffDate.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
        setPickerValue(local);
      }
    } catch (e) {
      setError(e.message);
    }
  }, [secret]);

  useEffect(() => {
    if (secret) loadPricing();
  }, [secret, loadPricing]);

  async function callAdmin(cutoff_at, confirmMsg) {
    if (!secret) {
      setError('請輸入 admin secret');
      return;
    }
    if (confirmMsg && !confirm(confirmMsg)) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret,
          action: 'set_super_early_bird_cutoff',
          cutoff_at,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
      } else {
        setResult(data);
        await loadPricing();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleCloseNow() {
    callAdmin(
      new Date().toISOString(),
      '確定立刻關閉超早鳥？\n\n之後進 /apply 的人都看到常規價 $11,400，不再有 $10,400。'
    );
  }

  function handleSetCutoff() {
    if (!pickerValue) {
      setError('請選日期時間');
      return;
    }
    // datetime-local 輸入是 local 時區字串，需要轉 UTC ISO
    const localDate = new Date(pickerValue);
    if (isNaN(localDate.getTime())) {
      setError('日期格式錯誤');
      return;
    }
    const iso = localDate.toISOString();
    const future = localDate > new Date();
    callAdmin(
      iso,
      future
        ? `確定截止日設為 ${pickerValue}？\n\n截止前進 /apply 的人都享超早鳥 $10,400。`
        : `這個時間已經過了！設下去等於立刻關閉。確定？`
    );
  }

  const cutoffStr = pricing?.cutoff_at
    ? new Date(pricing.cutoff_at).toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '（未設）';

  const diffMs = pricing?.cutoff_at
    ? new Date(pricing.cutoff_at).getTime() - Date.now()
    : 0;
  const diffDisplay = diffMs > 0
    ? `剩 ${Math.floor(diffMs / 86400000)} 天 ${Math.floor((diffMs % 86400000) / 3600000)} 小時`
    : `已過期 ${Math.floor(-diffMs / 86400000)} 天`;

  return (
    <div
      style={{
        maxWidth: 640,
        margin: '40px auto',
        padding: 20,
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      <h1 style={{ marginBottom: 8 }}>超早鳥優惠控制台</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        改 cutoff_at = 立即影響之後進 /apply 的人。/apply 顯示倒數計時。
      </p>

      <label style={{ display: 'block', marginBottom: 24 }}>
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

      {/* 當前狀態 */}
      {pricing && (
        <div
          style={{
            marginBottom: 24,
            padding: 16,
            backgroundColor: pricing.super_early_active ? '#dcfce7' : '#fef3c7',
            border: `1px solid ${pricing.super_early_active ? '#86efac' : '#fcd34d'}`,
            borderRadius: 8,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>
            目前狀態：
            <span style={{ color: pricing.super_early_active ? '#166534' : '#92400e' }}>
              {pricing.super_early_active ? '🔥 超早鳥優惠中' : '⏸ 超早鳥已關閉'}
            </span>
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.7 }}>
            <div>截止時間：<b>{cutoffStr}</b></div>
            <div>距離現在：<b>{diffDisplay}</b></div>
            <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid #d1d5db' }} />
            <div style={{ fontSize: 13, color: '#374151' }}>
              定價（新報名實際成交價）：
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                <li>12 週超早鳥：NT$ {pricing.prices.super.toLocaleString()}（cutoff 前）</li>
                <li>12 週常規早鳥：NT$ {pricing.prices.regular.toLocaleString()}（cutoff 後）</li>
                <li>12 週原價錨點：~~NT$ {pricing.prices.anchor.toLocaleString()}~~（永不真實成交，純對比）</li>
                <li>4 週體驗版：NT$ {pricing.prices.trial.toLocaleString()}</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 立刻關閉 */}
      <button
        onClick={handleCloseNow}
        disabled={loading || !secret}
        style={{
          width: '100%',
          padding: '14px',
          fontSize: 15,
          fontWeight: 600,
          color: 'white',
          backgroundColor: loading || !secret ? '#999' : '#dc2626',
          border: 'none',
          borderRadius: 6,
          cursor: loading || !secret ? 'not-allowed' : 'pointer',
          marginBottom: 16,
        }}
      >
        ⏹ 立刻關閉超早鳥（cutoff = NOW）
      </button>

      {/* 設新截止日 */}
      <div
        style={{
          padding: 16,
          backgroundColor: '#f9fafb',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>📅 設新截止日（延長 / 縮短）</div>
        <input
          type="datetime-local"
          value={pickerValue}
          onChange={(e) => setPickerValue(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: 14,
            border: '1px solid #ccc',
            borderRadius: 6,
            marginBottom: 12,
          }}
        />
        <button
          onClick={handleSetCutoff}
          disabled={loading || !secret || !pickerValue}
          style={{
            width: '100%',
            padding: '12px',
            fontSize: 14,
            fontWeight: 600,
            color: 'white',
            backgroundColor: loading || !secret || !pickerValue ? '#999' : '#0b6e39',
            border: 'none',
            borderRadius: 6,
            cursor: loading || !secret || !pickerValue ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? '送出中…' : '✅ 套用截止日'}
        </button>
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
          }}
        >
          ✅ 已更新 cutoff_at = {result.cutoff_at}
          <br />
          當前 super_early_active = {result.super_early_active ? 'true' : 'false'}
        </div>
      )}

      <hr style={{ marginTop: 32, marginBottom: 16, border: 'none', borderTop: '1px solid #eee' }} />
      <p style={{ fontSize: 12, color: '#999' }}>
        相關工具：<a href="/admin/reset-v32" style={{ color: '#0b6e39' }}>重置自己 DB</a>
      </p>
    </div>
  );
}
