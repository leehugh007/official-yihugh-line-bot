// Q5 轉換漏斗契約 v2.4 Ch.0.9：HMAC signed URL helper
//
// 用途：
//   Bot 推 Q5 軟邀請訊息時，/apply URL 帶 sig 防止 URL 造假 + 過期
//   LINE 2024 policy 讓 LIFF userId server-side 驗證做不到（Login channel 跟
//   Messaging API namespace 不同 hash），LIFF 只當 UX 骨架，authority 在這支 helper
//
// 擋什麼：
//   - URL 造假（自己寫 /apply?userid=U_stranger）→ sig 對不上 reject
//   - 過期 URL（24h 前 Bot 推的）→ ts 比對 reject
//   - key version 被換（rotate 過渡期）→ 多版 secret 並存
//
// 不擋什麼：
//   - LINE-to-LINE 分享污染（契約 Ch.12.1a，Phase 4.5 觀察期再評估是否加手機驗證碼）
//
// 環境變數：
//   Q5_APPLY_SIGNING_SECRET_V1 / V2 / ...   HMAC secret 本體（每版 ≥32 bytes random）
//   Q5_APPLY_SIGNING_KEY_VERSION            當前 signing version（生 URL 用）
//   Q5_APPLY_SIG_MAX_AGE_SEC                URL 過期秒數（預設 86400 = 24h）

import crypto from 'crypto';
import { getSettingTyped } from './official-settings.js';

// 白名單（契約 v2.4 修 adversarial Critical #1 — payload injection 防禦）
const USERID_RE = /^U[0-9a-f]{32}$/;
const TS_RE = /^\d{10}$/; // 10 位 unix sec（涵蓋 2001~2286 年）
const KV_RE = /^[1-9][0-9]?$/; // 1-99
const SIG_MIN_LEN = 20;
const SIG_MAX_LEN = 100;
const SOURCE_ALLOWED = new Set(['bot_q5']);
const TRIGGER_ALLOWED = new Set(['passive', 'active']);

/**
 * Canonical payload — 固定字母序，不走 URLSearchParams 避免 encode 差異。
 * 注意：此函式假設所有輸入都是 primitive string/number，不做 shape check。
 * 呼叫前端必須先 shape check（buildQ5ApplyUrl 建時保證，verify 時白名單保證）。
 */
export function buildQ5ApplyPayload({ userid, source, trigger, kv, ts }) {
  return `kv=${kv}&source=${source}&ts=${ts}&trigger=${trigger}&userid=${userid}`;
}

/**
 * 產生 Q5 軟邀請 URL（Bot 端呼叫）
 */
export async function buildQ5ApplyUrl({ userId, triggerSource }) {
  if (!USERID_RE.test(userId)) {
    throw new Error(`buildQ5ApplyUrl: invalid userId shape: ${userId}`);
  }
  if (!TRIGGER_ALLOWED.has(triggerSource)) {
    throw new Error(`buildQ5ApplyUrl: invalid triggerSource: ${triggerSource}`);
  }

  const base = await getSettingTyped('apply_url_base');
  if (!base) throw new Error('buildQ5ApplyUrl: apply_url_base not set');

  const kv = parseInt(process.env.Q5_APPLY_SIGNING_KEY_VERSION || '1', 10);
  const secret = process.env[`Q5_APPLY_SIGNING_SECRET_V${kv}`];
  if (!secret) {
    throw new Error(`buildQ5ApplyUrl: Q5_APPLY_SIGNING_SECRET_V${kv} missing`);
  }

  const ts = Math.floor(Date.now() / 1000);
  const params = {
    userid: userId,
    source: 'bot_q5',
    trigger: triggerSource,
    kv,
    ts,
  };
  const payload = buildQ5ApplyPayload(params);
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const qs = new URLSearchParams({ ...params, sig }).toString();
  return `${base}?${qs}`;
}

/**
 * 驗證 signed URL 參數（Server 端 /api/apply/* 呼叫）
 *
 * 同步函數，不打 DB — max_age 走 env 避免 verify 熱路徑 50-200ms DB 延遲
 *
 * 回傳：
 *   { ok: true }                              ← 驗證通過
 *   { ok: false, reason: '<reason>' }         ← 內部 log 用，對外應統一回 invalid_signature
 *
 * reason 可能值（Server log 用，不要對外洩漏）：
 *   missing_param / bad_userid_shape / bad_source / bad_trigger / bad_key_version /
 *   bad_ts_type / bad_ts_shape / bad_sig_shape / unknown_key_version / bad_sig /
 *   expired / future_ts
 */
export function verifyQ5ApplySig({ userid, source, trigger, kv, ts, sig } = {}) {
  // 1. 全欄位存在性
  if (!userid || !source || !trigger || kv == null || ts == null || !sig) {
    return { ok: false, reason: 'missing_param' };
  }

  // 2. Shape whitelist（防 payload injection）
  if (typeof userid !== 'string' || !USERID_RE.test(userid)) {
    return { ok: false, reason: 'bad_userid_shape' };
  }
  if (typeof source !== 'string' || !SOURCE_ALLOWED.has(source)) {
    return { ok: false, reason: 'bad_source' };
  }
  if (typeof trigger !== 'string' || !TRIGGER_ALLOWED.has(trigger)) {
    return { ok: false, reason: 'bad_trigger' };
  }
  const kvStr = String(kv);
  if (!KV_RE.test(kvStr)) {
    return { ok: false, reason: 'bad_key_version' };
  }
  const kvInt = parseInt(kvStr, 10);

  if (typeof ts !== 'string' && typeof ts !== 'number') {
    return { ok: false, reason: 'bad_ts_type' };
  }
  const tsStr = String(ts);
  if (!TS_RE.test(tsStr)) return { ok: false, reason: 'bad_ts_shape' };

  if (typeof sig !== 'string' || sig.length < SIG_MIN_LEN || sig.length > SIG_MAX_LEN) {
    return { ok: false, reason: 'bad_sig_shape' };
  }

  // 3. Key version 可識別
  const secret = process.env[`Q5_APPLY_SIGNING_SECRET_V${kvInt}`];
  if (!secret) return { ok: false, reason: 'unknown_key_version' };

  // 4. HMAC 驗證（timingSafeEqual 前做 length 保護）
  const payload = buildQ5ApplyPayload({
    userid,
    source,
    trigger,
    kv: kvInt,
    ts: tsStr,
  });
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const expectedBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(sig);
  if (expectedBuf.length !== sigBuf.length) return { ok: false, reason: 'bad_sig' };
  if (!crypto.timingSafeEqual(expectedBuf, sigBuf)) return { ok: false, reason: 'bad_sig' };

  // 5. 時間檢查（env，不打 DB）
  const tsInt = parseInt(tsStr, 10);
  const now = Math.floor(Date.now() / 1000);
  const maxAge = parseInt(process.env.Q5_APPLY_SIG_MAX_AGE_SEC || '86400', 10);
  if (now - tsInt > maxAge) return { ok: false, reason: 'expired' };
  if (tsInt - now > 300) return { ok: false, reason: 'future_ts' }; // clock skew 5min

  return { ok: true };
}
