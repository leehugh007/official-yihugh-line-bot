// 個人化排程推播 + 排程推播掃描 — 每 10 分鐘跑一次
// Vercel Cron: 每 10 分鐘（*/10 * * * *）
// 或手動觸發: GET /api/cron/drip?secret=xxx
//
// 邏輯：
// 1. 找出所有 drip_next_at <= 現在 且 未暫停 且 未封鎖 的用戶
// 2. 檢查該用戶的下一篇文章（drip_week + 1）
// 3. 檢查用戶是否有 exclude_tag（例如「已報名減重班」）
// 4. 有 → 跳過（不再推）；沒有 → 推送 + 更新 drip_week 和 drip_next_at

import { NextResponse } from 'next/server';
import supabase from '../../../../lib/supabase.js';
import { multicastMessage, textMessage, pushFlexMessage } from '../../../../lib/line.js';
import { wrapLink } from '../../../../lib/tracking.js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  // 驗證（Vercel Cron 帶 CRON_SECRET，手動觸發帶 admin secret）
  const isAuthorized =
    secret === process.env.ADMIN_SECRET ||
    request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const dripResult = await processDrip();
    const pushResult = await processScheduledPushes();
    return NextResponse.json({ drip: dripResult, scheduledPush: pushResult });
  } catch (error) {
    console.error('[Drip] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function processDrip() {
  const now = new Date().toISOString();

  // 1. 取得所有排程文章
  const { data: schedule } = await supabase
    .from('official_drip_schedule')
    .select('*')
    .eq('is_active', true)
    .order('step_number');

  if (!schedule || schedule.length === 0) {
    return { processed: 0, message: '沒有排程文章' };
  }

  const totalSteps = schedule.length;

  // 2. 找出到期的用戶
  const { data: users } = await supabase
    .from('official_line_users')
    .select('line_user_id, drip_week, tags')
    .lte('drip_next_at', now)
    .eq('drip_paused', false)
    .eq('is_blocked', false)
    .lt('drip_week', totalSteps);

  if (!users || users.length === 0) {
    return { processed: 0, skipped: 0, message: '沒有到期的用戶' };
  }

  // 3. 按 step 分群（同一篇文章的用戶一起 multicast）
  const stepGroups = {};
  let skipped = 0;

  for (const user of users) {
    const nextStep = user.drip_week + 1;
    const article = schedule.find((s) => s.step_number === nextStep);

    if (!article) {
      skipped++;
      continue;
    }

    // 檢查排除標籤
    if (article.exclude_tag && user.tags?.includes(article.exclude_tag)) {
      await supabase
        .from('official_line_users')
        .update({ drip_paused: true })
        .eq('line_user_id', user.line_user_id);
      skipped++;
      continue;
    }

    if (!stepGroups[nextStep]) {
      stepGroups[nextStep] = { article, userIds: [] };
    }
    stepGroups[nextStep].userIds.push(user.line_user_id);
  }

  // 4. 每組 multicast 發送
  let sent = 0;

  for (const [stepStr, group] of Object.entries(stepGroups)) {
    const step = parseInt(stepStr, 10);
    const { article, userIds } = group;
    const linkId = `drip_${step}`;

    // 組合訊息（支援圖片 → Flex，否則純文字）
    let lineMsg;
    if (article.image_url) {
      // 有圖片：用 Flex Message
      const lines = article.message.split('\n').filter((l) => l.trim());
      const title = lines[0] || article.message;
      const body = lines.slice(1).join('\n').trim();
      const buttons = article.link_url
        ? [{ label: article.link_text || '閱讀文章', url: wrapLink(article.link_url, linkId) }]
        : [];
      lineMsg = pushFlexMessage({ title, body, buttons, imageUrl: article.image_url });
    } else if (article.link_url) {
      // 無圖片但有連結：純文字 + 追蹤連結
      const trackedUrl = wrapLink(article.link_url, linkId);
      lineMsg = textMessage(`${article.message}\n\n👉 ${article.link_text || '閱讀文章'}\n${trackedUrl}`);
    } else {
      lineMsg = textMessage(article.message);
    }

    // multicast 批量發送（500 人一批）
    let stepSent = 0;
    for (let i = 0; i < userIds.length; i += 500) {
      const batch = userIds.slice(i, i + 500);
      const ok = await multicastMessage(batch, lineMsg);
      if (ok) stepSent += batch.length;
    }
    sent += stepSent;

    // 記錄推送 + 更新用戶狀態
    const nextArticle = schedule.find((s) => s.step_number === step + 1);
    const nextDelay = nextArticle ? nextArticle.delay_days : 7;
    const nextAt = new Date();
    nextAt.setDate(nextAt.getDate() + nextDelay);
    nextAt.setUTCHours(0, 0, 0, 0);

    for (const uid of userIds) {
      await supabase.from('official_drip_logs').insert({
        line_user_id: uid,
        step_number: step,
        link_id: linkId,
      });

      await supabase
        .from('official_line_users')
        .update({
          drip_week: step,
          drip_next_at: step >= totalSteps ? null : nextAt.toISOString(),
        })
        .eq('line_user_id', uid);
    }
  }

  return { processed: users.length, sent, skipped };
}

// ============================================================
// 排程推播：掃描到期的 scheduled push 並執行
// ============================================================
async function processScheduledPushes() {
  const now = new Date().toISOString();

  const { data: scheduled } = await supabase
    .from('official_push_logs')
    .select('id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now);

  if (!scheduled || scheduled.length === 0) {
    return { processed: 0, message: '沒有到期的排程推播' };
  }

  let sent = 0;
  let failed = 0;

  for (const log of scheduled) {
    try {
      // 呼叫 admin API 的 send_scheduled 邏輯
      const res = await fetch(
        `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000'}/api/admin`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret: process.env.ADMIN_SECRET,
            action: 'send_scheduled',
            logId: log.id,
          }),
        }
      );
      if (res.ok) sent++;
      else failed++;
    } catch {
      failed++;
    }
  }

  return { processed: scheduled.length, sent, failed };
}
