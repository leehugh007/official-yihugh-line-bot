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

const HMAC_KEYS = ['userid', 'source', 'trigger', 'kv', 'ts', 'sig'];

// 表單白名單
const GENDER_ALLOWED = new Set(['male', 'female', 'other']);
const PROGRAM_ALLOWED = new Set(['12weeks', '4weeks_trial']);
const PHONE_RE = /^09\d{8}$/; // 台灣手機
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request) {
  // 1. Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // 2. HMAC shape check + verify
  const hmacPayload = {};
  for (const k of HMAC_KEYS) {
    const v = body[k];
    if (v === undefined || v === null) {
      console.warn('[apply/submit] missing HMAC key:', k);
      return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
    }
    if (typeof v !== 'string' && typeof v !== 'number') {
      console.warn('[apply/submit] bad HMAC key type:', k);
      return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
    }
    hmacPayload[k] = v;
  }

  const verifyResult = verifyQ5ApplySig(hmacPayload);
  if (!verifyResult.ok) {
    console.warn('[apply/submit] verify failed:', verifyResult.reason, {
      userid: body.userid,
    });
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  // 3. 表單 shape check
  const {
    real_name,
    phone,
    email,
    address,
    gender,
    age,
    line_id, // 選填
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
  if (line_id !== undefined && line_id !== null) {
    if (typeof line_id !== 'string' || line_id.length > 50) errors.push('line_id');
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

  // 4. 呼叫 submit_application RPC
  try {
    const { data, error } = await supabase.rpc('submit_application', {
      p_line_user_id: body.userid,
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
      p_source: 'bot_q5',
    });

    if (error) {
      if (error.code === 'P0002') {
        // user_not_found
        console.warn('[apply/submit] user_not_found:', body.userid);
        return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
      }
      console.error('[apply/submit] RPC failed:', error);
      return NextResponse.json({ error: 'system_busy' }, { status: 503 });
    }

    // RPC 回傳是 submit_application_result composite type
    // Supabase client 解成 object：{ application_id, enrolled_at, other_apps_count, other_phone_count }

    // 5. 即時通知一休 + 婉馨（Phase 4.5 Phase 5）
    //    必須 await（fire-and-forget 在 Vercel serverless 會被 kill — Phase 3.2a 已驗證雷）
    //    成功 → UPDATE notify_status='sent' 防 cron 雙推
    //    失敗 → 留 'pending'，cron q5-maintenance 每小時 0 分接住 retry
    await notifyApplicationSubmit(data.application_id, {
      real_name: real_name.trim(),
      phone,
      email: email.trim(),
      program_choice,
      display_name: display_name ? String(display_name).trim() : null,
      line_user_id: body.userid,
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
    const submittedAt = new Date().toISOString();
    const msg = [
      '📝 新報名通知',
      `姓名：${app.real_name}`,
      `方案：${planZh}`,
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
