// POST /api/apply/submit
// 契約 v2.4 Ch.5.3
//
// /apply 頁五章表單提交 → INSERT applications + UPDATE users stage=8
// 動作：
//   1. HMAC verify 6 欄（userid/source/trigger/kv/ts/sig）
//   2. 表單欄位 shape check（real_name/phone/email/address/gender/age/program_choice/agreed_refund_policy）
//   3. 呼叫 submit_application RPC（atomic INSERT + UPDATE）
//   4. 回 application_id + other_apps_count + other_phone_count（client 可 UI 警示重複）
//
// 不處理：
//   - notify 寄送（cron/q5-notify 另處理）
//   - 金流（Phase 5+）
//   - LINE-to-LINE 分享污染（Phase 4.5 觀察再評估）

import { NextResponse } from 'next/server';
import supabase from '../../../../lib/supabase.js';
import { verifyQ5ApplySig } from '../../../../lib/q5-apply-url.js';
import { pushMessage, textMessage } from '../../../../lib/line.js';
import { getSettingTyped } from '../../../../lib/official-settings.js';
import { NOTIFY_USER_IDS } from '../../../../lib/constants.js';
import { getPricingState, calcFinalPrice } from '../../../../lib/pricing.js';
import { appendApplicationRow, isSheetSyncEnabled } from '../../../../lib/google-sheets.js';

const HMAC_KEYS = ['userid', 'source', 'trigger', 'kv', 'ts', 'sig'];

// 表單白名單
const GENDER_ALLOWED = new Set(['male', 'female', 'other']);
const PROGRAM_ALLOWED = new Set(['12weeks', '4weeks_trial']);
const PHONE_RE = /^09\d{8}$/; // 台灣手機
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 廣播模式（契約_apply廣播入口.md）
const USERID_RE = /^U[0-9a-f]{32}$/;
const SOURCE_ALLOWED_PUBLIC = new Set(['bot_q5', 'broadcast']);

export async function POST(request) {
  // 1. Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // 2. 認證分流（雙模式 — 契約_apply廣播入口.md）
  //    - body 含 sig → 漏斗模式（HMAC verify）
  //    - body.mode === 'public' → 廣播模式（純信任 client userid + source allowlist）
  //    - 都不符 → 400 invalid_mode
  let resolvedUserid;
  let resolvedSource;
  let resolvedMode;

  if (body.sig !== undefined && body.sig !== null) {
    // 漏斗模式：HMAC 6 欄完整 shape check + verify（既有邏輯不動）
    const hmacPayload = {};
    for (const k of HMAC_KEYS) {
      const v = body[k];
      if (v === undefined || v === null) {
        console.warn('[apply/submit] private mode: missing HMAC key:', k);
        return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
      }
      if (typeof v !== 'string' && typeof v !== 'number') {
        console.warn('[apply/submit] private mode: bad HMAC key type:', k);
        return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
      }
      hmacPayload[k] = v;
    }
    const verifyResult = verifyQ5ApplySig(hmacPayload);
    if (!verifyResult.ok) {
      console.warn('[apply/submit] private mode: verify failed:', verifyResult.reason, {
        userid: body.userid,
      });
      return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
    }
    resolvedUserid = body.userid;
    resolvedSource = 'bot_q5';
    resolvedMode = 'private';
  } else if (body.mode === 'public') {
    // 廣播模式：純信任 client query userid（一休 5/6 拍板取捨：摩擦 > 安全潔癖）
    // 攻擊面保護：partial unique index 鎖同人多筆 pending（migration_022）
    if (typeof body.userid !== 'string' || !USERID_RE.test(body.userid)) {
      console.warn('[apply/submit] public mode: invalid userid format:', body.userid);
      return NextResponse.json({ error: 'invalid_userid' }, { status: 400 });
    }
    // ?source server-side allowlist（決策 5）— 不在 allowlist 的 fallback 'broadcast'
    resolvedSource = SOURCE_ALLOWED_PUBLIC.has(body.source) ? body.source : 'broadcast';
    resolvedUserid = body.userid;
    resolvedMode = 'public';
  } else {
    console.warn('[apply/submit] invalid_mode: missing both sig and mode=public');
    return NextResponse.json({ error: 'invalid_mode' }, { status: 400 });
  }

  // 3. 表單 shape check
  const {
    real_name,
    phone,
    email,
    address,
    gender,
    age,
    line_id, // 必填（沒設定請填「無」）
    display_name, // 選填
    program_choice,
    agreed_refund_policy,
  } = body;

  const errors = [];
  if (typeof real_name !== 'string' || real_name.trim().length < 1 || real_name.length > 50) {
    errors.push('real_name');
  }
  if (typeof phone !== 'string' || !PHONE_RE.test(phone)) {
    errors.push('phone');
  }
  if (typeof email !== 'string' || !EMAIL_RE.test(email) || email.length > 200) {
    errors.push('email');
  }
  if (typeof address !== 'string' || address.trim().length < 5 || address.length > 200) {
    errors.push('address');
  }
  if (typeof gender !== 'string' || !GENDER_ALLOWED.has(gender)) {
    errors.push('gender');
  }
  const ageInt = parseInt(age, 10);
  if (!Number.isInteger(ageInt) || ageInt < 18 || ageInt > 99) {
    errors.push('age');
  }
  if (typeof program_choice !== 'string' || !PROGRAM_ALLOWED.has(program_choice)) {
    errors.push('program_choice');
  }
  if (agreed_refund_policy !== true) {
    errors.push('agreed_refund_policy');
  }
  if (typeof line_id !== 'string' || line_id.trim().length < 1 || line_id.length > 50) {
    errors.push('line_id');
  }
  if (display_name !== undefined && display_name !== null) {
    if (typeof display_name !== 'string' || display_name.length > 100) errors.push('display_name');
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: 'invalid_form', fields: errors },
      { status: 400 }
    );
  }

  // V3.2 Phase 5+7：server-side 算 tier + final_price（client 不可信，防假造）
  // 三段邏輯：super_cutoff 之前 = super / 之後到 regular_cutoff = regular / 之後 = anchor
  // RPC 寫入 super_early_bird_applied + final_price snapshot
  const pricingState = await getPricingState();
  const { final_price, tier, super_early_bird_applied } = calcFinalPrice(program_choice, pricingState);

  // 4. 呼叫 submit_application RPC（雙模式：private 沿用 / public 進 upsert 分支）
  try {
    const { data, error } = await supabase.rpc('submit_application', {
      p_line_user_id: resolvedUserid,
      p_real_name: real_name.trim(),
      p_phone: phone,
      p_email: email.trim(),
      p_address: address.trim(),
      p_gender: gender,
      p_age: ageInt,
      p_line_id: line_id ? String(line_id).trim() : null,
      p_display_name: display_name ? String(display_name).trim() : null,
      p_program_choice: program_choice,
      p_agreed_refund_policy: true,
      p_source: resolvedSource,
      p_super_early_bird_applied: super_early_bird_applied,
      p_final_price: final_price,
      p_mode: resolvedMode,
    });

    if (error) {
      if (error.code === 'P0002') {
        // user_not_found（只會在 private mode raise — public mode 自動 upsert）
        console.warn('[apply/submit] user_not_found:', resolvedUserid);
        return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
      }
      if (error.code === '23505') {
        // partial unique index 擋同人重複 pending（雙擊 / 廣播模式 curl 攻擊）
        console.warn('[apply/submit] race_lost (already_pending):', resolvedUserid);
        return NextResponse.json({ error: 'race_lost' }, { status: 409 });
      }
      console.error('[apply/submit] RPC failed:', error);
      return NextResponse.json({ error: 'system_busy' }, { status: 503 });
    }

    // RPC 回傳是 submit_application_result composite type
    // Supabase client 解成 object：{ application_id, enrolled_at, other_apps_count, other_phone_count }

    // 5. 同步 append 到 GoogleSheet（環境變數沒設時自動跳過）
    //    失敗不擋主流程，cron sheet-sync 每 10 分鐘也會 fallback append
    if (isSheetSyncEnabled()) {
      try {
        await appendApplicationRow({
          id: data.application_id,
          submitted_at: new Date().toISOString(),
          real_name: real_name.trim(),
          phone,
          email: email.trim(),
          address: address.trim(),
          gender,
          age: ageInt,
          line_id: line_id ? String(line_id).trim() : null,
          display_name: display_name ? String(display_name).trim() : null,
          program_choice,
          status: 'pending',
          notes: null,
          payment_last5: null,
          payment_amount: null,
          payment_date: null,
        });
      } catch (err) {
        console.error('[apply/submit] sheet append silent fail:', err?.message);
      }
    }

    // 6. 即時通知一休 + 婉馨（Phase 4.5 Phase 5）
    //    必須 await（fire-and-forget 在 Vercel serverless 會被 kill — Phase 3.2a 已驗證雷）
    //    成功 → UPDATE notify_status='sent' 防 cron 雙推
    //    失敗 → 留 'pending'，cron q5-maintenance 每小時 0 分接住 retry
    await notifyApplicationSubmit(data.application_id, {
      real_name: real_name.trim(),
      phone,
      email: email.trim(),
      program_choice,
      display_name: display_name ? String(display_name).trim() : null,
      line_user_id: resolvedUserid,
      tier,
      final_price,
    });

    return NextResponse.json({
      ok: true,
      application_id: data.application_id,
      enrolled_at: data.enrolled_at,
      other_apps_count: data.other_apps_count,
      other_phone_count: data.other_phone_count,
    });
  } catch (err) {
    console.error('[apply/submit] exception:', err);
    return NextResponse.json({ error: 'system_busy' }, { status: 503 });
  }
}

/**
 * 即時通知 application 已提交（Phase 5）
 * - 訊息格式跟 cron q5-maintenance/runNotifyRetry 一致（同一份模板）
 * - 必須 await：Vercel serverless return 後可能 kill runtime
 * - 成功 → UPDATE notify_status='sent' + notify_sent_at
 * - 失敗 → 不丟錯（保證表單成功 response），status 留 'pending' 給 cron retry
 *
 * 訊息 push 失敗（LINE API 掛 / token 過期）所有 catch 都吞掉，因為：
 *   - 表單已成功（DB 寫了，用戶已跳轉到 success 頁）
 *   - cron 還會再試（status='pending' 是 default）
 */
async function notifyApplicationSubmit(applicationId, app) {
  try {
    const notifyTo = (await getSettingTyped('handoff_notify_to')) || ['yixiu', 'wanxin'];
    const targets = notifyTo.map((n) => NOTIFY_USER_IDS[n]).filter(Boolean);
    if (targets.length === 0) return;

    const planZh = app.program_choice === '12weeks' ? '12 週完整版' : '4 週體驗版';
    // V3.2 Phase 7：通知按三段 tier 顯示「超早鳥 / 一般早鳥 / 原價 / 體驗價」
    const priceDisplay = typeof app.final_price === 'number'
      ? `NT$ ${app.final_price.toLocaleString()}`
      : '?';
    const tierLabel = {
      super: '🔥 超早鳥',
      regular: '🌱 一般早鳥',
      anchor: '原價',
      trial: '體驗價',
    }[app.tier] || app.tier || '?';
    const submittedAt = new Date().toISOString();
    const msg = [
      '📝 新報名通知',
      `姓名：${app.real_name}`,
      `方案：${planZh}（${tierLabel}）`,
      `成交價：${priceDisplay}`,
      `電話：${app.phone}`,
      `Email：${app.email}`,
      app.display_name ? `LINE 名：${app.display_name}` : null,
      `submitted_at：${submittedAt}`,
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
        console.error('[apply/submit/notify] push failed:', to, err?.message);
        allOk = false;
      }
    }

    if (allOk) {
      const { error: upErr } = await supabase
        .from('official_program_applications')
        .update({
          notify_status: 'sent',
          notify_sent_at: submittedAt,
        })
        .eq('id', applicationId);
      if (upErr) {
        console.error('[apply/submit/notify] update notify_status failed:', applicationId, upErr);
      }
    } else {
      // 部分或全部失敗 → 留 status='pending'，cron 接住
      console.warn('[apply/submit/notify] partial fail, leaving pending for cron retry:', applicationId);
    }
  } catch (err) {
    // 防禦：notify 失敗絕不影響表單回應（status 留 pending，cron 會 retry）
    console.error('[apply/submit/notify] exception (silent):', err?.message);
  }
}
