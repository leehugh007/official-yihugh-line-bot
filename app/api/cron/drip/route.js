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
import { pushMessage, pushMessageWithResult, pushFlexMessage } from '../../../../lib/line.js';
import { wrapLink } from '../../../../lib/tracking.js';
import { sendScheduledPush } from '../../../../lib/push.js';
import { normalizePublicUrl, isPublicHttpsUrl } from '../../../../lib/config.js';

const ADMIN_TAG = '\u7ba1\u7406\u8005';
const ENROLLED_TAG = '\u5df2\u5831\u540d\u6e1b\u91cd\u73ed';
const PENDING_PAYMENT_RULE = 'pending_payment';
const DRIP_ARTICLE_TYPES = new Set(['student_story', 'health_article', 'intro', 'method', 'apply', 'other']);
const SUPABASE_PAGE_SIZE = 1000;
const SUPABASE_IN_CHUNK_SIZE = 500;
const SUPABASE_MAX_ROWS = 100000;

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
    const retargetingResult = await processRetargeting();
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

function chunkArray(items, size = SUPABASE_IN_CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchAllRows(buildQuery, label, maxRows = SUPABASE_MAX_ROWS) {
  const rows = [];

  for (let offset = 0; ; offset += SUPABASE_PAGE_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      console.error(`[${label}] paged fetch failed:`, error);
      throw error;
    }
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < SUPABASE_PAGE_SIZE) break;
    if (rows.length >= maxRows) {
      console.warn(`[${label}] stopped at safety limit ${maxRows}`);
      break;
    }
  }

  return rows;
}

async function fetchRowsForUsers(userIds, buildQuery, label) {
  const rows = [];
  for (const chunk of chunkArray(userIds)) {
    const chunkRows = await fetchAllRows(() => buildQuery(chunk), label);
    rows.push(...chunkRows);
  }
  return rows;
}

function daysAgoIso(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function daysAfterIso(iso, days) {
  const date = new Date(iso);
  date.setDate(date.getDate() + Number(days || 0));
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

function isUsableRetargetingButton(button = {}) {
  if (!button.label) return false;
  if (button.actionType === 'message' || (!button.url && (button.replyText || button.messageText))) {
    return !!(button.replyText || button.messageText || button.label);
  }
  return !!button.url;
}

function prepareRetargetingButton(button, linkId, index, userId) {
  if (button.actionType === 'message' || (!button.url && (button.replyText || button.messageText))) {
    return {
      ...button,
      actionType: 'message',
      messageText: button.messageText || button.label,
    };
  }

  return {
    ...button,
    url: wrapLink(button.url, `${linkId}_b${index}`, userId),
  };
}

function buildFlexFromTemplate(template, linkId, userId) {
  const message = template.message || '';
  const lines = message.split('\n').filter((l) => l.trim());
  const title = lines[0] || template.title || '一休陪你健康瘦';
  const body = lines.slice(1).join('\n').trim();
  const buttons = (template.buttons || [])
    .filter(isUsableRetargetingButton)
    .map((btn, i) => prepareRetargetingButton(btn, linkId, i, userId));
  return pushFlexMessage({
    title,
    body,
    buttons,
    imageUrl: normalizePublicUrl(template.imageUrl) || undefined,
  });
}

function getRetargetingActivityKey(config = {}) {
  return config.activityId || config.ruleId || 'rule';
}

function textHasTestMarker(value) {
  return /測試|test/i.test(String(value || ''));
}

function getActiveRetargetingStageTemplates(config = {}) {
  const templates = Array.isArray(config.stageTemplates) ? config.stageTemplates : [];
  if (config.repeatStrategy !== 'staged') return templates.slice(0, 1);
  const active = templates.slice(0, 1);
  if (config.stage2Enabled !== false && templates[1]) active.push(templates[1]);
  if (config.stage2Enabled !== false && config.stage3Enabled && templates[2]) active.push(templates[2]);
  return active;
}

function validateRetargetingFormalConfig(config = {}) {
  if (!config?.enabled) return null;
  for (const template of getActiveRetargetingStageTemplates(config)) {
    if (!String(template?.message || '').trim()) {
      return `模板「${template?.title || '未命名'}」缺少訊息文字`;
    }
    const imageUrl = normalizePublicUrl(template.imageUrl);
    if (imageUrl && !isPublicHttpsUrl(imageUrl)) {
      return `模板「${template.title || '未命名'}」圖片不是公開 HTTPS 網址`;
    }
    const textFields = [
      template.title,
      template.category,
      template.message,
      ...(template.buttons || []).flatMap((button) => [
        button.label,
        button.messageText,
        button.replyText,
      ]),
    ];
    if (textFields.some(textHasTestMarker)) {
      return `模板「${template.title || '未命名'}」仍含測試字樣`;
    }
    for (const button of template.buttons || []) {
      if (button.actionType === 'message') {
        if (!String(button.replyText || '').trim()) {
          return `模板「${template.title || '未命名'}」文字回覆按鈕缺少 BOT 回覆文字`;
        }
        continue;
      }
      if (!button.url || button.url.includes('example.com') || !isPublicHttpsUrl(button.url)) {
        return `模板「${template.title || '未命名'}」有未完成的按鈕連結`;
      }
    }
  }
  return null;
}

async function recordRetargetingObservation(userId, config, stage, windowKey, context) {
  const template = config.stageTemplates?.[stage - 1] || config.stageTemplates?.[0];
  if (!template?.message) return false;

  const activityKey = getRetargetingActivityKey(config);
  const linkId = `retargeting_auto_${activityKey}_s${stage}_${Date.now()}`;
  const { error } = await supabase.from('official_push_logs').insert({
    template_id: `retargeting_auto_${activityKey}_s${stage}`,
    label: `自動再行銷觀察：${template.title || config.ruleTitle || '再行銷'}（${windowKey}）`,
    message: template.message,
    link_id: linkId,
    buttons: template.buttons || [],
    image_url: template.imageUrl || null,
    segments: [context, 'retargeting_auto', 'observe_only'],
    mode: 'observe_only',
    target_count: 1,
    sent_count: 0,
    status: 'observed',
    completed_at: new Date().toISOString(),
    exclude_enrolled: false,
  });
  if (error) {
    console.error('[Retargeting] observe log insert failed:', error);
    return false;
  }

  return true;
}

async function sendRetargetingMessage(userId, config, stage, windowKey, context) {
  const template = config.stageTemplates?.[stage - 1] || config.stageTemplates?.[0];
  if (!template?.message) return { ok: false, error: 'template message missing' };

  const activityKey = getRetargetingActivityKey(config);
  const linkId = `retargeting_auto_${activityKey}_s${stage}_${Date.now()}`;
  const lineMsg = buildFlexFromTemplate(template, linkId, userId);
  const pushResult = await pushMessageWithResult(userId, lineMsg);
  const normalizedImageUrl = normalizePublicUrl(template.imageUrl);
  if (!pushResult.ok) {
    const errorText = (pushResult.errorText || `LINE push failed (${pushResult.status})`).slice(0, 700);
    await supabase.from('official_push_logs').insert({
      template_id: `retargeting_auto_${activityKey}_s${stage}`,
      label: `自動再行銷發送失敗：${template.title || config.ruleTitle || '再行銷'}（${windowKey}）`,
      message: `${template.message}\n\n[系統錯誤] ${errorText}`,
      link_id: linkId,
      buttons: template.buttons || [],
      image_url: normalizedImageUrl || null,
      segments: [context, 'retargeting_auto'],
      mode: 'instant',
      target_count: 1,
      sent_count: 0,
      status: 'failed',
      completed_at: new Date().toISOString(),
      exclude_enrolled: false,
    });
    return { ok: false, error: errorText };
  }

  const { error } = await supabase.from('official_push_logs').insert({
    template_id: `retargeting_auto_${activityKey}_s${stage}`,
    label: `自動再行銷${context === 'admin' ? '測試' : '正式'}：${template.title || config.ruleTitle || '再行銷'}（${windowKey}）`,
    message: template.message,
    link_id: linkId,
    buttons: template.buttons || [],
    image_url: normalizedImageUrl || null,
    segments: [context, 'retargeting_auto'],
    mode: 'instant',
    target_count: 1,
    sent_count: 1,
    status: 'completed',
    completed_at: new Date().toISOString(),
    exclude_enrolled: false,
  });
  if (error) {
    console.error('[Retargeting] send log insert failed:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

function hasReplyInteraction(user, sinceIso) {
  if (!user?.last_user_reply_at || !sinceIso) return false;
  return new Date(user.last_user_reply_at) >= new Date(sinceIso);
}

function hasRetargetingEngagement(user, clicks, appRecord, sinceIso, criteria = 'any_click_or_reply') {
  if (!sinceIso) return false;
  const since = new Date(sinceIso);
  const replied = hasReplyInteraction(user, sinceIso);
  const clicked = (clicks || []).some((click) => click.clicked_at && new Date(click.clicked_at) >= since);
  const visitedApply = user?.q5_clicked_at && new Date(user.q5_clicked_at) >= since;
  const submitted = appRecord?.submitted_at && new Date(appRecord.submitted_at) >= since;
  const paid = appRecord?.paid_at && new Date(appRecord.paid_at) >= since;

  if (criteria === 'reply_only') return replied;
  if (criteria === 'conversion') return !!(visitedApply || submitted || paid);
  if (criteria === 'effective') return !!(replied || visitedApply || submitted || paid);
  return replied || clicked;
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
    if (sentCount === 1) {
      return config.stage2Enabled === false
        ? { action: config.thirdStageAction || 'cooldown', reason: 'stage2_disabled' }
        : { action: 'send', stage: 2 };
    }
    if (sentCount === 2) {
      return config.stage3Enabled
        ? { action: 'send', stage: 3 }
        : { action: config.thirdStageAction || 'cooldown', reason: 'stage3_disabled' };
    }
    return { action: config.thirdStageAction || 'cooldown', reason: 'third_stage' };
  }
  return sentCount === 0 ? { action: 'send', stage: 1 } : { action: 'skip', reason: 'already_sent' };
}

function isCompletedRetargetingWindow(userState = {}, windowKey) {
  if (!windowKey) return false;
  if (userState.completedWindowKey === windowKey) return true;
  if (userState.lastAction && ['engaged', 'cooldown', 'manual', 'stop', 'skip'].includes(userState.lastAction)) {
    return userState.lastWindowKey === windowKey;
  }
  return false;
}

function configNumber(value, fallback, min = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(number, min);
}

function defaultRetargetingEnabledConditions(ruleId = 'dropoff') {
  const base = {
    receivedMin: false,
    clickedMin: false,
    inactiveSteps: false,
    recentDays: false,
    joinedDays: false,
    applyDelayDays: false,
    applyClicks: false,
    paymentDelayDays: false,
    customArticleType: false,
    excludeApplyClickers: false,
    customExcludeSubmitted: false,
    customExcludePaid: false,
  };
  if (ruleId === 'dropoff') return { ...base, receivedMin: true, clickedMin: true, inactiveSteps: true };
  if (ruleId === 'warm') return { ...base, clickedMin: true, recentDays: true, excludeApplyClickers: true, customArticleType: true };
  if (ruleId === 'apply_no_submit') return { ...base, applyClicks: true, applyDelayDays: true, customExcludeSubmitted: true, customExcludePaid: true };
  if (ruleId === 'pending_payment') return { ...base, paymentDelayDays: true };
  if (ruleId === 'cold') return { ...base, receivedMin: true, joinedDays: true, clickedMin: true };
  return { ...base, clickedMin: true, customExcludeSubmitted: true, customExcludePaid: true, customArticleType: true };
}

function getRetargetingAudienceConditions(config = {}) {
  const raw = config.audienceConditions && typeof config.audienceConditions === 'object'
    ? config.audienceConditions
    : {};
  const presetId = raw.presetId || config.ruleId || 'dropoff';
  const defaults = defaultRetargetingEnabledConditions(presetId);
  const incomingEnabled = raw.enabledConditions && typeof raw.enabledConditions === 'object'
    ? raw.enabledConditions
    : {};
  return {
    presetId,
    enabledConditions: Object.fromEntries(
      Object.keys(defaults).map((key) => [key, incomingEnabled[key] ?? defaults[key]])
    ),
    clickedMin: configNumber(raw.clickedMin, 2, 0),
    inactiveSteps: configNumber(raw.inactiveSteps || config.missedSteps, 2, 1),
    recentDays: configNumber(raw.recentDays, 14, 1),
    applyDelayDays: configNumber(raw.applyDelayDays, 3, 0),
    applyClicks: configNumber(raw.applyClicks, 1, 1),
    paymentDelayDays: configNumber(raw.paymentDelayDays, 2, 0),
    receivedMin: configNumber(raw.receivedMin || config.receivedMin, 3, 1),
    joinedDays: configNumber(raw.joinedDays, 30, 1),
    storyOnly: !!raw.storyOnly,
    excludeApplyClickers: raw.excludeApplyClickers !== false,
    customArticleType: raw.customArticleType === 'any' || DRIP_ARTICLE_TYPES.has(raw.customArticleType)
      ? raw.customArticleType
      : 'any',
    customMinimumClicks: configNumber(raw.customMinimumClicks ?? raw.clickedMin, 1, 1),
    customExcludeSubmitted: raw.customExcludeSubmitted !== false,
    customExcludePaid: raw.customExcludePaid !== false,
  };
}

function getDripStepFromLinkId(linkId) {
  const match = String(linkId || '').match(/^drip_(\d+)/);
  return match ? Number(match[1]) : null;
}

function clickMatchesArticleType(click, stepTypeMap, articleType = 'any') {
  if (!articleType || articleType === 'any') return true;
  const step = getDripStepFromLinkId(click.link_id);
  if (step === null) return false;
  return (stepTypeMap.get(step) || 'other') === articleType;
}

function getUniqueDripClickSteps(clicks = [], stepTypeMap = new Map(), articleType = 'any') {
  const steps = new Set();
  for (const click of clicks) {
    if (!clickMatchesArticleType(click, stepTypeMap, articleType)) continue;
    const step = getDripStepFromLinkId(click.link_id);
    if (step !== null) steps.add(step);
  }
  return steps;
}

function hasClickSince(clicks = [], days, stepTypeMap = new Map(), articleType = 'any') {
  const cutoff = new Date(daysAgoIso(days));
  return clicks.some((click) => (
    click.clicked_at &&
    new Date(click.clicked_at) >= cutoff &&
    clickMatchesArticleType(click, stepTypeMap, articleType)
  ));
}

function isOlderThanDays(iso, days) {
  if (!iso) return false;
  return new Date(iso) <= new Date(daysAgoIso(days));
}

function latestLogWindow(uniqueLogs, size = 1) {
  if (!uniqueLogs.length) return { recentLogs: [], windowKey: 'no-drip-log' };
  const recentLogs = uniqueLogs.slice(-Math.max(1, size));
  return {
    recentLogs,
    windowKey: recentLogs.map((log) => log.step_number).join('-'),
  };
}

function evaluateRetargetingAudience(config, user, uniqueLogs, userClicks, appRecord, stepTypeMap) {
  const ruleId = config.ruleId || 'dropoff';
  const conditions = getRetargetingAudienceConditions(config);
  const enabled = conditions.enabledConditions || {};
  const userClickSteps = getUniqueDripClickSteps(userClicks, stepTypeMap);
  const dripClickCount = userClickSteps.size;
  const applyClickCount = Number(user?.q5_click_count || 0);
  const applyClickedAt = user?.q5_clicked_at;

  if (ruleId === 'dropoff') {
    if (enabled.receivedMin && uniqueLogs.length < conditions.receivedMin) return { matched: false };
    if (enabled.clickedMin && dripClickCount < conditions.clickedMin) return { matched: false };
    const inactiveSize = enabled.inactiveSteps ? conditions.inactiveSteps : 1;
    const { recentLogs, windowKey } = latestLogWindow(uniqueLogs, inactiveSize);
    if (enabled.inactiveSteps && recentLogs.length < conditions.inactiveSteps) return { matched: false };
    const allMissed = enabled.inactiveSteps
      ? recentLogs.every((log) => !userClickSteps.has(Number(log.step_number)))
      : true;
    return { matched: allMissed, recentLogs, windowKey };
  }

  if (ruleId === 'warm') {
    const warmArticleType = enabled.customArticleType && conditions.customArticleType !== 'any'
      ? conditions.customArticleType
      : conditions.storyOnly ? 'student_story' : 'any';
    const warmClickCount = getUniqueDripClickSteps(userClicks, stepTypeMap, warmArticleType).size;
    if (enabled.clickedMin && warmClickCount < conditions.clickedMin) return { matched: false };
    if (enabled.recentDays && !hasClickSince(userClicks, conditions.recentDays, stepTypeMap, warmArticleType)) return { matched: false };
    if (enabled.excludeApplyClickers && conditions.excludeApplyClickers && applyClickCount > 0) return { matched: false };
    return { matched: true, ...latestLogWindow(uniqueLogs) };
  }

  if (ruleId === 'apply_no_submit') {
    if (enabled.applyClicks && applyClickCount < conditions.applyClicks) return { matched: false };
    if (enabled.applyDelayDays && !isOlderThanDays(applyClickedAt, conditions.applyDelayDays)) return { matched: false };
    if (enabled.customExcludeSubmitted && appRecord?.status) return { matched: false };
    if (enabled.customExcludePaid && appRecord?.status === 'paid') return { matched: false };
    return {
      matched: true,
      ...latestLogWindow(uniqueLogs),
      windowKey: `apply-${String(applyClickedAt || '').slice(0, 10) || 'clicked'}`,
    };
  }

  if (ruleId === PENDING_PAYMENT_RULE) {
    if (appRecord?.status !== 'pending') return { matched: false };
    if (enabled.paymentDelayDays && !isOlderThanDays(appRecord.submitted_at, conditions.paymentDelayDays)) return { matched: false };
    return {
      matched: true,
      ...latestLogWindow(uniqueLogs),
      windowKey: `pending-${String(appRecord.submitted_at || '').slice(0, 10) || 'submitted'}`,
    };
  }

  if (ruleId === 'cold') {
    if (enabled.receivedMin && uniqueLogs.length < conditions.receivedMin) return { matched: false };
    if (enabled.clickedMin && dripClickCount > 0) return { matched: false };
    if (enabled.joinedDays && !isOlderThanDays(user?.joined_at, conditions.joinedDays)) return { matched: false };
    return { matched: true, ...latestLogWindow(uniqueLogs) };
  }

  if (ruleId === 'custom') {
    const customArticleType = enabled.customArticleType ? conditions.customArticleType : 'any';
    const customClickCount = getUniqueDripClickSteps(userClicks, stepTypeMap, customArticleType).size;
    if (enabled.clickedMin && customClickCount < conditions.customMinimumClicks) return { matched: false };
    if (enabled.customExcludePaid && conditions.customExcludePaid && appRecord?.status === 'paid') return { matched: false };
    if (enabled.customExcludeSubmitted && conditions.customExcludeSubmitted && appRecord?.status) return { matched: false };
    return { matched: true, ...latestLogWindow(uniqueLogs) };
  }

  return { matched: false };
}

async function fetchRetargetingUsers(isTestMode) {
  return fetchAllRows(() => {
    let usersQuery = supabase
      .from('official_line_users')
      .select('line_user_id, last_user_reply_at, tags, joined_at, q5_clicked_at, q5_click_count')
      .eq('is_blocked', false)
      .order('joined_at', { ascending: true })
      .order('line_user_id', { ascending: true });

    if (isTestMode) {
      usersQuery = usersQuery.contains('tags', [ADMIN_TAG]);
    } else {
      usersQuery = usersQuery
        .not('tags', 'cs', JSON.stringify([ADMIN_TAG]))
        .not('tags', 'cs', JSON.stringify([ENROLLED_TAG]));
    }

    return usersQuery;
  }, 'Retargeting users');
}

async function fetchRetargetingStepTypeMap() {
  let articleTypeFallback = false;
  let dripSchedule = [];

  try {
    dripSchedule = await fetchAllRows(
      () => supabase
        .from('official_drip_schedule')
        .select('step_number, article_type')
        .order('step_number', { ascending: true }),
      'Retargeting drip schedule article types',
      1000
    );
  } catch (error) {
    const message = String(error?.message || '');
    if (error?.code !== '42703' && !message.includes('article_type')) throw error;

    articleTypeFallback = true;
    console.warn('[Retargeting] article_type missing; fallback all drip steps to article_type=other');
    dripSchedule = await fetchAllRows(
      () => supabase
        .from('official_drip_schedule')
        .select('step_number')
        .order('step_number', { ascending: true }),
      'Retargeting drip schedule fallback',
      1000
    );
  }

  return {
    articleTypeFallback,
    stepTypeMap: new Map((dripSchedule || []).map((step) => [
      Number(step.step_number),
      step.article_type || 'other',
    ])),
  };
}

async function processRetargeting() {
  const { data: testModeSetting } = await supabase
    .from('official_settings')
    .select('value')
    .eq('key', 'drip_test_mode')
    .single();
  const isTestMode = testModeSetting?.value === 'true';
  const { data: configSetting } = await supabase
    .from('official_settings')
    .select('value')
    .eq('key', 'retargeting_admin_auto_config')
    .single();
  const config = safeJsonParse(configSetting?.value, null);
  if (!config?.enabled) {
    return { processed: 0, sent: 0, skipped: 0, observed: 0, message: 'retargeting disabled' };
  }
  if (!isTestMode) {
    const formalError = validateRetargetingFormalConfig(config);
    if (formalError) {
      return {
        processed: 0,
        sent: 0,
        skipped: 0,
        observed: 0,
        blocked: true,
        message: formalError,
      };
    }
  }

  const stateKey = isTestMode ? 'retargeting_admin_auto_state' : 'retargeting_auto_state';
  const context = isTestMode ? 'admin' : 'member';

  const { data: stateSetting } = await supabase
    .from('official_settings')
    .select('value')
    .eq('key', stateKey)
    .single();
  const state = safeJsonParse(stateSetting?.value, {});

  const users = await fetchRetargetingUsers(isTestMode);
  let candidates = users || [];
  let userIds = candidates.map((u) => u.line_user_id).filter(Boolean);
  const audienceConditions = getRetargetingAudienceConditions(config);
  const appStatusByUser = new Map();
  if (userIds.length > 0) {
    const applications = await fetchRowsForUsers(
      userIds,
      (ids) => supabase
        .from('official_program_applications')
        .select('line_user_id, status, submitted_at, paid_at')
        .in('line_user_id', ids)
        .in('status', ['pending', 'paid'])
        .order('submitted_at', { ascending: false }),
      'Retargeting applications'
    );

    for (const app of applications || []) {
      if (!app.line_user_id) continue;
      const current = appStatusByUser.get(app.line_user_id);
      if (current?.status === 'paid') continue;
      appStatusByUser.set(app.line_user_id, {
        status: app.status,
        submitted_at: app.submitted_at,
        paid_at: app.paid_at,
      });
    }
  }

  if (!isTestMode && userIds.length > 0) {
    candidates = candidates.filter((user) => {
      const appRecord = appStatusByUser.get(user.line_user_id);
      if (config.ruleId === PENDING_PAYMENT_RULE) return appRecord?.status === 'pending';
      if (config.ruleId === 'custom') {
        if (audienceConditions.customExcludePaid && appRecord?.status === 'paid') return false;
        if (audienceConditions.customExcludeSubmitted && appRecord?.status) return false;
        return true;
      }
      return !appRecord?.status;
    });
    userIds = candidates.map((u) => u.line_user_id).filter(Boolean);
  }
  if (userIds.length === 0) {
    return { processed: 0, sent: 0, skipped: 0, observed: 0, message: `no ${context} users` };
  }

  const { stepTypeMap, articleTypeFallback } = await fetchRetargetingStepTypeMap();

  const logs = await fetchRowsForUsers(
    userIds,
    (ids) => supabase
      .from('official_drip_logs')
      .select('line_user_id, step_number, sent_at')
      .in('line_user_id', ids)
      .order('step_number', { ascending: true }),
    'Retargeting drip logs'
  );

  const clicks = await fetchRowsForUsers(
    userIds,
    (ids) => supabase
      .from('official_line_clicks')
      .select('line_user_id, link_id, clicked_at')
      .in('line_user_id', ids)
      .like('link_id', 'drip_%'),
    'Retargeting drip clicks'
  );

  const retargetingClicks = await fetchRowsForUsers(
    userIds,
    (ids) => supabase
      .from('official_line_clicks')
      .select('line_user_id, link_id, clicked_at')
      .in('line_user_id', ids)
      .like('link_id', 'retargeting_auto_%'),
    'Retargeting auto clicks'
  );

  const logsByUser = {};
  for (const log of logs || []) {
    if (!logsByUser[log.line_user_id]) logsByUser[log.line_user_id] = [];
    logsByUser[log.line_user_id].push(log);
  }
  const clicksByUser = {};
  for (const click of clicks || []) {
    if (!clicksByUser[click.line_user_id]) clicksByUser[click.line_user_id] = [];
    clicksByUser[click.line_user_id].push(click);
  }
  const retargetingClicksByUser = {};
  for (const click of retargetingClicks || []) {
    if (!retargetingClicksByUser[click.line_user_id]) retargetingClicksByUser[click.line_user_id] = [];
    retargetingClicksByUser[click.line_user_id].push(click);
  }

  let processed = 0;
  let sent = 0;
  let skipped = 0;
  let pending = 0;
  let observed = 0;
  const now = new Date();
  const usersById = Object.fromEntries(candidates.map((u) => [u.line_user_id, u]));

  for (const userId of userIds) {
    processed++;
    const userLogs = logsByUser[userId] || [];
    const uniqueLogs = [...new Map(userLogs.map((log) => [log.step_number, log])).values()]
      .sort((a, b) => a.step_number - b.step_number);

    const audience = evaluateRetargetingAudience(
      config,
      usersById[userId],
      uniqueLogs,
      clicksByUser[userId] || [],
      appStatusByUser.get(userId),
      stepTypeMap
    );

    if (!audience.matched) {
      skipped++;
      continue;
    }

    const recentLogs = audience.recentLogs || [];
    const latestSentAt = recentLogs[recentLogs.length - 1]?.sent_at;
    if (latestSentAt && new Date(latestSentAt) > new Date(daysAgoIso(config.checkDelayDays || 0))) {
      skipped++;
      continue;
    }

    const storedState = state[userId] || {};
    const userState = config.activityId && storedState.activityId !== config.activityId
      ? {}
      : storedState;
    const windowKey = audience.windowKey || recentLogs.map((log) => log.step_number).join('-') || 'audience-match';
    const pendingForWindow = userState.pending?.windowKey === windowKey ? userState.pending : null;
    const engagedSinceLastSent = !!(
      userState.lastSentAt
      && userState.lastEngagementHandledForSentAt !== userState.lastSentAt
      && hasRetargetingEngagement(
        usersById[userId],
        retargetingClicksByUser[userId] || [],
        appStatusByUser.get(userId),
        userState.lastSentAt,
        config.engagementCriteria
      )
    );

    if (isCompletedRetargetingWindow(userState, windowKey)) {
      skipped++;
      continue;
    }

    if (engagedSinceLastSent) {
      state[userId] = {
        ...userState,
        activityId: config.activityId || userState.activityId,
        lastWindowKey: windowKey,
        completedWindowKey: windowKey,
        lastEngagementHandledForSentAt: userState.lastSentAt,
        observingUntil: null,
        pending: null,
        lastAction: 'engaged',
        updatedAt: new Date().toISOString(),
      };
      skipped++;
      continue;
    }

    if (pendingForWindow && new Date(pendingForWindow.scheduledAt) > now) {
      pending++;
      continue;
    }

    if (
      userState.lastSentAt
      && new Date(userState.lastSentAt) > new Date(daysAgoIso(config.observeDays || 1))
    ) {
      state[userId] = {
        ...userState,
        activityId: config.activityId || userState.activityId,
        observingUntil: daysAfterIso(userState.lastSentAt, config.observeDays || 1),
        updatedAt: new Date().toISOString(),
      };
      pending++;
      continue;
    }

    const next = pendingForWindow
      ? { action: 'send', stage: pendingForWindow.stage }
      : getNextRetargetingStage(config, userState);
    if (next.action !== 'send') {
      state[userId] = {
        ...userState,
        activityId: config.activityId || userState.activityId,
        lastWindowKey: windowKey,
        completedWindowKey: windowKey,
        lastAction: next.action,
        updatedAt: new Date().toISOString(),
      };
      skipped++;
      continue;
    }

    if (config.observeOnly) {
      if (userState.observedWindowKey === windowKey) {
        skipped++;
        continue;
      }
      const ok = await recordRetargetingObservation(userId, config, next.stage, windowKey, context);
      if (ok) {
        state[userId] = {
          ...userState,
          activityId: config.activityId || userState.activityId,
          observedWindowKey: windowKey,
          observedStage: next.stage,
          observedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        observed++;
      } else {
        skipped++;
      }
      continue;
    }

    if (config.sendMode === 'scheduled') {
      const scheduledAt = userState.pending?.scheduledAt || taipeiScheduledAt(config.sendDelayDays || 0, config.sendAtTime || '14:00');
      if (new Date(scheduledAt) > now) {
        state[userId] = {
          ...userState,
          activityId: config.activityId || userState.activityId,
          pending: { stage: next.stage, windowKey, scheduledAt },
          updatedAt: new Date().toISOString(),
        };
        pending++;
        continue;
      }
    }

    const sendResult = await sendRetargetingMessage(userId, config, next.stage, windowKey, context);
    if (sendResult.ok) {
      state[userId] = {
        ...userState,
        activityId: config.activityId || userState.activityId,
        sentCount: (userState.sentCount || 0) + 1,
        lastStage: next.stage,
        lastSentAt: new Date().toISOString(),
        lastEngagementHandledForSentAt: null,
        observingUntil: daysAfterIso(new Date().toISOString(), config.observeDays || 1),
        lastWindowKey: windowKey,
        completedWindowKey: null,
        pending: null,
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
      sent++;
    } else {
      state[userId] = {
        ...userState,
        activityId: config.activityId || userState.activityId,
        pending: userState.pending || { stage: next.stage, windowKey, scheduledAt: new Date().toISOString() },
        lastAttemptAt: new Date().toISOString(),
        lastError: sendResult.error || 'send failed',
        attemptCount: (userState.attemptCount || 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      skipped++;
    }
  }

  await supabase
    .from('official_settings')
    .upsert({
      key: stateKey,
      value: JSON.stringify(state),
      updated_at: new Date().toISOString(),
    });

  return {
    processed,
    sent,
    skipped,
    pending,
    observed,
    testMode: isTestMode,
    observeOnly: !!config.observeOnly,
    articleTypeFallback,
  };
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
  const users = await fetchAllRows(() => {
    let usersQuery = supabase
      .from('official_line_users')
      .select('line_user_id, drip_week, tags')
      .lte('drip_next_at', now)
      .eq('drip_paused', false)
      .eq('is_blocked', false)
      .lt('drip_week', totalSteps)
      .order('drip_next_at', { ascending: true })
      .order('line_user_id', { ascending: true });

    // 測試模式：只推給管理者
    if (isTestMode) {
      usersQuery = usersQuery.contains('tags', ['管理者']);
    }

    return usersQuery;
  }, 'Drip due users');

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

    // 正式模式才套用商業排除標籤。管理者測試需保留真實標籤，
    // 但仍能從第 1 篇完整重跑排程與後續再行銷。
    if (!isTestMode && article.exclude_tag && user.tags?.includes(article.exclude_tag)) {
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
