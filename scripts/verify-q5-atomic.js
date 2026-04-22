#!/usr/bin/env node
// scripts/verify-q5-atomic.js
// Q5 契約 v2.3 Ch.0.8 atomic 驗證 SOP — PR 0.8 merge 前必跑
//
// 目的：
//   實證 PostgREST `.update().is('q5_sent_at', null)` 真的有 atomic race guard，
//   而不是 HTTP keep-alive queue 成 sequential（造成假的「只有 1 個 ok」）。
//
// 設計（post-review 修正）：
//   用「passive + active 雙模擬」而不是 10 個相同 call。
//   fn1 模擬被動軌（from webhook），fn2 模擬主動軌（from cron）。
//   Promise.all([fn1(), fn2()]) 並發觸發，驗證：
//     1. 只有 1 個 {ok:true}，另 1 個 race_lost
//     2. start/end timestamp 真的並發（非 sequential）
//
// 失敗處理：
//   若兩個都 ok 或兩個都 race_lost → PostgREST atomic 假設不成立
//   → pivot 走 PL/pgSQL function（契約 Ch.5.3 模板）
//
// 前置：
//   1. 跑過 migration_012_q5_state_fields.sql（q5_* 欄位已建）
//   2. 把 TEST_USER_ID 設為白名單用戶（一休本人即可）
//   3. 若 TEST_USER_ID 已跑過 Q5 → 先 reset（見 --reset flag）
//
// 用法：
//   cd official-yihugh-line-bot
//   node scripts/verify-q5-atomic.js --reset   # 先 reset
//   node scripts/verify-q5-atomic.js            # 跑雙模擬

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// 載入 .env.local
const envPath = resolve(projectRoot, '.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf-8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const [k, ...rest] = l.split('=');
      return [k.trim(), rest.join('=').trim().replace(/^["']|["']$/g, '')];
    })
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ⚠️ 改成實際要測的白名單 userId（一休本人）
const TEST_USER_ID =
  process.env.TEST_USER_ID || 'U51808e2cc195967eba53701518e6f547';

const wantReset = process.argv.includes('--reset');

async function resetUser() {
  console.log(`[reset] ${TEST_USER_ID}`);
  const { error } = await supabase
    .from('official_line_users')
    .update({
      path_stage: 4,
      path_stage_updated_at: new Date().toISOString(),
      q5_sent_at: null,
      q5_followup_trigger_source: null,
      q5_active_invite_sent_at: null,
      q5_intent: null,
      q5_classified_at: null,
    })
    .eq('line_user_id', TEST_USER_ID);
  if (error) {
    console.error('[reset] failed:', error);
    process.exit(1);
  }
  console.log('[reset] done');
}

async function simulatePush(userId, label) {
  // 模擬 pushFn：sleep 10ms 模擬 LINE API latency
  await new Promise((r) => setTimeout(r, 10));
  return true;
}

async function simulateTransition(source) {
  const label = `[${source}]`;
  const start = Date.now();

  const now = new Date().toISOString();
  const isActive = source === 'active';
  const updates = {
    path_stage: 6,
    path_stage_updated_at: now,
    q5_sent_at: now,
    q5_followup_trigger_source: source,
  };
  if (isActive) updates.q5_active_invite_sent_at = now;

  const { data, error } = await supabase
    .from('official_line_users')
    .update(updates)
    .eq('line_user_id', TEST_USER_ID)
    .is('q5_sent_at', null)
    .select('line_user_id, path_stage');

  const end = Date.now();

  if (error) {
    return { source, ok: false, reason: 'db_error', error: error.message, start, end };
  }
  if (!data || data.length === 0) {
    return { source, ok: false, reason: 'race_lost', start, end };
  }

  await simulatePush(TEST_USER_ID, label);
  return { source, ok: true, start, end };
}

async function main() {
  if (wantReset) {
    await resetUser();
    return;
  }

  // 先檢查前置條件：欄位已建 + user 存在 + q5_sent_at IS NULL
  const { data: user, error: readErr } = await supabase
    .from('official_line_users')
    .select('line_user_id, path_stage, q5_sent_at, q5_followup_trigger_source')
    .eq('line_user_id', TEST_USER_ID)
    .maybeSingle();
  if (readErr) {
    console.error('[pre-check] read failed:', readErr);
    console.error('→ 可能是 q5_* 欄位未建。先跑 migration_012_q5_state_fields.sql');
    process.exit(1);
  }
  if (!user) {
    console.error('[pre-check] user not found:', TEST_USER_ID);
    process.exit(1);
  }
  if (user.q5_sent_at !== null) {
    console.error(
      `[pre-check] q5_sent_at 不為 NULL（現值 ${user.q5_sent_at}）— 先跑 --reset`
    );
    process.exit(1);
  }

  console.log('[verify] 開始雙模擬 race...');
  console.log(`[verify] TEST_USER_ID=${TEST_USER_ID}`);

  // 並發觸發 passive + active 雙軌
  const [passive, active] = await Promise.all([
    simulateTransition('passive'),
    simulateTransition('active'),
  ]);

  console.log('[result] passive:', passive);
  console.log('[result] active:', active);

  // 驗證並發（start diff < 50ms，非 sequential）
  const startDiff = Math.abs(passive.start - active.start);
  console.log(`[concurrency] start diff: ${startDiff}ms`);
  if (startDiff > 50) {
    console.warn('⚠️  start diff > 50ms — 可能 HTTP queue 串行化，不是真並發');
  }

  // 驗證 atomic：剛好 1 個 ok，1 個 race_lost
  const okCount = [passive, active].filter((r) => r.ok).length;
  const raceLostCount = [passive, active].filter((r) => r.reason === 'race_lost').length;

  console.log('');
  console.log('============ ATOMIC VERIFICATION ============');
  if (okCount === 1 && raceLostCount === 1) {
    console.log('✅ PASS — 1 個 ok + 1 個 race_lost，PostgREST atomic 假設成立');
    console.log('   → 可以按契約 Ch.0.8 走，不需 pivot 到 PL/pgSQL function');
    process.exit(0);
  } else if (okCount === 2) {
    console.log('❌ FAIL — 兩個都 ok，race guard 沒生效');
    console.log('   → pivot：寫 PL/pgSQL function 包 UPDATE（契約 Ch.5.3 模板）');
    process.exit(1);
  } else if (okCount === 0) {
    console.log('❌ FAIL — 兩個都 race_lost（可能前置條件沒對）');
    console.log('   → 先跑 --reset 確認 q5_sent_at=NULL，再跑一次');
    process.exit(1);
  } else {
    console.log('❓ UNKNOWN — 意料外的結果');
    console.log('   → 檢查 passive / active 的 reason 和 error');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
