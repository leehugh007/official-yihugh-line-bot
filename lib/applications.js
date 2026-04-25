// lib/applications.js
// Phase 4.5 admin 報名管理 — 狀態機 helper
//
// 唯一入口：admin route.js / cron / 未來金流 webhook 全部走這裡，不直接 update applications 表。
// 規則集中 = 狀態機規則只有一份；新增 transition rule 改一處全 path 同步。
//
// 狀態機：
//   pending  → paid       (markPaid)        必填 last5/amount/date + marked_by
//   pending  → cancelled  (markCancelled)   必填 marked_by + 選填 notes
//   paid     → cancelled  (markCancelled)   退費場景，必填 marked_by + 選填 notes
//   cancelled→ X          REJECTED          重新報名要新 row
//
// 不動 official_line_users（path_stage=8、enrolled_at 在 submit 時已寫）

import supabase from './supabase.js';

const ALLOWED_TRANSITIONS = {
  pending: new Set(['paid', 'cancelled']),
  paid: new Set(['cancelled']),
  cancelled: new Set(),
};

const ALLOWED_MARKED_BY = new Set(['yixiu', 'wanxin']);

/**
 * GET 列出 applications（admin GET 用）
 * @param {Object} opts
 * @param {'all'|'pending'|'paid'|'cancelled'} opts.filter
 * @param {number} opts.limit  default 50
 * @param {number} opts.offset default 0
 * @returns {Promise<{rows: Array, total: number}>}
 */
export async function listApplications({ filter = 'all', limit = 50, offset = 0 } = {}) {
  let query = supabase
    .from('official_program_applications')
    .select('*', { count: 'exact' })
    .order('submitted_at', { ascending: false });

  if (filter !== 'all') {
    query = query.eq('status', filter);
  }
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    console.error('[applications/list] error:', error);
    throw new Error(`list_failed: ${error.message}`);
  }

  return {
    rows: (data || []).map(maskRow),
    total: count || 0,
  };
}

/**
 * 把 row 的後五碼 mask 成 ***XX 形式（admin GET 端點 PII 防護）
 * 完整值只在 single-row fetch 給管理員看（getApplicationFull）
 */
function maskRow(row) {
  if (!row) return row;
  const last5 = row.payment_last5;
  return {
    ...row,
    payment_last5_masked: last5 ? `***${last5.slice(-2)}` : null,
    payment_last5: undefined, // 列表不回完整值
  };
}

/**
 * 單筆完整 fetch（編輯時才用），不 mask
 */
export async function getApplicationFull(id) {
  const { data, error } = await supabase
    .from('official_program_applications')
    .select('*')
    .eq('id', id)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`fetch_failed: ${error.message}`);
  }
  return data;
}

/**
 * 標記 paid
 * @param {number} id
 * @param {Object} payload
 * @param {string} payload.last5         必填 1-5 字（用戶提供）
 * @param {number} payload.amount        必填 NUMERIC(10,2)
 * @param {string} payload.date          必填 YYYY-MM-DD
 * @param {'yixiu'|'wanxin'} payload.marked_by  必填
 * @returns {Promise<{ok: true, application: Object}>}
 */
export async function markApplicationPaid(id, { last5, amount, date, marked_by }) {
  // 1. 驗 input
  if (!Number.isInteger(id) || id < 1) {
    return { ok: false, error: 'invalid_id' };
  }
  if (!ALLOWED_MARKED_BY.has(marked_by)) {
    return { ok: false, error: 'invalid_marked_by' };
  }
  if (typeof last5 !== 'string' || !/^\d{1,5}$/.test(last5)) {
    return { ok: false, error: 'invalid_last5' };
  }
  const amountNum = parseFloat(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > 99999999) {
    return { ok: false, error: 'invalid_amount' };
  }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: 'invalid_date' };
  }

  // 2. 驗 transition
  const current = await getApplicationFull(id);
  if (!current) return { ok: false, error: 'not_found' };
  if (!ALLOWED_TRANSITIONS[current.status]?.has('paid')) {
    return {
      ok: false,
      error: 'invalid_transition',
      detail: `${current.status} → paid not allowed`,
    };
  }

  // 3. UPDATE
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('official_program_applications')
    .update({
      status: 'paid',
      paid_at: now,
      payment_last5: last5,
      payment_amount: amountNum,
      payment_date: date,
      paid_marked_by: marked_by,
      marked_at: now,
    })
    .eq('id', id)
    .eq('status', 'pending') // race guard：只有 pending 才能升 paid
    .select()
    .single();

  if (error) {
    console.error('[applications/mark_paid] update error:', error);
    return { ok: false, error: 'update_failed', detail: error.message };
  }
  if (!data) {
    return { ok: false, error: 'race_lost' };
  }

  return { ok: true, application: data };
}

/**
 * 標記 cancelled（pending 或 paid 都可）
 */
export async function markApplicationCancelled(id, { notes, marked_by }) {
  if (!Number.isInteger(id) || id < 1) {
    return { ok: false, error: 'invalid_id' };
  }
  if (!ALLOWED_MARKED_BY.has(marked_by)) {
    return { ok: false, error: 'invalid_marked_by' };
  }
  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    return { ok: false, error: 'invalid_notes' };
  }
  if (notes && notes.length > 500) {
    return { ok: false, error: 'notes_too_long' };
  }

  const current = await getApplicationFull(id);
  if (!current) return { ok: false, error: 'not_found' };
  if (!ALLOWED_TRANSITIONS[current.status]?.has('cancelled')) {
    return {
      ok: false,
      error: 'invalid_transition',
      detail: `${current.status} → cancelled not allowed`,
    };
  }

  const now = new Date().toISOString();
  const updateData = {
    status: 'cancelled',
    paid_marked_by: marked_by,
    marked_at: now,
  };
  // 只有提供 notes 才覆寫
  if (typeof notes === 'string') updateData.notes = notes;

  const { data, error } = await supabase
    .from('official_program_applications')
    .update(updateData)
    .eq('id', id)
    .in('status', ['pending', 'paid']) // race guard
    .select()
    .single();

  if (error) {
    console.error('[applications/cancel] update error:', error);
    return { ok: false, error: 'update_failed', detail: error.message };
  }
  if (!data) {
    return { ok: false, error: 'race_lost' };
  }

  return { ok: true, application: data };
}

/**
 * 更新匯款資訊（不改 status，pending 階段填部分資料用）
 * 任一欄位可選填，至少要有一個
 */
export async function updatePaymentInfo(id, { last5, amount, date, notes, marked_by }) {
  if (!Number.isInteger(id) || id < 1) {
    return { ok: false, error: 'invalid_id' };
  }
  if (!ALLOWED_MARKED_BY.has(marked_by)) {
    return { ok: false, error: 'invalid_marked_by' };
  }

  const updateData = { paid_marked_by: marked_by, marked_at: new Date().toISOString() };
  let touched = false;

  if (last5 !== undefined && last5 !== null && last5 !== '') {
    if (typeof last5 !== 'string' || !/^\d{1,5}$/.test(last5)) {
      return { ok: false, error: 'invalid_last5' };
    }
    updateData.payment_last5 = last5;
    touched = true;
  }
  if (amount !== undefined && amount !== null && amount !== '') {
    const amountNum = parseFloat(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > 99999999) {
      return { ok: false, error: 'invalid_amount' };
    }
    updateData.payment_amount = amountNum;
    touched = true;
  }
  if (date !== undefined && date !== null && date !== '') {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, error: 'invalid_date' };
    }
    updateData.payment_date = date;
    touched = true;
  }
  if (notes !== undefined && notes !== null) {
    if (typeof notes !== 'string' || notes.length > 500) {
      return { ok: false, error: 'invalid_notes' };
    }
    updateData.notes = notes;
    touched = true;
  }

  if (!touched) return { ok: false, error: 'nothing_to_update' };

  // 不能編輯 cancelled
  const current = await getApplicationFull(id);
  if (!current) return { ok: false, error: 'not_found' };
  if (current.status === 'cancelled') {
    return { ok: false, error: 'cannot_edit_cancelled' };
  }

  const { data, error } = await supabase
    .from('official_program_applications')
    .update(updateData)
    .eq('id', id)
    .neq('status', 'cancelled')
    .select()
    .single();

  if (error) {
    console.error('[applications/update_payment] error:', error);
    return { ok: false, error: 'update_failed', detail: error.message };
  }
  if (!data) {
    return { ok: false, error: 'race_lost' };
  }

  return { ok: true, application: data };
}
