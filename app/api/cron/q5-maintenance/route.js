// Q5 維運 cron — 每小時跑一次
// Vercel Cron: 0 * * * *
// 手動觸發: GET /api/cron/q5-maintenance?secret=xxx
//
// 契約 v2.4 Ch.4.3 / Ch.5.1b / Ch.5.4 / Ch.5.5 / Ch.5.6
//
// 4 段邏輯（獨立 try/catch，任一段失敗不影響其他段）：
//
// 1. 主動軌（Ch.5.1b）：stage=4 + q4_classified_at < now()-24h + q5_sent_at IS NULL
//    + q5_intent NOT IN (decline, ai_failed) + 意願 != low + 用戶 Q4 後未回訊
//    → performQ5Transition(source='active') + pushQ5SoftInvite
//
// 2. Visit-followup（Ch.5.4）：stage=7 + q5_clicked_at < now()-24h
//    + q5_visit_followup_sent_at IS NULL + click_count >= 1
//    → pushMessage q5_visit_followup_text
//
// 3. Reset（Ch.5.5）：stage=6 + q5_sent_at < now()-48h 無反應
//    → 回 stage=4 + 清 q5_sent_at + q5_followup_trigger_source
//
// 4. Notify retry（Ch.5.6）：applications notify_status in (pending, failed)
//    → push 通知一休 + 婉馨 + 更新 notify_status
//
// 防呆：
//   - q5_test_mode_cron=true → 主動軌 + visit-followup 跳過 TEST_ALLOWLIST
//   - performQ5Transition race guard：另一路已推 → 自動跳過
//   - visit-followup 用 q5_visit_followup_sent_at IS NULL 做 race guard

import { NextResponse } from 'next/server';
import supabase from '../../../../lib/supabase.js';
import { pushMessage, textMessage } from '../../../../lib/line.js';
import { getSettingTyped } from '../../../../lib/official-settings.js';
import { performQ5Transition } from '../../../../lib/q5-state.js';
import { pushQ5SoftInvite } from '../../../../lib/q5-message.js';
import { NOTIFY_USER_IDS, TEST_ALLOWLIST } from '../../../../lib/constants.js';

// 契約 Ch.4.3：maxDuration 60s
export const maxDuration = 60;

// 並發 cap（比 drip 20 保守，AI cost + LINE rate limit）
const CONCURRENCY = 10;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  const isAuthorized =
    secret === process.env.ADMIN_SECRET ||
    request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = {
    active: null,
    visit_followup: null,
    reset: null,
    notify_retry: null,
    errors: [],
  };

  // 4 段獨立 try/catch — 任一失敗不影響其他段
  try {
    result.active = await runActiveFollowup();
  } catch (err) {
    console.error('[q5-maintenance] active failed:', err);
    result.errors.push({ phase: 'active', error: err?.message || String(err) });
  }

  try {
    result.visit_followup = await runVisitFollowup();
  } catch (err) {
    console.error('[q5-maintenance] visit_followup failed:', err);
    result.errors.push({ phase: 'visit_followup', error: err?.message || String(err) });
  }

  try {
    result.reset = await runReset();
  } catch (err) {
    console.error('[q5-maintenance] reset failed:', err);
    result.errors.push({ phase: 'reset', error: err?.message || String(err) });
  }

  try {
    result.notify_retry = await runNotifyRetry();
  } catch (err) {
    console.error('[q5-maintenance] notify_retry failed:', err);
    result.errors.push({ phase: 'notify_retry', error: err?.message || String(err) });
  }

  return NextResponse.json({ ok: result.errors.length === 0, ...result });
}

// 並發 helper（抄 drip pattern）
async function runWithConcurrency(tasks, concurrency = CONCURRENCY) {
  const results = [];
  let i = 0;
  async function next() {
    const idx = i++;
    if (idx >= tasks.length) return;
    results[idx] = await tasks[idx]();
    await next();
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => next())
  );
  return results;
}

// ============================================================
// 段 1：主動軌（契約 Ch.5.1b）
// ============================================================
async function runActiveFollowup() {
  const hours = (await getSettingTyped('q5_active_followup_hours')) ?? 24;
  // PR #52：restricted=true 時 cron 只推 TEST_ALLOWLIST（一休+婉馨）
  // restricted=false 時全量推（不限制 line_user_id）
  const restricted = await getSettingTyped('q5_restricted_to_test_users');
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  // PostgREST JSONB 比對較侷限，先寬鬆 SELECT 再在 JS 層過濾 ai_tags 條件。
  // 候選：stage=4 + q5_sent_at IS NULL + 未 block
  let query = supabase
    .from('official_line_users')
    .select('line_user_id, ai_tags, last_user_reply_at, q5_intent')
    .eq('path_stage', 4)
    .is('q5_sent_at', null)
    .eq('is_blocked', false);

  if (restricted === true) {
    query = query.in('line_user_id', TEST_ALLOWLIST);
  }

  const { data: candidates, error } = await query.limit(500);
  if (error) throw error;

  const eligible = (candidates || []).filter((u) => {
    // 排除：q5_intent = decline / ai_failed（用戶已明示不要）
    if (u.q5_intent === 'decline' || u.q5_intent === 'ai_failed') return false;
    const tags = u.ai_tags || {};
    const classifiedAt = tags.q4_classified_at;
    if (!classifiedAt) return false; // Q4 未完成，跳過
    if (new Date(classifiedAt) >= new Date(cutoff)) return false; // Q4 < 24h 新鮮，讓被動軌有機會
    // 意願 low → skip
    if (tags['意願'] === 'low') return false;
    // last_user_reply_at >= q4_classified_at → 用戶 Q4 後有回話（已經走被動軌）
    if (u.last_user_reply_at && new Date(u.last_user_reply_at) >= new Date(classifiedAt)) {
      return false;
    }
    return true;
  });

  console.log(
    `[q5-maintenance/active] ${candidates?.length || 0} candidates, ${eligible.length} eligible`
  );

  const tasks = eligible.map((u) => async () => {
    try {
      const r = await performQ5Transition({
        userId: u.line_user_id,
        source: 'active',
        pushFn: (uid) => pushQ5SoftInvite(uid, 'active'),
      });
      return { userId: u.line_user_id, ok: r.ok, reason: r.reason };
    } catch (err) {
      console.error('[q5-maintenance/active] user failed:', u.line_user_id, err?.message);
      return {
        userId: u.line_user_id,
        ok: false,
        reason: 'exception',
        error: err?.message,
      };
    }
  });

  const results = await runWithConcurrency(tasks, CONCURRENCY);
  const sent = results.filter((r) => r.ok).length;
  const skipped = results.filter((r) => !r.ok).length;

  return {
    candidates: candidates?.length || 0,
    eligible: eligible.length,
    sent,
    skipped,
  };
}

// ============================================================
// 段 2：Visit-followup（契約 Ch.5.4）
// ============================================================
async function runVisitFollowup() {
  const hours = (await getSettingTyped('q5_visit_followup_hours')) ?? 24;
  // PR #52：restricted=true 時只推 TEST_ALLOWLIST
  const restricted = await getSettingTyped('q5_restricted_to_test_users');
  const text = await getSettingTyped('q5_visit_followup_text');
  if (!text || typeof text !== 'string') {
    console.warn('[q5-maintenance/visit_followup] q5_visit_followup_text missing, skip');
    return { skipped: 'setting_missing' };
  }

  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  let query = supabase
    .from('official_line_users')
    .select('line_user_id, q5_click_count')
    .eq('path_stage', 7)
    .is('q5_visit_followup_sent_at', null)
    .lt('q5_clicked_at', cutoff)
    .eq('is_blocked', false);

  if (restricted === true) {
    query = query.in('line_user_id', TEST_ALLOWLIST);
  }

  const { data: candidates, error } = await query.limit(500);
  if (error) throw error;

  // 防分享污染粗篩：click_count 至少 1 次（契約 Ch.12.1a）
  const eligible = (candidates || []).filter((u) => (u.q5_click_count || 0) >= 1);

  console.log(
    `[q5-maintenance/visit_followup] ${candidates?.length || 0} candidates, ${eligible.length} eligible`
  );

  const now = new Date().toISOString();
  const tasks = eligible.map((u) => async () => {
    try {
      const pushOk = await pushMessage(u.line_user_id, [textMessage(text)]);
      if (!pushOk) {
        return { userId: u.line_user_id, ok: false, reason: 'push_failed' };
      }
      // 寫入 q5_visit_followup_sent_at（race guard IS NULL 防並跑）
      const { error: upErr } = await supabase
        .from('official_line_users')
        .update({ q5_visit_followup_sent_at: now })
        .eq('line_user_id', u.line_user_id)
        .is('q5_visit_followup_sent_at', null);
      if (upErr) {
        console.error('[q5-maintenance/visit_followup] update failed:', u.line_user_id, upErr);
        return { userId: u.line_user_id, ok: false, reason: 'db_error' };
      }
      return { userId: u.line_user_id, ok: true };
    } catch (err) {
      console.error('[q5-maintenance/visit_followup] user failed:', u.line_user_id, err?.message);
      return {
        userId: u.line_user_id,
        ok: false,
        reason: 'exception',
        error: err?.message,
      };
    }
  });

  const results = await runWithConcurrency(tasks, CONCURRENCY);
  const sent = results.filter((r) => r.ok).length;
  const skipped = results.filter((r) => !r.ok).length;

  return {
    candidates: candidates?.length || 0,
    eligible: eligible.length,
    sent,
    skipped,
  };
}

// ============================================================
// 段 3：Reset stage=6 > 48h 無反應（契約 Ch.5.5）
// ============================================================
async function runReset() {
  const hours = (await getSettingTyped('q5_timeout_reset_hours')) ?? 48;
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  const { data: candidates, error } = await supabase
    .from('official_line_users')
    .select('line_user_id, q5_sent_at')
    .eq('path_stage', 6)
    .lt('q5_sent_at', cutoff)
    .limit(500);
  if (error) throw error;

  console.log(`[q5-maintenance/reset] ${candidates?.length || 0} candidates`);

  if (!candidates || candidates.length === 0) {
    return { candidates: 0, reset: 0 };
  }

  const now = new Date().toISOString();
  const tasks = candidates.map((u) => async () => {
    try {
      // Atomic reset：stage 6 → 4，清 q5_sent_at + q5_followup_trigger_source
      // 不清 q5_intent（保留分類，主動軌 SQL 仍能正確排除 decline / ai_failed）
      // .eq('path_stage', 6) 確保只動仍在 stage=6 的（race：handoff 可能動到 stage=5）
      const { data: updated, error: upErr } = await supabase
        .from('official_line_users')
        .update({
          path_stage: 4,
          path_stage_updated_at: now,
          q5_sent_at: null,
          q5_followup_trigger_source: null,
        })
        .eq('line_user_id', u.line_user_id)
        .eq('path_stage', 6)
        .select('line_user_id');
      if (upErr) {
        console.error('[q5-maintenance/reset] update failed:', u.line_user_id, upErr);
        return { userId: u.line_user_id, ok: false, reason: 'db_error' };
      }
      if (!updated || updated.length === 0) {
        return { userId: u.line_user_id, ok: false, reason: 'race_lost' };
      }
      return { userId: u.line_user_id, ok: true };
    } catch (err) {
      console.error('[q5-maintenance/reset] user failed:', u.line_user_id, err?.message);
      return {
        userId: u.line_user_id,
        ok: false,
        reason: 'exception',
        error: err?.message,
      };
    }
  });

  const results = await runWithConcurrency(tasks, CONCURRENCY);
  const resetCount = results.filter((r) => r.ok).length;
  const skipped = results.filter((r) => !r.ok).length;

  return { candidates: candidates.length, reset: resetCount, skipped };
}

// ============================================================
// 段 4：Notify retry — applications 通知（契約 Ch.5.6）
// ============================================================
async function runNotifyRetry() {
  // applications notify_status in (pending, failed) → push 通知一休 + 婉馨
  const { data: pending, error } = await supabase
    .from('official_program_applications')
    .select(
      'id, line_user_id, real_name, phone, email, program_choice, submitted_at, notify_status, display_name'
    )
    .in('notify_status', ['pending', 'failed'])
    .order('submitted_at', { ascending: true })
    .limit(50);
  if (error) throw error;

  console.log(`[q5-maintenance/notify_retry] ${pending?.length || 0} pending notifications`);

  if (!pending || pending.length === 0) {
    return { candidates: 0, sent: 0 };
  }

  const notifyTo = (await getSettingTyped('handoff_notify_to')) || ['yixiu', 'wanxin'];
  const targets = notifyTo.map((n) => NOTIFY_USER_IDS[n]).filter(Boolean);

  const now = new Date().toISOString();
  const tasks = pending.map((app) => async () => {
    const planZh =
      app.program_choice === '12weeks' ? '12 週完整版' : '4 週體驗版';
    const msg = [
      '📝 新報名通知',
      `姓名：${app.real_name}`,
      `方案：${planZh}`,
      `電話：${app.phone}`,
      `Email：${app.email}`,
      app.display_name ? `LINE 名：${app.display_name}` : null,
      `submitted_at：${app.submitted_at}`,
      '',
      `→ 後台開對話：https://official-yihugh-line-bot.vercel.app/admin?user=${app.line_user_id || ''}`,
    ]
      .filter(Boolean)
      .join('\n');

    let allOk = true;
    for (const to of targets) {
      try {
        const ok = await pushMessage(to, [textMessage(msg)]);
        if (!ok) allOk = false;
      } catch (err) {
        console.error('[q5-maintenance/notify_retry] push failed:', to, err?.message);
        allOk = false;
      }
    }

    const newStatus = allOk ? 'sent' : 'failed';
    const { error: upErr } = await supabase
      .from('official_program_applications')
      .update({
        notify_status: newStatus,
        notify_sent_at: allOk ? now : null,
      })
      .eq('id', app.id);
    if (upErr) {
      console.error('[q5-maintenance/notify_retry] update failed:', app.id, upErr);
      return { id: app.id, ok: false, reason: 'db_error' };
    }

    return { id: app.id, ok: allOk };
  });

  const results = await runWithConcurrency(tasks, CONCURRENCY);
  const sent = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return { candidates: pending.length, sent, failed };
}
