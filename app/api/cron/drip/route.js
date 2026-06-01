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
    const retargetingResult = await processAdminRetargeting();
    return NextResponse.json({ drip: dripResult, scheduledPush: pushResult, retargeting: retargetingResult });
  } catch (error) {
    console.error('[Drip] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function daysAgoIso(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function taipeiScheduledAt(delayDays, hhmm) {
  const [hourRaw, minuteRaw] = String(hhmm || '14:00').split(':');
  const hour = Number(hourRaw || 14);
  const minute = Number(minuteRaw || 0);
  const taipeiNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const y = taipeiNow.getUTCFullYear();
  const m = taipeiNow.getUTCMonth();
  const d = taipeiNow.getUTCDate() + Number(delayDays || 0);
  return new Date(Date.UTC(y, m, d, hour - 8, minute, 0, 0)).toISOString();
}

function buildFlexFromTemplate(template, linkId, userId) {
  const message = template.message || '';
  const lines = message.split('\n').filter((l) => l.trim());
  const title = lines[0] || template.title || '一休陪你健康瘦';
  const body = lines.slice(1).join('\n').trim();
  const buttons = (template.buttons || [])
    .filter((btn) => btn.label && btn.url)
    .map((btn, i) => ({
      ...btn,
      url: wrapLink(btn.url, `${linkId}_b${i}`, userId),
    }));
  return pushFlexMessage({
    title,
    body,
    buttons,
    imageUrl: template.imageUrl || undefined,
  });
}

async function sendRetargetingToAdmin(userId, config, stage, windowKey) {
  const template = config.stageTemplates?.[stage - 1] || config.stageTemplates?.[0];
  if (!template?.message) return false;

  const linkId = `retargeting_auto_${config.ruleId || 'rule'}_s${stage}_${Date.now()}`;
  const lineMsg = buildFlexFromTemplate(template, linkId, userId);
  const ok = await pushMessage(userId, lineMsg);
  if (!ok) return false;

  await supabase.from('official_push_logs').insert({
    template_id: `retargeting_auto_${config.ruleId || 'rule'}_s${stage}`,
    label: `自動再行銷測試：${template.title || config.ruleTitle || '管理者測試'}（${windowKey}）`,
    message: template.message,
    link_id: linkId,
    buttons: template.buttons || [],
    image_url: template.imageUrl || null,
    segments: ['admin', 'retargeting_auto'],
    mode: 'instant',
    target_count: 1,
    sent_count: 1,
    status: 'completed',
    completed_at: new Date().toISOString(),
    exclude_enrolled: false,
  });

  return true;
}

function hasReplyInteraction(user, sinceIso) {
  if (!user?.last_user_reply_at || !sinceIso) return false;
  return new Date(user.last_user_reply_at) >= new Date(sinceIso);
}

function getNextRetargetingStage(config, userState) {
  const sentCount = userState?.sentCount || 0;
  if (config.repeatStrategy === 'once' && sentCount >= 1) {
    return { action: 'skip', reason: 'already_sent_once' };
  }
  if (config.repeatStrategy === 'cooldown' && sentCount >= 1) {
    return { action: 'cooldown', reason: 'repeat_cooldown' };
  }
  if (config.repeatStrategy === 'staged') {
    if (sentCount === 0) return { action: 'send', stage: 1 };
    if (sentCount === 1) return { action: 'send', stage: 2 };
    return { action: config.thirdStageAction || 'cooldown', reason: 'third_stage' };
  }
  return sentCount === 0 ? { action: 'send', stage: 1 } : { action: 'skip', reason: 'already_sent' };
}

async function processAdminRetargeting() {
  const { data: testModeSetting } = await supabase
    .from('official_settings')
    .select('value')
    .eq('key', 'drip_test_mode')
    .single();
  const isTestMode = testModeSetting?.value === 'true';
  if (!isTestMode) {
    return { processed: 0, sent: 0, skipped: 0, message: 'drip 測試模式未開啟' };
  }

  const { data: configSetting } = await supabase
    .from('official_settings')
    .select('value')
    .eq('key', 'retargeting_admin_auto_config')
    .single();
  const config = safeJsonParse(configSetting?.value, null);
  if (!config?.enabled) {
    return { processed: 0, sent: 0, skipped: 0, message: '管理者自動再行銷未啟用' };
  }

  const { data: stateSetting } = await supabase
    .from('official_settings')
    .select('value')
    .eq('key', 'retargeting_admin_auto_state')
    .single();
  const state = safeJsonParse(stateSetting?.value, {});

  const { data: admins } = await supabase
    .from('official_line_users')
    .select('line_user_id, last_user_reply_at')
    .contains('tags', ['管理者'])
    .eq('is_blocked', false);
  const userIds = (admins || []).map((u) => u.line_user_id).filter(Boolean);
  if (userIds.length === 0) {
    return { processed: 0, sent: 0, skipped: 0, message: '沒有管理者測試帳號' };
  }

  const { data: logs } = await supabase
    .from('official_drip_logs')
    .select('line_user_id, step_number, sent_at')
    .in('line_user_id', userIds)
    .order('step_number', { ascending: true });

  const { data: clicks } = await supabase
    .from('official_line_clicks')
    .select('line_user_id, link_id, clicked_at')
    .in('line_user_id', userIds)
    .like('link_id', 'drip_%');

  const clickSet = new Set((clicks || []).map((click) => `${click.line_user_id}:${String(click.link_id).match(/^drip_(\d+)/)?.[1]}`));
  const logsByUser = {};
  for (const log of logs || []) {
    if (!logsByUser[log.line_user_id]) logsByUser[log.line_user_id] = [];
    logsByUser[log.line_user_id].push(log);
  }

  let processed = 0;
  let sent = 0;
  let skipped = 0;
  let pending = 0;
  const now = new Date();
  const adminsById = Object.fromEntries((admins || []).map((u) => [u.line_user_id, u]));

  for (const userId of userIds) {
    processed++;
    const userLogs = logsByUser[userId] || [];
    const uniqueLogs = [...new Map(userLogs.map((log) => [log.step_number, log])).values()]
      .sort((a, b) => a.step_number - b.step_number);

    if (uniqueLogs.length < Number(config.receivedMin || 1)) {
      skipped++;
      continue;
    }

    const missedSteps = Number(config.missedSteps || 1);
    const recentLogs = uniqueLogs.slice(-missedSteps);
    if (recentLogs.length < missedSteps) {
      skipped++;
      continue;
    }

    const latestSentAt = recentLogs[recentLogs.length - 1]?.sent_at;
    if (latestSentAt && new Date(latestSentAt) > new Date(daysAgoIso(config.checkDelayDays || 0))) {
      skipped++;
      continue;
    }

    const allMissed = recentLogs.every((log) => !clickSet.has(`${userId}:${log.step_number}`));
    if (!allMissed) {
      skipped++;
      continue;
    }

    const userState = state[userId] || {};
    const windowKey = recentLogs.map((log) => log.step_number).join('-');
    const pendingForWindow = userState.pending?.windowKey === windowKey ? userState.pending : null;

    if (userState.lastWindowKey === windowKey) {
      skipped++;
      continue;
    }

    if (pendingForWindow && new Date(pendingForWindow.scheduledAt) > now) {
      pending++;
      continue;
    }

    if (userState.lastSentAt && hasReplyInteraction(adminsById[userId], userState.lastSentAt)) {
      skipped++;
      continue;
    }

    const next = pendingForWindow
      ? { action: 'send', stage: pendingForWindow.stage }
      : getNextRetargetingStage(config, userState);
    if (next.action !== 'send') {
      state[userId] = { ...userState, lastWindowKey: windowKey, lastAction: next.action, updatedAt: new Date().toISOString() };
      skipped++;
      continue;
    }

    if (config.sendMode === 'scheduled') {
      const scheduledAt = userState.pending?.scheduledAt || taipeiScheduledAt(config.sendDelayDays || 0, config.sendAtTime || '14:00');
      if (new Date(scheduledAt) > now) {
        state[userId] = {
          ...userState,
          pending: { stage: next.stage, windowKey, scheduledAt },
          updatedAt: new Date().toISOString(),
        };
        pending++;
        continue;
      }
    }

    const ok = await sendRetargetingToAdmin(userId, config, next.stage, windowKey);
    if (ok) {
      state[userId] = {
        ...userState,
        sentCount: (userState.sentCount || 0) + 1,
        lastStage: next.stage,
        lastSentAt: new Date().toISOString(),
        lastWindowKey: windowKey,
        pending: null,
        updatedAt: new Date().toISOString(),
      };
      sent++;
    } else {
      skipped++;
    }
  }

  await supabase
    .from('official_settings')
    .upsert({
      key: 'retargeting_admin_auto_state',
      value: JSON.stringify(state),
      updated_at: new Date().toISOString(),
    });

  return { processed, sent, skipped, pending, testMode: true };
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

  // 0. 檢查測試模式
  const { data: testModeSetting } = await supabase
    .from('official_settings')
    .select('value')
    .eq('key', 'drip_test_mode')
    .single();
  const isTestMode = testModeSetting?.value === 'true';

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
  let usersQuery = supabase
    .from('official_line_users')
    .select('line_user_id, drip_week, tags')
    .lte('drip_next_at', now)
    .eq('drip_paused', false)
    .eq('is_blocked', false)
    .lt('drip_week', totalSteps);

  // 測試模式：只推給管理者
  if (isTestMode) {
    usersQuery = usersQuery.contains('tags', ['管理者']);
  }

  const { data: users } = await usersQuery;

  if (!users || users.length === 0) {
    return { processed: 0, skipped: 0, sent: 0, testMode: isTestMode, message: '沒有到期的用戶' };
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

  return { processed: users.length, sent, failed, skipped, testMode: isTestMode };
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
