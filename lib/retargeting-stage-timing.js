export function normalizeRetargetingObserveDays(value, fallback = 1) {
  const fallbackNumber = Number(fallback);
  const fallbackDays = Number.isFinite(fallbackNumber) && fallbackNumber >= 1
    ? Math.floor(fallbackNumber)
    : 1;
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : fallbackDays;
}

export function getRetargetingStageObserveDays(config = {}, cycle = 1, stage = 1) {
  const fallbackDays = normalizeRetargetingObserveDays(config.observeDays, 1);
  const flows = Array.isArray(config.cycleFlows) ? config.cycleFlows : [];
  const flow = flows.find((item) => Number(item?.cycle || 1) === Number(cycle || 1));
  const stages = Array.isArray(flow?.stages) ? flow.stages : [];
  const stageConfig = stages.find((item) => Number(item?.stage || 1) === Number(stage || 1))
    || (Number(cycle || 1) === 1 ? config.stageTemplates?.[Number(stage || 1) - 1] : null);
  return normalizeRetargetingObserveDays(stageConfig?.observeDays, fallbackDays);
}

export function shouldScheduleRetargetingStep(config = {}, step = {}) {
  return config.sendMode === 'scheduled' && Number(step.stage || 1) === 1;
}

function daysAfterIso(iso, days) {
  const date = new Date(iso);
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString();
}

const TERMINAL_RETARGETING_ACTIONS = new Set(['engaged', 'cooldown', 'manual', 'stop', 'skip']);
const NON_TERMINAL_SKIP_REASONS = new Set([
  'waiting_check_delay',
  'pending_scheduled_send',
  'observing_after_retargeting',
  'scheduled_for_later',
  'already_observed_window',
]);

function normalizeCycleNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : 1;
}

function normalizeStageNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : 1;
}

function legacyStageEnabled(config = {}, stageNumber = 1, template = null) {
  if (!template) return false;
  if (template.enabled === false) return false;
  if (stageNumber === 1) return true;
  if (stageNumber === 2) return config.stage2Enabled !== false;
  if (stageNumber === 3) return config.stage2Enabled !== false && !!config.stage3Enabled;
  return false;
}

export function getRetargetingStageTemplate(config = {}, cycle = 1, stage = 1) {
  const cycleNumber = normalizeCycleNumber(cycle);
  const stageNumber = normalizeStageNumber(stage);
  const flows = Array.isArray(config.cycleFlows) ? config.cycleFlows : [];

  if (flows.length > 0) {
    const flow = flows.find((item) => normalizeCycleNumber(item?.cycle) === cycleNumber);
    if (!flow) return null;

    const flowEnabled = cycleNumber === 1 ? flow.enabled !== false : !!flow.enabled;
    if (!flowEnabled) return null;

    const stages = Array.isArray(flow.stages) ? flow.stages : [];
    const stageConfig = stages.find((item) => normalizeStageNumber(item?.stage) === stageNumber) || {
      stage: stageNumber,
      templateId: flow[`stage${stageNumber}TemplateId`],
      observeDays: flow[`stage${stageNumber}ObserveDays`],
      enabled: stageNumber === 1 ? true : !!flow[`stage${stageNumber}Enabled`],
    };

    const stageEnabled = stageNumber === 1 ? true : stageConfig.enabled === true;
    if (!stageEnabled) return null;
    if (stageConfig.message) return stageConfig;

    const legacyTemplate = cycleNumber === 1 ? config.stageTemplates?.[stageNumber - 1] : null;
    if (!legacyTemplate || legacyTemplate.enabled === false || !legacyTemplate.message) return null;
    return {
      ...legacyTemplate,
      cycle: cycleNumber,
      stage: stageNumber,
      observeDays: stageConfig.observeDays ?? legacyTemplate.observeDays,
      enabled: true,
    };
  }

  if (cycleNumber !== 1) return null;
  const legacyTemplate = config.stageTemplates?.[stageNumber - 1] || null;
  if (!legacyStageEnabled(config, stageNumber, legacyTemplate)) return null;
  return legacyTemplate?.message ? legacyTemplate : null;
}

export function getRetargetingCycleFlow(config = {}, cycle = 1) {
  const cycleNumber = normalizeCycleNumber(cycle);
  const flows = Array.isArray(config.cycleFlows) ? config.cycleFlows : [];
  const flow = flows.find((item) => normalizeCycleNumber(item?.cycle) === cycleNumber);
  if (flow) {
    return {
      ...flow,
      cycle: cycleNumber,
      enabled: cycleNumber === 1 ? flow.enabled !== false : !!flow.enabled,
      finalAction: flow.finalAction || config.thirdStageAction || 'cooldown',
    };
  }
  if (cycleNumber !== 1) return null;
  return {
    cycle: 1,
    enabled: true,
    finalAction: config.thirdStageAction || 'cooldown',
  };
}

export function getNextRetargetingStep(config = {}, userState = {}, windowKey) {
  const sentCount = userState?.sentCount || 0;
  const cycleCount = Number(userState?.cycleCount || 0);
  if (userState?.stopped) {
    return { action: 'stop', reason: 'user_stopped' };
  }
  if (config.repeatStrategy === 'once' && (sentCount >= 1 || cycleCount >= 1)) {
    return { action: 'skip', reason: 'already_sent_once' };
  }
  if (config.repeatStrategy === 'cooldown' && (sentCount >= 1 || cycleCount >= 1)) {
    return { action: 'cooldown', reason: 'repeat_cooldown' };
  }
  if (config.repeatStrategy === 'staged') {
    if (shouldSkipRetargetingDueToCooldown(config, userState, windowKey)) {
      return { action: 'cooldown', reason: 'repeat_cooldown_after_no_response', cycle: Math.max(1, cycleCount || 1) };
    }
    const sameWindow = userState.currentWindowKey === windowKey;
    const cycle = sameWindow
      ? Math.max(1, Number(userState.currentCycle || userState.cycleCount || 1))
      : Math.max(1, Math.min(3, userState.lastAction === 'engaged' ? cycleCount + 1 : 1));
    const flow = getRetargetingCycleFlow(config, cycle);
    if (!flow?.enabled) {
      return { action: config.thirdStageAction || 'cooldown', reason: 'cycle_disabled', cycle };
    }
    const nextStage = sameWindow
      ? Math.max(1, Number(userState.stageInCycle || userState.lastStage || 0) + 1)
      : 1;
    const template = getRetargetingStageTemplate(config, cycle, nextStage);
    if (template?.message) {
      return {
        action: 'send',
        cycle,
        stage: nextStage,
        flowType: cycle > 1 ? 'requalification' : nextStage > 1 ? 'no_response' : 'initial',
      };
    }
    return { action: flow.finalAction || config.thirdStageAction || 'cooldown', reason: 'no_more_stage', cycle };
  }
  return sentCount === 0
    ? { action: 'send', cycle: 1, stage: 1, flowType: 'initial' }
    : { action: 'skip', reason: 'already_sent' };
}

export function shouldSkipRetargetingDueToCooldown(config = {}, userState = {}, windowKey) {
  return config.repeatStrategy === 'staged'
    && userState.lastAction === 'cooldown'
    && userState.lastWindowKey !== windowKey
    && userState.currentWindowKey !== windowKey;
}

export function isCompletedRetargetingWindow(userState = {}, windowKey) {
  if (!windowKey) return false;
  if (userState.stopped) return true;
  if (Array.isArray(userState.completedWindowKeys) && userState.completedWindowKeys.includes(windowKey)) return true;
  if (userState.completedWindowKey === windowKey) return true;
  if (TERMINAL_RETARGETING_ACTIONS.has(userState.lastAction)) {
    return userState.lastWindowKey === windowKey;
  }
  return false;
}

export function getRetargetingSkipLastWindowKey(userState = {}, windowKey, reason) {
  if (
    windowKey
    && NON_TERMINAL_SKIP_REASONS.has(reason)
    && TERMINAL_RETARGETING_ACTIONS.has(userState.lastAction)
    && userState.lastWindowKey !== windowKey
  ) {
    return userState.lastWindowKey;
  }
  return windowKey || userState.lastWindowKey;
}

export function appendCompletedRetargetingWindow(userState = {}, windowKey) {
  if (!windowKey) return userState.completedWindowKeys || [];
  const keys = Array.isArray(userState.completedWindowKeys) ? userState.completedWindowKeys : [];
  return [...new Set([...keys, windowKey])].slice(-12);
}

export function findInactiveLogWindows(logs = [], size = 1, userClickSteps = new Set()) {
  const windowSize = Math.max(1, Number(size) || 1);
  if ((logs || []).length < windowSize) return [];
  // 只看「最新一段連續沒點」：從最後一篇往回收集沒點的文章，一碰到點過的就停。
  // 歷史上更早的漏點缺口（後面已有點擊）代表用戶已回流，不再翻舊帳觸發。
  const trailingLogs = [];
  for (let i = logs.length - 1; i >= 0; i--) {
    if (userClickSteps.has(Number(logs[i].step_number))) break;
    trailingLogs.unshift(logs[i]);
  }
  if (trailingLogs.length < windowSize) return [];
  const windows = [];
  for (let i = 0; i <= trailingLogs.length - windowSize; i++) {
    const recentLogs = trailingLogs.slice(i, i + windowSize);
    windows.push({
      recentLogs,
      windowKey: recentLogs.map((log) => log.step_number).join('-'),
      latestSentAt: recentLogs.at(-1)?.sent_at || null,
    });
  }
  return windows;
}

export function selectRetargetingWindow(windows = [], userState = {}) {
  const preferredKeys = [userState.pending?.windowKey, userState.currentWindowKey].filter(Boolean);
  for (const key of preferredKeys) {
    const matchedWindow = windows.find((window) => window.windowKey === key);
    if (matchedWindow && !isCompletedRetargetingWindow(userState, key)) return matchedWindow;
  }
  return windows.find((window) => !isCompletedRetargetingWindow(userState, window.windowKey)) || null;
}

export function buildRetargetingHaltState(userState = {}, config = {}, step = {}, windowPayload = {}, nowIso = new Date().toISOString()) {
  const windowKey = windowPayload.windowKey;
  // cycle_disabled ＝「下一輪沒開」而不是「這個人該收掉」：
  // 保留原本的 lastAction（如 engaged），之後啟用第 2/3 次符合時資格還在，也不寫入 stopped。
  const preserveAction = step?.reason === 'cycle_disabled';
  return {
    ...userState,
    activityId: config.activityId || userState.activityId,
    lastWindowKey: windowKey,
    completedWindowKey: windowKey,
    completedWindowKeys: appendCompletedRetargetingWindow(userState, windowKey),
    currentWindowKey: null,
    currentWindowLogs: null,
    currentWindowLatestSentAt: null,
    stopped: !preserveAction && step?.action === 'stop' ? true : !!userState.stopped,
    lastAction: preserveAction ? (userState.lastAction || null) : step?.action,
    lastSkipReason: step?.reason || step?.action,
    lastSkipAt: nowIso,
    pending: null,
    nextCheckAfter: null,
    nextScheduledAt: null,
    ...windowPayload,
    updatedAt: nowIso,
  };
}

export function buildRetargetingSentState(userState = {}, config = {}, step = {}, window = {}, sentAtIso = new Date().toISOString()) {
  const cycle = normalizeCycleNumber(step?.cycle);
  const stage = normalizeStageNumber(step?.stage);
  const sentStageObserveDays = getRetargetingStageObserveDays(config, cycle, stage);
  return {
    ...userState,
    activityId: config.activityId || userState.activityId,
    sentCount: (userState.sentCount || 0) + 1,
    cycleCount: Math.max(Number(userState.cycleCount || 0), cycle),
    currentCycle: cycle,
    currentWindowKey: window.windowKey,
    currentWindowLogs: window.windowLogs,
    currentWindowLatestSentAt: window.windowLatestSentAt,
    stageInCycle: stage,
    lastCycle: cycle,
    lastStage: stage,
    lastFlowType: step?.flowType,
    lastSentAt: sentAtIso,
    lastEngagementHandledForSentAt: null,
    observingUntil: daysAfterIso(sentAtIso, sentStageObserveDays),
    lastWindowKey: window.windowKey,
    completedWindowKey: null,
    pending: null,
    nextCheckAfter: null,
    nextScheduledAt: null,
    lastError: null,
    lastAction: 'sent',
    lastSkipReason: null,
    lastSkipAt: null,
    updatedAt: sentAtIso,
  };
}
