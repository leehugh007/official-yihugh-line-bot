// 個人化排程推播 + 排程推播掃描 — 每 10 分鐘跑一次
// Vercel Cron: 每 10 分鐘（*/10 * * * *）
// 或手動觸發: GET /api/cron/drip?secret=xxx
//
// 邏輯：
// 1. 找出所有 drip_next_at <= 現在 且 未暫停 且 未封鎖 的用戶
// 2. 檢查該用戶的下一篇文章（drip_week + 1）
// 3. 檢查用戶是否有 exclude_tag（例如「已報名減重班」）
// 4. 有 → 跳過（不再推）；沒有 → 推送 + 更新 drip_week 和 drip_next_at
//
// 發送方式：逐筆 push（非 multicast），每人帶個人化追蹤 URL
// 並發控制：最多 20 筆同時發送，避免 timeout
// 訊息格式：全部用 Flex Message + 按鈕（連結不外露）

import { NextResponse } from 'next/server';
import supabase from '../../../../lib/supabase.js';
import { pushMessage, pushFlexMessage } from '../../../../lib/line.js';
import { wrapLink } from '../../../../lib/tracking.js';
import { sendScheduledPush } from '../../../../lib/push.js';

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

// 並發控制：最多 concurrency 個同時執行
async function runWithConcurrency(tasks, concurrency = 20) {
  const results = [];
  let i = 0;
  async function next() {
    const idx = i++;
    if (idx >= tasks.length) return;
    results[idx] = await tasks[idx]();
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => next()));
  return results;
}

async function processDrip() {
  const now = new Date().toISOString();

  // 1. 取得所有啟用中的排程文章
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
    return { processed: 0, skipped: 0, sent: 0, message: '沒有到期的用戶' };
  }

  // 3. 分配每個用戶該收的文章
  const sendTasks = []; // { userId, article, step }
  let skipped = 0;
  const pauseUserIds = [];

  for (const user of users) {
    const nextStep = user.drip_week + 1;
    const article = schedule.find((s) => s.step_number === nextStep);

    if (!article) {
      skipped++;
      continue;
    }

    // 防呆：跳過 placeholder 內容
    const isPlaceholder =
      !article.message ||
      article.message.includes('待填入') ||
      (article.link_url && article.link_url.includes('example.com'));
    if (isPlaceholder) {
      console.warn(`[Drip] Step ${nextStep} 內容是 placeholder，跳過`);
      skipped++;
      continue;
    }

    // 檢查排除標籤
    if (article.exclude_tag && user.tags?.includes(article.exclude_tag)) {
      pauseUserIds.push(user.line_user_id);
      skipped++;
      continue;
    }

    sendTasks.push({ userId: user.line_user_id, article, step: nextStep });
  }

  // 批量暫停被排除的用戶
  if (pauseUserIds.length > 0) {
    await supabase
      .from('official_line_users')
      .update({ drip_paused: true })
      .in('line_user_id', pauseUserIds);
  }

  if (sendTasks.length === 0) {
    return { processed: users.length, sent: 0, skipped };
  }

  // 4. 逐筆並發發送（每人個人化追蹤 URL + Flex Message）
  let sent = 0;
  let failed = 0;

  const pushTasks = sendTasks.map(({ userId, article, step }) => async () => {
    const linkId = `drip_${step}`;

    // 全部用 Flex Message + 按鈕（連結藏在按鈕裡，不外露）
    const lines = article.message.split('\n').filter((l) => l.trim());
    const title = lines[0] || article.message;
    const body = lines.slice(1).join('\n').trim();
    const buttons = article.link_url
      ? [{ label: article.link_text || '閱讀文章', url: wrapLink(article.link_url, linkId, userId) }]
      : [];
    const lineMsg = pushFlexMessage({
      title,
      body,
      buttons,
      imageUrl: article.image_url || undefined,
    });

    const ok = await pushMessage(userId, lineMsg);
    return { userId, step, linkId, ok };
  });

  const results = await runWithConcurrency(pushTasks, 20);

  // 5. 批量寫入 drip_logs + 更新用戶狀態
  const successResults = results.filter((r) => r?.ok);
  const failResults = results.filter((r) => r && !r.ok);
  sent = successResults.length;
  failed = failResults.length;

  if (failResults.length > 0) {
    console.warn(`[Drip] ${failResults.length} 筆發送失敗:`, failResults.map((r) => r.userId));
  }

  // 批量 insert drip_logs
  if (successResults.length > 0) {
    const logRows = successResults.map((r) => ({
      line_user_id: r.userId,
      step_number: r.step,
      link_id: r.linkId,
    }));
    await supabase.from('official_drip_logs').insert(logRows);
  }

  // 批量 update 用戶 drip_week 和 drip_next_at（按 step 分組）
  const stepUserMap = {}; // step -> [userId]
  for (const r of successResults) {
    if (!stepUserMap[r.step]) stepUserMap[r.step] = [];
    stepUserMap[r.step].push(r.userId);
  }

  for (const [stepStr, uids] of Object.entries(stepUserMap)) {
    const step = parseInt(stepStr, 10);
    const nextArticle = schedule.find((s) => s.step_number === step + 1);
    const nextDelay = nextArticle ? nextArticle.delay_days : 7;
    const nextAt = new Date();
    nextAt.setDate(nextAt.getDate() + nextDelay);
    nextAt.setUTCHours(0, 0, 0, 0);

    await supabase
      .from('official_line_users')
      .update({
        drip_week: step,
        drip_next_at: step >= totalSteps ? null : nextAt.toISOString(),
      })
      .in('line_user_id', uids);
  }

  return { processed: users.length, sent, failed, skipped };
}

// ============================================================
// 排程推播：掃描到期的 scheduled push 並執行
// 直接呼叫 sendScheduledPush（不繞 HTTP，避免 VERCEL_URL 問題）
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
      const result = await sendScheduledPush(log.id);
      if (result) sent++;
      else failed++;
    } catch {
      failed++;
    }
  }

  return { processed: scheduled.length, sent, failed };
}
