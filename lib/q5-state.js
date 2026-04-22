// Q5 狀態轉移 helper（契約 v2.3 Ch.0.8）
// 禁止 inline SQL 寫 q5_sent_at / path_stage → 6 / q5_followup_trigger_source / q5_intent。
// 所有 Q5 top-level 欄位寫入必經這個檔，確保：
//   1. atomic UPDATE（race guard）
//   2. rollback 有保護（.eq('path_stage', 6) 防 regress 已經被別處動過的 stage）
//   3. updateQ5Intent try/catch 不吞錯
//
// 實作前驗證 SOP：scripts/verify-q5-atomic.js（passive + active 雙模擬）
// 若驗證失敗 → pivot 走 PL/pgSQL function（契約 Ch.5.3 模板可抄）

import supabase from './supabase.js';

// 契約 Ch.2.2 應用層 enum（欄位本身 TEXT NULL，無 CHECK）
export const Q5_TRIGGER_SOURCES = ['passive', 'active'];

/**
 * 推進到 Q5 軟邀請（stage=4 → stage=6 + push 訊息）
 * 被動軌：用戶回訊息 + intent=continue 後呼叫
 * 主動軌：cron 掃 24h 沉默用戶後呼叫
 *
 * @param {object} params
 * @param {string} params.userId - LINE userId
 * @param {'passive'|'active'} params.source - 觸發來源
 * @param {(userId: string) => Promise<boolean>} params.pushFn - 推訊息函式，回 true=成功
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function performQ5Transition({ userId, source, pushFn }) {
  if (!Q5_TRIGGER_SOURCES.includes(source)) {
    console.error('[q5] invalid source:', source);
    return { ok: false, reason: 'invalid_source' };
  }

  const now = new Date().toISOString();
  const isActive = source === 'active';

  const updates = {
    path_stage: 6,
    path_stage_updated_at: now,
    q5_sent_at: now,
    q5_followup_trigger_source: source,
  };
  if (isActive) updates.q5_active_invite_sent_at = now;

  // Atomic UPDATE：WHERE q5_sent_at IS NULL → 只有一人會搶到（race guard）
  const { data: updated, error: updateErr } = await supabase
    .from('official_line_users')
    .update(updates)
    .eq('line_user_id', userId)
    .is('q5_sent_at', null)
    .select('line_user_id, path_stage');

  if (updateErr) {
    console.error('[q5] UPDATE failed:', updateErr, { userId, source });
    return { ok: false, reason: 'db_error' };
  }
  if (!updated || updated.length === 0) {
    // 另一軌已推過，或 q5_sent_at 已被寫（被動/主動互斥的 race 守門）
    return { ok: false, reason: 'race_lost' };
  }

  // UPDATE 成功，推訊息
  const pushOk = await pushFn(userId);
  if (!pushOk) {
    // 推失敗 → rollback path_stage 讓 webhook pre-check 不誤判（yi-challenge #2）
    // 但保留 q5_sent_at + trigger_source + active_invite_sent_at，防 cron 重推
    //
    // yi-challenge #1 洞決策：
    //   LINE pushMessage 回 false 有灰色地帶 — timeout 或 5xx 可能訊息已投遞，
    //   只是 response 沒回。若 rollback q5_sent_at → cron 下輪又打一次 → 用戶收兩次。
    //   保守策略：保留 q5_sent_at，寧可失一次（cron 不補，用戶沒看到 Q5）
    //   也不要重一次（破壞 yi-voice 自然感）。
    //   Phase 4.5 觀察期若發現「點擊率異常低」再討論是否需要 stricter retry policy。
    //
    // .eq('path_stage', 6) 保護：若 stage 已被別處動（如 handoff → 5），不 regress
    // rollback 本身失敗（DB 不通）→ stage 卡 6 但 q5_sent_at 有值 → Ch.5.5 48h cron reset
    const rollback = {
      path_stage: 4,
      path_stage_updated_at: new Date().toISOString(),
    };

    const { error: rollbackErr } = await supabase
      .from('official_line_users')
      .update(rollback)
      .eq('line_user_id', userId)
      .eq('path_stage', 6);

    if (rollbackErr) {
      console.error('[q5] rollback failed:', rollbackErr, { userId, source });
      // 不改回傳：rollback 失敗時 stage 可能卡 6，靠 48h cron reset
    }

    return { ok: false, reason: 'push_failed_rollback' };
  }

  return { ok: true };
}

/**
 * 寫 q5_intent（被動軌 AI 分類後呼叫 / 主動軌不會呼叫）
 * 值域：'continue' / 'decline' / 'ai_failed'
 * - continue: AI 判用戶想繼續聊
 * - decline: AI 判用戶想結束
 * - ai_failed: 所有 AI 錯誤情境（timeout / api error / safety filter / parse fail / validator reject）
 *
 * 主動軌 SQL 條件：`q5_intent NOT IN ('decline', 'ai_failed')` → 只排除明確不想推的
 *
 * @param {string} userId
 * @param {'continue'|'decline'|'ai_failed'} intent
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function updateQ5Intent(userId, intent) {
  if (!['continue', 'decline', 'ai_failed'].includes(intent)) {
    console.error('[q5] invalid intent:', intent);
    return { ok: false, error: 'invalid_intent' };
  }

  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('official_line_users')
      .update({ q5_intent: intent, q5_classified_at: now })
      .eq('line_user_id', userId);

    if (error) {
      console.error('[q5] updateQ5Intent failed:', error, { userId, intent });
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error('[q5] updateQ5Intent exception:', e, { userId, intent });
    return { ok: false, error: String(e) };
  }
}
