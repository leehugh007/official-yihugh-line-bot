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
import {
  appendCompletedRetargetingWindow,
  buildRetargetingHaltState,
  buildRetargetingSentState,
  findInactiveLogWindows,
  getNextRetargetingStep,
  getRetargetingSkipLastWindowKey,
  getRetargetingStageObserveDays,
  getRetargetingStageTemplate,
  isCompletedRetargetingWindow,
  selectRetargetingWindow,
  shouldSkipRetargetingDueToCooldown,
  shouldScheduleRetargetingStep,
} from '../../../../lib/retargeting-stage-timing.js';

// 狀態要等整輪跑完才寫回 DB；設上限避免中途被砍導致已發送但狀態沒存、下一輪重發
export const maxDuration = 60;

const ADMIN_TAG = '\u7ba1\u7406\u8005';
const ENROLLED_TAG = '\u5df2\u5831\u540d\u6e1b\u91cd\u73ed';
const PENDING_PAYMENT_RULE = 'pending_payment';
const DRIP_ARTICLE_TYPES = new Set(['student_story', 'health_article', 'intro', 'method', 'apply', 'other']);
const SUPABASE_PAGE_SIZE = 1000;
const SUPABASE_IN_CHUNK_SIZE = 500;
const SUPABASE_MAX_ROWS = 100000;
const RETARGETING_ACTIVITY_LIBRARY_KEY = 'retargeting_activity_library';

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
  let scheduled = new Date(Date.UTC(y, m, d, hour - 8, minute, 0, 0));
  // 當天指定時間已過就排到隔天同一時間，不立即發送
  if (scheduled.getTime() <= Date.now()) {
    scheduled = new Date(scheduled.getTime() + 24 * 60 * 60 * 1000);
  }
  return scheduled.toISOString();
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

function getRetargetingStateKey(config = {}, userId) {
  return `${getRetargetingActivityKey(config)}:${userId}`;
}

function getRetargetingUserState(state = {}, config = {}, userId) {
  const key = getRetargetingStateKey(config, userId);
  const current = state[key];
  if (current && (!current.activityId || current.activityId === getRetargetingActivityKey(config))) return current;
  const legacy = state[userId];
  if (legacy && (!legacy.activityId || legacy.activityId === getRetargetingActivityKey(config))) return legacy;
  return {};
}

function setRetargetingUserState(state = {}, config = {}, userId, value = {}) {
  const activityId = getRetargetingActivityKey(config);
  if (state[userId] && (!state[userId].activityId || state[userId].activityId === activityId)) {
    delete state[userId];
  }
  state[getRetargetingStateKey(config, userId)] = {
    ...value,
    activityId,
    lineUserId: userId,
  };
}

function normalizeRetargetingActivityConfig(config = {}, fallbackPriority = 999) {
  return {
    ...config,
    activityId: config.activityId || config.id || config.ruleId || `activity_${fallbackPriority}`,
    id: config.activityId || config.id || config.ruleId || `activity_${fallbackPriority}`,
    priority: Math.max(1, Number(config.priority || fallbackPriority)),
    enabled: !!config.enabled,
  };
}

function getActiveRetargetingConfigs(primaryConfig = null, activityLibrary = []) {
  const byId = new Map();
  const add = (item, index) => {
    if (!item) return;
    const config = normalizeRetargetingActivityConfig(item, index + 1);
    if (!config.enabled) return;
    byId.set(config.activityId, config);
  };
  (Array.isArray(activityLibrary) ? activityLibrary : []).forEach(add);
  if (primaryConfig?.enabled && !byId.has(primaryConfig.activityId || primaryConfig.id || primaryConfig.ruleId)) {
    add(primaryConfig, byId.size);
  }
  return [...byId.values()].sort((a, b) => (
    Number(a.priority || 999) - Number(b.priority || 999)
    || String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''))
    || String(a.activityId || '').localeCompare(String(b.activityId || ''))
  ));
}

function getRetargetingStepKey(cycle = 1, stage = 1) {
  return `c${Number(cycle) || 1}_s${Number(stage) || 1}`;
}

function normalizeRetargetingStep(step) {
  if (typeof step === 'number') return { cycle: 1, stage: step, flowType: step === 1 ? 'initial' : 'no_response' };
  return {
    cycle: Math.max(1, Number(step?.cycle || 1)),
    stage: Math.max(1, Number(step?.stage || 1)),
    flowType: step?.flowType || (Number(step?.cycle || 1) > 1 ? 'requalification' : Number(step?.stage || 1) > 1 ? 'no_response' : 'initial'),
  };
}

function textHasTestMarker(value) {
  return /測試|test/i.test(String(value || ''));
}

function normalizeRetargetingCycleFlows(config = {}) {
  const rawFlows = Array.isArray(config.cycleFlows) ? config.cycleFlows.slice(0, 3) : [];
  if (rawFlows.length > 0) {
    return rawFlows.map((flow, index) => {
      const cycle = Math.max(1, Number(flow?.cycle || index + 1));
      const stages = Array.isArray(flow?.stages) ? flow.stages : [];
      return {
        cycle,
        enabled: cycle === 1 ? flow?.enabled !== false : !!flow?.enabled,
        finalAction: flow?.finalAction || config.thirdStageAction || 'cooldown',
        stages: [1, 2, 3].map((stageNumber) => {
          const stage = stages.find((item) => Number(item?.stage) === stageNumber) || {};
          return {
            ...stage,
            cycle,
            stage: stageNumber,
            observeDays: getRetargetingStageObserveDays(config, cycle, stageNumber),
            enabled: stageNumber === 1 ? (cycle === 1 ? flow?.enabled !== false : !!flow?.enabled) : !!stage.enabled,
          };
        }),
      };
    });
  }

  const templates = Array.isArray(config.stageTemplates) ? config.stageTemplates : [];
  return [{
    cycle: 1,
    enabled: true,
    finalAction: config.thirdStageAction || 'cooldown',
    stages: [1, 2, 3].map((stageNumber) => ({
      ...(templates[stageNumber - 1] || {}),
      cycle: 1,
      stage: stageNumber,
      observeDays: getRetargetingStageObserveDays(config, 1, stageNumber),
      enabled: stageNumber === 1
        ? !!templates[0]
        : stageNumber === 2
          ? config.stage2Enabled !== false && !!templates[1]
          : config.stage2Enabled !== false && !!config.stage3Enabled && !!templates[2],
    })),
  }];
}

function getActiveRetargetingStageTemplates(config = {}) {
  if (config.repeatStrategy !== 'staged') {
    const first = getRetargetingStageTemplate(config, 1, 1);
    return first ? [first] : [];
  }
  return normalizeRetargetingCycleFlows(config)
    .filter((flow) => flow.enabled)
    .flatMap((flow) => flow.stages.filter((stage) => stage.enabled !== false && stage.message));
}

function validateRetargetingAudienceConfig(config = {}) {
  const conditions = getRetargetingAudienceConditions(config);
  const ruleId = conditions.presetId || config.ruleId || 'dropoff';
  const enabled = conditions.enabledConditions || {};
  const enabledKeys = Object.entries(enabled).filter(([, value]) => value).map(([key]) => key);
  if (enabledKeys.length === 0) return '受眾沒有啟用任何判斷條件';
  if (enabled.receivedMin && Number(conditions.receivedMin || 0) < 1) {
    return '受眾的「已收到至少幾篇」必須大於 0';
  }
  if (enabled.inactiveSteps && Number(conditions.inactiveSteps || 0) < 1) {
    return '受眾的「最近連續幾篇沒有點擊」必須大於 0';
  }
  if (enabled.clickedMin && ruleId !== 'cold' && Number(conditions.clickedMin || 0) < 1) {
    return '受眾的「至少點擊幾篇」必須大於 0';
  }
  if (enabled.recentDays && Number(conditions.recentDays || 0) < 1) {
    return '受眾的「最近幾天有互動」必須大於 0';
  }
  if (enabled.joinedDays && Number(conditions.joinedDays || 0) < 0) {
    return '受眾的「加入至少幾天」不能小於 0';
  }
  if (enabled.applyDelayDays && Number(conditions.applyDelayDays || 0) < 0) {
    return '受眾的「點報名頁後等待幾天」不能小於 0';
  }
  if (enabled.paymentDelayDays && Number(conditions.paymentDelayDays || 0) < 0) {
    return '受眾的「送單後等待付款幾天」不能小於 0';
  }
  if (enabled.customArticleType && !conditions.customArticleType) {
    return '受眾有啟用文章類型，但沒有選擇文章類型';
  }
  return null;
}

function validateRetargetingFormalConfig(config = {}) {
  if (!config?.enabled) return null;
  const audienceError = validateRetargetingAudienceConfig(config);
  if (audienceError) return audienceError;
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

async function recordRetargetingObservation(userId, config, step, windowKey, context) {
  const { cycle, stage } = normalizeRetargetingStep(step);
  const template = getRetargetingStageTemplate(config, cycle, stage);
  if (!template?.message) return false;

  const activityKey = getRetargetingActivityKey(config);
  const stepKey = getRetargetingStepKey(cycle, stage);
  const linkId = `retargeting_auto_${activityKey}_${stepKey}_${Date.now()}`;
  const normalizedImageUrl = normalizePublicUrl(template.imageUrl);
  const { error } = await supabase.from('official_push_logs').insert({
    template_id: `retargeting_auto_${activityKey}_${stepKey}`,
    label: `自動再行銷觀察：第 ${cycle} 次符合 / 第 ${stage} 階段：${template.title || config.ruleTitle || '再行銷'}（${windowKey}）`,
    message: template.message,
    link_id: linkId,
    buttons: template.buttons || [],
    image_url: normalizedImageUrl || null,
    segments: [context, 'retargeting_auto', 'observe_only', `user:${userId}`],
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

async function sendRetargetingMessage(userId, config, step, windowKey, context) {
  const { cycle, stage } = normalizeRetargetingStep(step);
  const template = getRetargetingStageTemplate(config, cycle, stage);
  if (!template?.message) return { ok: false, error: 'template message missing' };

  const activityKey = getRetargetingActivityKey(config);
  const stepKey = getRetargetingStepKey(cycle, stage);
  const linkId = `retargeting_auto_${activityKey}_${stepKey}_${Date.now()}`;
  const lineMsg = buildFlexFromTemplate(template, linkId, userId);
  const pushResult = await pushMessageWithResult(userId, lineMsg);
  const normalizedImageUrl = normalizePublicUrl(template.imageUrl);
  if (!pushResult.ok) {
    const errorText = (pushResult.errorText || `LINE push failed (${pushResult.status})`).slice(0, 700);
    await supabase.from('official_push_logs').insert({
      template_id: `retargeting_auto_${activityKey}_${stepKey}`,
      label: `自動再行銷發送失敗：第 ${cycle} 次符合 / 第 ${stage} 階段：${template.title || config.ruleTitle || '再行銷'}（${windowKey}）`,
      message: `${template.message}\n\n[系統錯誤] ${errorText}`,
      link_id: linkId,
      buttons: template.buttons || [],
      image_url: normalizedImageUrl || null,
      segments: [context, 'retargeting_auto', `user:${userId}`],
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
    template_id: `retargeting_auto_${activityKey}_${stepKey}`,
    label: `自動再行銷${context === 'admin' ? '測試' : '正式'}：第 ${cycle} 次符合 / 第 ${stage} 階段：${template.title || config.ruleTitle || '再行銷'}（${windowKey}）`,
    message: template.message,
    link_id: linkId,
    buttons: template.buttons || [],
    image_url: normalizedImageUrl || null,
    segments: [context, 'retargeting_auto', `user:${userId}`],
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
  if (!sinceIso) return false;
  return [user?.last_user_reply_at, user?.last_interaction_at]
    .filter(Boolean)
    .some((iso) => new Date(iso) >= new Date(sinceIso));
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

function markRetargetingSkip(state, userId, userState, config, windowKey, reason, extra = {}) {
  setRetargetingUserState(state, config, userId, {
    ...userState,
    activityId: config.activityId || userState.activityId,
    lastWindowKey: getRetargetingSkipLastWindowKey(userState, windowKey, reason),
    lastSkipReason: reason,
    lastSkipAt: new Date().toISOString(),
    ...extra,
    updatedAt: new Date().toISOString(),
  });
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
    clickedMin: configNumber(raw.clickedMin ?? raw.customMinimumClicks, 2, 0),
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
    customMinimumClicks: configNumber(raw.clickedMin ?? raw.customMinimumClicks, 1, 1),
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

function isRetargetingUserReserved(userState = {}, now = new Date()) {
  const pendingAt = userState.pending?.scheduledAt || userState.nextScheduledAt;
  if (pendingAt && new Date(pendingAt) > now) return true;
  if (userState.observingUntil && new Date(userState.observingUntil) > now) return true;
  return false;
}

function compactRetargetingLogs(logs = []) {
  return (logs || []).map((log) => ({
    step_number: Number(log.step_number),
    sent_at: log.sent_at,
  }));
}

function retargetingWindowPayload(window = {}) {
  return {
    windowKey: window.windowKey,
    windowLogs: compactRetargetingLogs(window.recentLogs || []),
    windowLatestSentAt: window.latestSentAt || window.recentLogs?.at(-1)?.sent_at || null,
  };
}

function getAudienceArticleType(ruleId, conditions, enabled) {
  if (enabled.customArticleType && conditions.customArticleType && conditions.customArticleType !== 'any') {
    return conditions.customArticleType;
  }
  if (ruleId === 'warm' && conditions.storyOnly) return 'student_story';
  return 'any';
}

function filterLogsByArticleType(logs = [], stepTypeMap = new Map(), articleType = 'any') {
  if (!articleType || articleType === 'any') return logs;
  return logs.filter((log) => (stepTypeMap.get(Number(log.step_number)) || 'other') === articleType);
}

function evaluateRetargetingAudience(config, user, uniqueLogs, userClicks, appRecord, stepTypeMap, userState = {}) {
  const ruleId = config.ruleId || 'dropoff';
  const conditions = getRetargetingAudienceConditions(config);
  const enabled = conditions.enabledConditions || {};
  const articleType = getAudienceArticleType(ruleId, conditions, enabled);
  const logPool = filterLogsByArticleType(uniqueLogs, stepTypeMap, articleType);
  const userClickSteps = getUniqueDripClickSteps(userClicks, stepTypeMap, articleType);
  const dripClickCount = userClickSteps.size;
  const applyClickCount = Number(user?.q5_click_count || 0);
  const applyClickedAt = user?.q5_clicked_at;
  let preferredWindow = null;

  if (enabled.receivedMin && logPool.length < conditions.receivedMin) return { matched: false };

  if (enabled.clickedMin) {
    if (ruleId === 'cold') {
      if (dripClickCount > 0) return { matched: false };
    } else if (dripClickCount < conditions.clickedMin) {
      return { matched: false };
    }
  }

  if (enabled.inactiveSteps) {
    const windows = findInactiveLogWindows(logPool, conditions.inactiveSteps, userClickSteps);
    preferredWindow = selectRetargetingWindow(windows, userState);
    if (!preferredWindow) return { matched: false };
  }

  if (enabled.recentDays && !hasClickSince(userClicks, conditions.recentDays, stepTypeMap, articleType)) return { matched: false };
  if (enabled.joinedDays && !isOlderThanDays(user?.joined_at, conditions.joinedDays)) return { matched: false };
  if (enabled.excludeApplyClickers && conditions.excludeApplyClickers && applyClickCount > 0) return { matched: false };
  if (enabled.applyClicks && applyClickCount < conditions.applyClicks) return { matched: false };
  if (enabled.applyDelayDays && !isOlderThanDays(applyClickedAt, conditions.applyDelayDays)) return { matched: false };
  if (enabled.paymentDelayDays && !isOlderThanDays(appRecord?.submitted_at, conditions.paymentDelayDays)) return { matched: false };

  if (ruleId === 'dropoff') {
    return { matched: true, ...(preferredWindow || latestLogWindow(logPool)) };
  }

  if (ruleId === 'warm') {
    return { matched: true, ...(preferredWindow || latestLogWindow(logPool)) };
  }

  if (ruleId === 'apply_no_submit') {
    if (enabled.customExcludeSubmitted && appRecord?.status) return { matched: false };
    if (enabled.customExcludePaid && appRecord?.status === 'paid') return { matched: false };
    if (preferredWindow) return { matched: true, ...preferredWindow };
    return {
      matched: true,
      ...latestLogWindow(logPool),
      windowKey: `apply-${String(applyClickedAt || '').slice(0, 10) || 'clicked'}`,
    };
  }

  if (ruleId === PENDING_PAYMENT_RULE) {
    if (appRecord?.status !== 'pending') return { matched: false };
    if (preferredWindow) return { matched: true, ...preferredWindow };
    return {
      matched: true,
      ...latestLogWindow(logPool),
      windowKey: `pending-${String(appRecord.submitted_at || '').slice(0, 10) || 'submitted'}`,
    };
  }

  if (ruleId === 'cold') {
    return { matched: true, ...(preferredWindow || latestLogWindow(logPool)) };
  }

  if (ruleId === 'custom') {
    if (enabled.customExcludePaid && conditions.customExcludePaid && appRecord?.status === 'paid') return { matched: false };
    if (enabled.customExcludeSubmitted && conditions.customExcludeSubmitted && appRecord?.status) return { matched: false };
    return { matched: true, ...(preferredWindow || latestLogWindow(logPool)) };
  }

  return { matched: false };
}

async function fetchRetargetingUsers(isTestMode) {
  return fetchAllRows(() => {
    let usersQuery = supabase
      .from('official_line_users')
      .select('line_user_id, last_user_reply_at, last_interaction_at, tags, joined_at, q5_clicked_at, q5_click_count')
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
  const { data: activitySetting } = await supabase
    .from('official_settings')
    .select('value')
    .eq('key', RETARGETING_ACTIVITY_LIBRARY_KEY)
    .maybeSingle();
  const activeConfigs = getActiveRetargetingConfigs(
    config,
    safeJsonParse(activitySetting?.value, [])
  );
  if (activeConfigs.length === 0) {
    return { processed: 0, sent: 0, skipped: 0, observed: 0, activities: 0, message: 'retargeting disabled' };
  }
  const blockedActivities = [];
  const runnableConfigs = activeConfigs.filter((activityConfig) => {
    if (isTestMode) return true;
    const formalError = validateRetargetingFormalConfig(activityConfig);
    if (!formalError) return true;
    blockedActivities.push({
      activityId: getRetargetingActivityKey(activityConfig),
      activityName: activityConfig.activityName || activityConfig.ruleTitle,
      error: formalError,
    });
    return false;
  });
  if (runnableConfigs.length === 0) {
    return {
      processed: 0,
      sent: 0,
      skipped: 0,
      observed: 0,
      activities: activeConfigs.length,
      blocked: true,
      blockedActivities,
      message: blockedActivities[0]?.error || 'all retargeting activities blocked',
    };
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
  const reservedUserIds = new Set();
  for (const activityConfig of runnableConfigs) {
    for (const userId of userIds) {
      const existingState = getRetargetingUserState(state, activityConfig, userId);
      if (isRetargetingUserReserved(existingState, now)) reservedUserIds.add(userId);
    }
  }
  const activityResults = [];

  for (const config of runnableConfigs) {
    let activityProcessed = 0;
    let activitySent = 0;
    let activitySkipped = 0;
    let activityPending = 0;
    let activityObserved = 0;

  for (const userId of userIds) {
    processed++;
    activityProcessed++;
    if (reservedUserIds.has(userId)) {
      skipped++;
      activitySkipped++;
      continue;
    }
    const userLogs = logsByUser[userId] || [];
    const uniqueLogs = [...new Map(userLogs.map((log) => [log.step_number, log])).values()]
      .sort((a, b) => a.step_number - b.step_number);
    const userState = getRetargetingUserState(state, config, userId);
    const appRecord = appStatusByUser.get(userId);

    if (!isTestMode && config.ruleId !== PENDING_PAYMENT_RULE && config.ruleId !== 'custom' && appRecord?.status) {
      skipped++;
      activitySkipped++;
      continue;
    }

    const audience = evaluateRetargetingAudience(
      config,
      usersById[userId],
      uniqueLogs,
      clicksByUser[userId] || [],
      appRecord,
      stepTypeMap,
      userState
    );

    if (!audience.matched) {
      skipped++;
      activitySkipped++;
      continue;
    }

    const recentLogs = audience.recentLogs || [];
    const latestSentAt = audience.latestSentAt || recentLogs[recentLogs.length - 1]?.sent_at;
    const windowKey = audience.windowKey || recentLogs.map((log) => log.step_number).join('-') || 'audience-match';
    const windowPayload = retargetingWindowPayload({ recentLogs, windowKey, latestSentAt });

    const pendingForWindow = userState.pending?.windowKey === windowKey ? userState.pending : null;
    // 互動包含：再行銷訊息點擊/回覆 + 排程文章點擊（回頭點文章＝被喚醒）
    const engagedSinceLastSent = !!(
      userState.lastSentAt
      && userState.lastEngagementHandledForSentAt !== userState.lastSentAt
      && hasRetargetingEngagement(
        usersById[userId],
        [...(retargetingClicksByUser[userId] || []), ...(clicksByUser[userId] || [])],
        appStatusByUser.get(userId),
        userState.lastSentAt,
        config.engagementCriteria
      )
    );

    // 互動檢查放在冷卻檢查之前：冷卻後遲來的互動代表變暖，解除冷卻、下次符合走下一輪（留活口）
    if (engagedSinceLastSent) {
      setRetargetingUserState(state, config, userId, {
        ...userState,
        activityId: config.activityId || userState.activityId,
        lastWindowKey: windowKey,
        completedWindowKey: windowKey,
        completedWindowKeys: appendCompletedRetargetingWindow(userState, windowKey),
        currentWindowKey: null,
        currentWindowLogs: null,
        currentWindowLatestSentAt: null,
        lastEngagementHandledForSentAt: userState.lastSentAt,
        observingUntil: null,
        pending: null,
        nextCheckAfter: null,
        nextScheduledAt: null,
        lastAction: 'engaged',
        updatedAt: new Date().toISOString(),
      });
      skipped++;
      activitySkipped++;
      continue;
    }

    if (shouldSkipRetargetingDueToCooldown(config, userState, windowKey)) {
      setRetargetingUserState(state, config, userId, {
        ...userState,
        activityId: config.activityId || userState.activityId,
        lastWindowKey: windowKey,
        completedWindowKey: windowKey,
        completedWindowKeys: appendCompletedRetargetingWindow(userState, windowKey),
        currentWindowKey: null,
        currentWindowLogs: null,
        currentWindowLatestSentAt: null,
        pending: null,
        nextCheckAfter: null,
        nextScheduledAt: null,
        lastAction: 'cooldown',
        lastSkipReason: 'repeat_cooldown_after_no_response',
        lastSkipAt: new Date().toISOString(),
        ...windowPayload,
        updatedAt: new Date().toISOString(),
      });
      skipped++;
      activitySkipped++;
      continue;
    }
    if (latestSentAt && new Date(latestSentAt) > new Date(daysAgoIso(config.checkDelayDays || 0))) {
      markRetargetingSkip(state, userId, userState, config, windowKey, 'waiting_check_delay', {
        nextCheckAfter: daysAfterIso(latestSentAt, config.checkDelayDays || 0),
        ...windowPayload,
      });
      skipped++;
      activitySkipped++;
      continue;
    }

    if (isCompletedRetargetingWindow(userState, windowKey)) {
      markRetargetingSkip(state, userId, userState, config, windowKey, 'window_completed');
      skipped++;
      activitySkipped++;
      continue;
    }

    if (pendingForWindow && new Date(pendingForWindow.scheduledAt) > now) {
      markRetargetingSkip(state, userId, userState, config, windowKey, 'pending_scheduled_send', {
        nextScheduledAt: pendingForWindow.scheduledAt,
        nextCheckAfter: null,
        ...windowPayload,
      });
      reservedUserIds.add(userId);
      pending++;
      activityPending++;
      continue;
    }

    const lastStageObserveDays = getRetargetingStageObserveDays(
      config,
      userState.currentCycle || userState.lastCycle || 1,
      userState.stageInCycle || userState.lastStage || 1
    );
    if (
      userState.lastSentAt
      && new Date(userState.lastSentAt) > new Date(daysAgoIso(lastStageObserveDays))
    ) {
      setRetargetingUserState(state, config, userId, {
        ...userState,
        activityId: config.activityId || userState.activityId,
        observingUntil: daysAfterIso(userState.lastSentAt, lastStageObserveDays),
        lastSkipReason: 'observing_after_retargeting',
        lastSkipAt: new Date().toISOString(),
        nextCheckAfter: null,
        ...windowPayload,
        updatedAt: new Date().toISOString(),
      });
      reservedUserIds.add(userId);
      pending++;
      activityPending++;
      continue;
    }

    let next = pendingForWindow
      ? {
          action: 'send',
          cycle: pendingForWindow.cycle || 1,
          stage: pendingForWindow.stage || 1,
          flowType: pendingForWindow.flowType,
        }
      : getNextRetargetingStep(config, userState, windowKey);
    if (
      pendingForWindow
      && next.action === 'send'
      && !getRetargetingStageTemplate(config, next.cycle, next.stage)?.message
    ) {
      // 排程等待期間模板被改掉／停用：不硬發錯的內容，重新判斷下一步
      next = getNextRetargetingStep(config, userState, windowKey);
    }
    if (next.action !== 'send') {
      setRetargetingUserState(
        state,
        config,
        userId,
        buildRetargetingHaltState(userState, config, next, windowPayload, new Date().toISOString())
      );
      skipped++;
      activitySkipped++;
      continue;
    }

    if (config.observeOnly) {
      if (userState.observedWindowKey === windowKey) {
        markRetargetingSkip(state, userId, userState, config, windowKey, 'already_observed_window');
        skipped++;
        activitySkipped++;
        continue;
      }
      const ok = await recordRetargetingObservation(userId, config, next, windowKey, context);
      if (ok) {
        setRetargetingUserState(state, config, userId, {
          ...userState,
          activityId: config.activityId || userState.activityId,
          observedWindowKey: windowKey,
          observedCycle: next.cycle,
          observedStage: next.stage,
          observedAt: new Date().toISOString(),
          nextCheckAfter: null,
          nextScheduledAt: null,
          ...windowPayload,
          updatedAt: new Date().toISOString(),
        });
        reservedUserIds.add(userId);
        observed++;
        activityObserved++;
      } else {
        skipped++;
        activitySkipped++;
      }
      continue;
    }

    if (shouldScheduleRetargetingStep(config, next)) {
      const scheduledAt = userState.pending?.scheduledAt || taipeiScheduledAt(config.sendDelayDays || 0, config.sendAtTime || '14:00');
      if (new Date(scheduledAt) > now) {
        setRetargetingUserState(state, config, userId, {
          ...userState,
          activityId: config.activityId || userState.activityId,
          pending: {
            cycle: next.cycle || 1,
            stage: next.stage || 1,
            flowType: next.flowType,
            windowKey,
            windowLogs: windowPayload.windowLogs,
            windowLatestSentAt: windowPayload.windowLatestSentAt,
            scheduledAt,
          },
          lastSkipReason: 'scheduled_for_later',
          lastSkipAt: new Date().toISOString(),
          nextCheckAfter: null,
          nextScheduledAt: scheduledAt,
          ...windowPayload,
          updatedAt: new Date().toISOString(),
        });
        reservedUserIds.add(userId);
        pending++;
        activityPending++;
        continue;
      }
    }

    const sendResult = await sendRetargetingMessage(userId, config, next, windowKey, context);
    if (sendResult.ok) {
      const sentAt = new Date().toISOString();
      setRetargetingUserState(
        state,
        config,
        userId,
        buildRetargetingSentState(userState, config, next, windowPayload, sentAt)
      );
      reservedUserIds.add(userId);
      sent++;
      activitySent++;
    } else {
      setRetargetingUserState(state, config, userId, {
        ...userState,
        activityId: config.activityId || userState.activityId,
        pending: userState.pending || {
          cycle: next.cycle || 1,
          stage: next.stage || 1,
          flowType: next.flowType,
          windowKey,
          windowLogs: windowPayload.windowLogs,
          windowLatestSentAt: windowPayload.windowLatestSentAt,
          scheduledAt: new Date().toISOString(),
        },
        lastAttemptAt: new Date().toISOString(),
        lastError: sendResult.error || 'send failed',
        attemptCount: (userState.attemptCount || 0) + 1,
        updatedAt: new Date().toISOString(),
      });
      skipped++;
      activitySkipped++;
    }
  }

    activityResults.push({
      activityId: getRetargetingActivityKey(config),
      activityName: config.activityName || config.ruleTitle,
      processed: activityProcessed,
      sent: activitySent,
      skipped: activitySkipped,
      pending: activityPending,
      observed: activityObserved,
    });

    // 每跑完一個活動就先寫回狀態：中途 timeout 才不會讓已發送的紀錄消失導致下一輪重發
    await supabase
      .from('official_settings')
      .upsert({
        key: stateKey,
        value: JSON.stringify(state),
        updated_at: new Date().toISOString(),
      });
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
    activities: runnableConfigs.length,
    activityResults,
    blockedActivities,
    reservedUsers: reservedUserIds.size,
    testMode: isTestMode,
    observeOnly: runnableConfigs.every((item) => !!item.observeOnly),
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
