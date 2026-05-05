// lib/google-sheets.js
// GoogleSheet 整合：報名表雙向同步（系統 ↔ sheet）
//
// 環境變數（必設）：
//   GOOGLE_SERVICE_ACCOUNT_JSON  — Service Account 金鑰整段 JSON
//   APPLICATIONS_SHEET_ID        — Sheet ID（從 sheet 網址 /d/ 後抓）
//
// 環境變數（選設）：
//   APPLICATIONS_SHEET_TAB       — sheet 分頁名（default: 工作表1）
//
// Sheet 欄位（A-Q 共 17 欄）：
//   A 報名ID | B 報名時間 | C 姓名 | D 電話 | E Email | F 地址 | G 性別 | H 年齡
//   I LINE ID | J LINE 顯示名 | K 方案 | L 備註 | M 發票 | N 後五碼 | O 繳費金額 | P 匯款日期 | Q 狀態
//
// 設計原則：
//   - sheet 是對帳真相（cron 每 10 分鐘從 sheet 讀回更新 DB）
//   - M 欄（發票）系統不寫，留 sheet 上 Annie 自填，sync 時跳過
//   - 環境變數沒設 → 整段 silently skip（不影響主流程）
//   - 任何失敗 → log error，不丟錯（保證主流程繼續）

import crypto from 'crypto';

const SHEETS_API = 'https://sheets.googleapis.com/v4';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

const STATUS_TO_CHAR = { paid: 'V', cancelled: 'X', pending: '' };
const GENDER_ZH = { male: '男', female: '女', other: '其他' };
const PROGRAM_ZH = { '12weeks': '12 週完整版', '4weeks_trial': '4 週體驗版' };

// ============================================================
// 環境變數 / 啟用判定
// ============================================================

export function isSheetSyncEnabled() {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !!process.env.APPLICATIONS_SHEET_ID;
}

function getServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    if (!sa.client_email || !sa.private_key) {
      console.error('[google-sheets] SA JSON missing client_email or private_key');
      return null;
    }
    return sa;
  } catch (err) {
    console.error('[google-sheets] parse SA JSON failed:', err.message);
    return null;
  }
}

function getSheetId() {
  return process.env.APPLICATIONS_SHEET_ID || null;
}

function getSheetTab() {
  return process.env.APPLICATIONS_SHEET_TAB || '工作表1';
}

// ============================================================
// JWT 簽名 + access token（Service Account OAuth 2.0）
// ============================================================

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(serviceAccount) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key);
  const signatureB64 = signature
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${signingInput}.${signatureB64}`;
}

// in-memory cache：同 serverless instance 內共用 access_token，省一次 OAuth round-trip
let _tokenCache = null; // { token, expires_at_ms }

async function getAccessToken() {
  if (_tokenCache && _tokenCache.expires_at_ms > Date.now() + 60_000) {
    return _tokenCache.token;
  }
  const sa = getServiceAccount();
  if (!sa) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set or invalid');

  const jwt = signJwt(sa);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`get_access_token_failed: ${res.status} ${text}`);
  }
  const json = await res.json();
  _tokenCache = {
    token: json.access_token,
    // 提前 2 分鐘換新（Google 預設 1 小時）
    expires_at_ms: Date.now() + (json.expires_in - 120) * 1000,
  };
  return json.access_token;
}

// ============================================================
// 欄位映射
// ============================================================

function fmtTpeDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // 台北時區 YYYY/MM/DD HH:mm
  const date = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  const time = d
    .toLocaleTimeString('en-GB', { timeZone: 'Asia/Taipei', hour12: false })
    .slice(0, 5);
  return `${date.replace(/-/g, '/')} ${time}`;
}

/**
 * 把 application row → sheet 17 欄陣列（A-Q）
 * M 欄（發票）一律空字串：系統不動 M 欄，留給 Annie 在 sheet 上自填
 */
export function applicationToRow(app) {
  return [
    String(app.id ?? ''),
    fmtTpeDateTime(app.submitted_at),
    app.real_name ?? '',
    app.phone ?? '',
    app.email ?? '',
    app.address ?? '',
    GENDER_ZH[app.gender] || app.gender || '',
    app.age != null ? String(app.age) : '',
    app.line_id ?? '',
    app.display_name ?? '',
    PROGRAM_ZH[app.program_choice] || app.program_choice || '',
    app.notes ?? '',
    '', // M 發票（系統不寫，留 sheet 自填）
    app.payment_last5 ?? '',
    app.payment_amount != null ? String(app.payment_amount) : '',
    app.payment_date ?? '',
    STATUS_TO_CHAR[app.status] ?? '',
  ];
}

// ============================================================
// Sheet 操作 API
// ============================================================

/**
 * Append 一筆 application 到 sheet 末端
 * @param {Object} app  完整 application row
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function appendApplicationRow(app) {
  if (!isSheetSyncEnabled()) {
    console.warn('[google-sheets] sync not enabled, skip append');
    return { ok: false, error: 'not_enabled' };
  }
  try {
    const token = await getAccessToken();
    const sheetId = getSheetId();
    const tab = getSheetTab();
    const range = encodeURIComponent(`${tab}!A:Q`);
    const url =
      `${SHEETS_API}/spreadsheets/${sheetId}/values/${range}:append` +
      `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [applicationToRow(app)] }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[google-sheets] append failed:', res.status, text);
      return { ok: false, error: `${res.status} ${text}` };
    }
    return { ok: true };
  } catch (err) {
    console.error('[google-sheets] append exception:', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * 在 sheet A 欄找指定 application id 的 row 編號（1-based, 含 header）
 * 沒找到回 null
 */
export async function findRowByApplicationId(applicationId) {
  if (!isSheetSyncEnabled()) return null;
  try {
    const token = await getAccessToken();
    const sheetId = getSheetId();
    const tab = getSheetTab();
    const range = encodeURIComponent(`${tab}!A:A`);
    const url = `${SHEETS_API}/spreadsheets/${sheetId}/values/${range}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[google-sheets] read column A failed:', res.status, text);
      return null;
    }
    const json = await res.json();
    const rows = json.values || [];
    const target = String(applicationId);
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i][0] || '').trim() === target) {
        return i + 1; // 1-based
      }
    }
    return null;
  } catch (err) {
    console.error('[google-sheets] findRow exception:', err?.message || err);
    return null;
  }
}

/**
 * 把 application 同步到 sheet 對應 row（系統區 A-L + 對帳區 N-Q，跳過 M 發票欄）
 * 找不到對應 row → fallback 用 append（避免漏）
 */
export async function syncApplicationToSheet(applicationId, app) {
  if (!isSheetSyncEnabled()) return { ok: false, error: 'not_enabled' };
  try {
    const rowIdx = await findRowByApplicationId(applicationId);
    if (!rowIdx) {
      console.log('[google-sheets] sync row not found, fallback append:', applicationId);
      return await appendApplicationRow(app);
    }

    const token = await getAccessToken();
    const sheetId = getSheetId();
    const tab = getSheetTab();
    const fullRow = applicationToRow(app);
    // 切成兩段，避開 M 欄（index 12）
    const aToL = fullRow.slice(0, 12);
    const nToQ = fullRow.slice(13, 17);

    const url = `${SHEETS_API}/spreadsheets/${sheetId}/values:batchUpdate`;
    const body = {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `${tab}!A${rowIdx}:L${rowIdx}`, values: [aToL] },
        { range: `${tab}!N${rowIdx}:Q${rowIdx}`, values: [nToQ] },
      ],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[google-sheets] batchUpdate failed:', res.status, text);
      return { ok: false, error: `${res.status} ${text}` };
    }
    return { ok: true, rowIdx };
  } catch (err) {
    console.error('[google-sheets] sync exception:', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * 把 sheet 上的日期欄位 normalize 成 markPaid 期待的 YYYY-MM-DD 格式
 * 接受：2026-05-05 / 2026-5-5 / 2026/05/05 / 2026/5/5
 * 不認識的格式直接回原樣（讓下游 markPaid 驗證 fail）
 */
export function normalizeDateForDb(input) {
  if (input === null || input === undefined) return '';
  const s = String(input).trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) return s;
  const y = m[1];
  const month = m[2].padStart(2, '0');
  const day = m[3].padStart(2, '0');
  return `${y}-${month}-${day}`;
}

/**
 * 把 sheet 上的金額欄位 normalize 成純數字字串
 * 接受：10400 / 10,400 / NT$10,400 / $10,400 / "10400 元" 等
 * 邏輯：保留數字 + 小數點 + 負號，去除其他字元
 */
export function normalizeAmountForDb(input) {
  if (input === null || input === undefined) return '';
  const s = String(input).trim();
  if (!s) return '';
  return s.replace(/[^\d.-]/g, '');
}

/**
 * 讀回整張 sheet 的對帳資訊（給 cron 同步用）
 * 跳過 header（row 1），只回 row 2 起的有 application_id 的 row
 *
 * date 與 amount 已經過 normalize（接受常見格式，避免人工輸入格式不一造成 invalid_*）
 *
 * @returns {Promise<Array<{
 *   rowIdx: number,
 *   applicationId: number,
 *   statusChar: 'V'|'X'|'',
 *   last5: string,
 *   amount: string,
 *   date: string,
 *   notes: string,
 * }>>}
 */
export async function readSheetRowsForSync() {
  if (!isSheetSyncEnabled()) return [];
  try {
    const token = await getAccessToken();
    const sheetId = getSheetId();
    const tab = getSheetTab();
    const range = encodeURIComponent(`${tab}!A:Q`);
    const url = `${SHEETS_API}/spreadsheets/${sheetId}/values/${range}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[google-sheets] read sheet failed:', res.status, text);
      return [];
    }
    const json = await res.json();
    const rows = json.values || [];
    const out = [];
    // i=0 是 header
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const applicationId = parseInt((row[0] || '').trim(), 10);
      if (!Number.isInteger(applicationId)) continue;
      out.push({
        rowIdx: i + 1,
        applicationId,
        statusChar: (row[16] || '').trim().toUpperCase(),  // Q
        last5: (row[13] || '').trim(),                     // N
        amount: normalizeAmountForDb(row[14]),             // O — 接受 10,400 / NT$10,400 / 10400
        date: normalizeDateForDb(row[15]),                 // P — 接受 2026/5/5 / 2026-5-5 / 2026-05-05
        notes: (row[11] || '').trim(),                     // L
      });
    }
    return out;
  } catch (err) {
    console.error('[google-sheets] readSheet exception:', err?.message || err);
    return [];
  }
}