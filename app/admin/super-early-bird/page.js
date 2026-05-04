'use client';

// V3.2 三段價控制台（migration_019）
// URL: /admin/super-early-bird?secret=ADMIN_SECRET
//
// 業務時間軸：
//   NOW < super_cutoff                → super ($10,400)
//   super_cutoff <= NOW < regular_cutoff → regular ($11,400)
//   NOW >= regular_cutoff             → anchor ($12,600 真實成交)
//
// 操作：兩個 DateTimePicker（超早鳥截止 + 一般早鳥截止），各有「套用」+「立刻關閉」按鈕

import { useState, useEffect, useCallback } from 'react';

const TIER_LABEL = {
  super: { emoji: '🔥', name: '超早鳥優惠中', color: '#dc2626' },
  regular: { emoji: '🌱', name: '一般早鳥優惠中', color: '#0b6e39' },
  anchor: { emoji: '⏸', name: '兩段早鳥皆已結束（原價成交）', color: '#92400e' },
};

function toLocalInput(isoStr) {
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
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function diffDisplay(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr).getTime() - Date.now();
  if (d > 0) {
    const days = Math.floor(d / 86400000);
    const hours = Math.floor((d % 86400000) / 3600000);
    return `剩 ${days} 天 ${hours} 小時`;
  }
  return `已過期 ${Math.floor(-d / 86400000)} 天`;
}

export default function SuperEarlyBirdPage() {
  const [secret, setSecret] = useState('');
  const [pricing, setPricing] = useState(null);
  const [superPicker, setSuperPicker] = useState('');
  const [regularPicker, setRegularPicker] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('secret');
    if (s) setSecret(s);
  }, []);

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
      const map = {};
      (data.settings || data || []).forEach((s) => {
        if (s.key) map[s.key] = s.value;
      });

      const super_cutoff_at = map.super_early_bird_cutoff_at || null;
      const regular_cutoff_at = map.regular_early_bird_cutoff_at || null;
      const now = new Date();
      const superDate = super_cutoff_at ? new Date(super_cutoff_at) : null;
      const regularDate = regular_cutoff_at ? new Date(regular_cutoff_at) : null;
      const superValid = superDate && !isNaN(superDate.getTime());
      const regularValid = regularDate && !isNaN(regularDate.getTime());

      const super_active = !!(superValid && now < superDate);
      const regular_active = !!(!super_active && regularValid && now < regularDate);
      const tier = super_active ? 'super' : regular_active ? 'regular' : 'anchor';

      setPricing({
        tier,
        super_active,
        regular_active,
        super_cutoff_at,
        regular_cutoff_at,
        prices: {
          super: parseInt(map.price_12weeks_super, 10) || 10400,
          regular: parseInt(map.price_12weeks_regular, 10) || 11400,
          anchor: parseInt(map.price_12weeks_anchor, 10) || 12600,
          trial: parseInt(map.price_4weeks_trial, 10) || 4980,
        },
      });
      setSuperPicker(toLocalInput(super_cutoff_at));
      setRegularPicker(toLocalInput(regular_cutoff_at));
    } catch (e) {
      setError(e.message);
    }
  }, [secret]);

  useEffect(() => {
    if (secret) loadPricing();
  }, [secret, loadPricing]);

  async function callSet(key, cutoff_at, confirmMsg) {
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
          action: 'set_pricing_cutoff',
          key,
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

  function handleApply(key, pickerValue, label) {
    if (!pickerValue) {
      setError('請選日期時間');
      return;
    }
    const localDate = new Date(pickerValue);
    if (isNaN(localDate.getTime())) {
      setError('日期格式錯誤');
      return;
    }
    const future = localDate > new Date();
    callSet(
      key,
      localDate.toISOString(),
      future
        ? `確定 ${label} 截止日設為 ${pickerValue}？`
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

  const tierMeta = pricing ? TIER_LABEL[pricing.tier] : null;
  const cardStyle = (active) => ({
    padding: 16,
    backgroundColor: active ? '#dcfce7' : '#f3f4f6',
    border: `1px solid ${active ? '#86efac' : '#d1d5db'}`,
    borderRadius: 8,
    marginBottom: 12,
  });

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '40px auto',
        padding: 20,
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      <h1 style={{ marginBottom: 8 }}>三段價控制台</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        改 cutoff_at 立即影響之後進 /apply 的人。三段：超早鳥（$10,400）→ 一般早鳥（$11,400）→ 原價（$12,600）。
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
      {pricing && tierMeta && (
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
            <div>超早鳥截止：<b>{toTaiwanDisplay(pricing.super_cutoff_at)}</b>（{diffDisplay(pricing.super_cutoff_at)}）</div>
            <div>一般早鳥截止：<b>{toTaiwanDisplay(pricing.regular_cutoff_at)}</b>（{diffDisplay(pricing.regular_cutoff_at)}）</div>
            <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid #d1d5db' }} />
            <div style={{ fontSize: 13, color: '#374151' }}>
              定價（12 週方案實際成交價）：
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                <li>超早鳥：NT$ {pricing.prices.super.toLocaleString()}（NOW &lt; super_cutoff）</li>
                <li>一般早鳥：NT$ {pricing.prices.regular.toLocaleString()}（super_cutoff ≤ NOW &lt; regular_cutoff）</li>
                <li>原價：NT$ {pricing.prices.anchor.toLocaleString()}（NOW ≥ regular_cutoff，5/24 後真實成交）</li>
                <li>4 週體驗版：NT$ {pricing.prices.trial.toLocaleString()}</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 超早鳥區 */}
      <div style={cardStyle(pricing?.super_active)}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 15 }}>
          🔥 超早鳥截止日 {pricing?.super_active && '（活躍中）'}
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
            disabled={loading || !secret || !superPicker}
            style={{
              flex: 1,
              padding: '10px',
              fontSize: 14,
              fontWeight: 600,
              color: 'white',
              backgroundColor: loading || !secret || !superPicker ? '#999' : '#0b6e39',
              border: 'none',
              borderRadius: 6,
              cursor: loading || !secret || !superPicker ? 'not-allowed' : 'pointer',
            }}
          >
            ✅ 套用
          </button>
          <button
            onClick={() => handleCloseNow('super_early_bird_cutoff_at', '超早鳥')}
            disabled={loading || !secret}
            style={{
              flex: 1,
              padding: '10px',
              fontSize: 14,
              fontWeight: 600,
              color: 'white',
              backgroundColor: loading || !secret ? '#999' : '#dc2626',
              border: 'none',
              borderRadius: 6,
              cursor: loading || !secret ? 'not-allowed' : 'pointer',
            }}
          >
            ⏹ 立刻關閉
          </button>
        </div>
      </div>

      {/* 一般早鳥區 */}
      <div style={cardStyle(pricing?.regular_active)}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 15 }}>
          🌱 一般早鳥截止日 {pricing?.regular_active && '（活躍中）'}
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
            disabled={loading || !secret || !regularPicker}
            style={{
              flex: 1,
              padding: '10px',
              fontSize: 14,
              fontWeight: 600,
              color: 'white',
              backgroundColor: loading || !secret || !regularPicker ? '#999' : '#0b6e39',
              border: 'none',
              borderRadius: 6,
              cursor: loading || !secret || !regularPicker ? 'not-allowed' : 'pointer',
            }}
          >
            ✅ 套用
          </button>
          <button
            onClick={() => handleCloseNow('regular_early_bird_cutoff_at', '一般早鳥')}
            disabled={loading || !secret}
            style={{
              flex: 1,
              padding: '10px',
              fontSize: 14,
              fontWeight: 600,
              color: 'white',
              backgroundColor: loading || !secret ? '#999' : '#dc2626',
              border: 'none',
              borderRadius: 6,
              cursor: loading || !secret ? 'not-allowed' : 'pointer',
            }}
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
          ✅ 已更新 {result.key} = {result.cutoff_at}
          <br />
          {result.is_future ? '截止日在未來（活躍）' : '截止日已過（不活躍）'}
        </div>
      )}

      <hr style={{ marginTop: 32, marginBottom: 16, border: 'none', borderTop: '1px solid #eee' }} />
      <p style={{ fontSize: 12, color: '#999' }}>
        相關工具：<a href="/admin/reset-v32" style={{ color: '#0b6e39' }}>重置自己 DB</a>
      </p>
    </div>
  );
}
