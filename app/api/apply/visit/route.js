// POST /api/apply/visit
// 契約 v2.4 Ch.5.2 + V3.2 Phase 2B Session 3 Ch.5.6（?from= 配套）
//
// /apply 頁 LIFF init 成功後呼叫，記錄「點了沒報名」的中繼 metric。
// 動作：
//   1. HMAC verify（驗通過 = URL 是 Bot 生的，沒過期）
//   2. stage 6 → 7（若 stage=6；>=7 不動）
//   3. q5_clicked_at = COALESCE(q5_clicked_at, now()) — 首次點擊（unique 量測）
//   4. q5_click_count += 1 — 總計（含分享污染，契約 Ch.12.1a）
//   5. q5_apply_from_msg = COALESCE(existing, p_from) — 點擊歸因 metadata（msg3/msg4）
//
// 對外錯誤統一 { error: 'invalid_signature' } + 400，不洩漏具體 reason
// 內部 console.warn 記錄真實 reason 供 debug
//
// from 安全分析（契約 Ch.5.6）：
//   - from 是量測 metadata，不影響 auth / userid 鎖定
//   - 攻擊者篡改 from（msg3↔msg4）→ 只是污染歸因 metric，不獲取任何權限
//   - 故 from 不進 HMAC canonical，不簽名；optional，污染就忽略不 reject

import { NextResponse } from 'next/server';
import supabase from '../../../../lib/supabase.js';
import { verifyQ5ApplySig } from '../../../../lib/q5-apply-url.js';
import { getPricingState } from '../../../../lib/pricing.js';
import { getSettingTyped } from '../../../../lib/official-settings.js';

const BODY_KEYS = ['userid', 'source', 'trigger', 'kv', 'ts', 'sig'];
const FROM_ALLOWED = new Set(['msg3', 'msg4']);

export async function POST(request) {
  // 1. Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // 2. Shape check — 每欄 primitive，擋 array injection
  for (const k of BODY_KEYS) {
    const v = body[k];
    if (v === undefined || v === null) {
      console.warn('[apply/visit] missing body key:', k);
      return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
    }
    if (typeof v !== 'string' && typeof v !== 'number') {
      console.warn('[apply/visit] bad body key type:', k, typeof v);
      return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
    }
  }

  // 2a. from optional 解析（Ch.5.6 step 4）— 不進 HMAC verify，shape 不對就忽略
  let fromMsg = null;
  if (body.from !== undefined && body.from !== null) {
    if (typeof body.from === 'string' && FROM_ALLOWED.has(body.from)) {
      fromMsg = body.from;
    } else {
      console.warn('[apply/visit] bad from value, ignored:', body.from);
    }
  }

  // 3. HMAC verify
  const verifyResult = verifyQ5ApplySig(body);
  if (!verifyResult.ok) {
    console.warn('[apply/visit] verify failed:', verifyResult.reason, {
      userid: body.userid,
    });
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  const userId = body.userid;

  // 4. 業務邏輯：stage 6→7 + click_count + clicked_at COALESCE + apply_from_msg COALESCE
  try {
    const now = new Date().toISOString();

    // 先讀 stage + clicked_at + apply_from_msg 判斷要不要升 stage / 寫 from
    const { data: user, error: readErr } = await supabase
      .from('official_line_users')
      .select('path_stage, q5_clicked_at, q5_click_count, q5_apply_from_msg')
      .eq('line_user_id', userId)
      .single();

    if (readErr || !user) {
      console.warn('[apply/visit] user not found:', userId, readErr?.message);
      // 這邊也回 invalid_signature 避免洩露用戶存在性
      return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
    }

    // 組 UPDATE：click_count++、首次 clicked_at COALESCE、stage 6→7（其他 stage 不動）、apply_from_msg COALESCE
    const updates = {
      q5_click_count: (user.q5_click_count || 0) + 1,
    };
    if (!user.q5_clicked_at) updates.q5_clicked_at = now;
    if (user.path_stage === 6) {
      updates.path_stage = 7;
      updates.path_stage_updated_at = now;
    }
    if (fromMsg && !user.q5_apply_from_msg) {
      updates.q5_apply_from_msg = fromMsg;
    }

    const { error: updateErr } = await supabase
      .from('official_line_users')
      .update(updates)
      .eq('line_user_id', userId);

    if (updateErr) {
      console.error('[apply/visit] UPDATE failed:', updateErr);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }

    // V3.2 Phase 3：回傳 pricing state 給 landing UI 顯示三段價錨點 + 倒數計時
    const pricing = await getPricingState();

    // 2026-08-12 一休：方案說明後台可編輯（settings 驅動，defaults=原文案）
    const plan_texts = {
      p12_desc: await getSettingTyped('apply_plan12_desc'),
      p12_bullets: await getSettingTyped('apply_plan12_bullets'),
      p4_desc: await getSettingTyped('apply_plan4_desc'),
      duo_desc: await getSettingTyped('apply_plan_duo_desc'),
    };

    return NextResponse.json({
      ok: true,
      stage: updates.path_stage || user.path_stage,
      pricing,
      plan_texts,
    });
  } catch (err) {
    console.error('[apply/visit] exception:', err);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
}
