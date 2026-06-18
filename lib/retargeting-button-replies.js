export const RETARGETING_ACTIVITY_LIBRARY_KEY = 'retargeting_activity_library';
export const RETARGETING_PRIMARY_CONFIG_KEY = 'retargeting_admin_auto_config';

export function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeText(value) {
  return String(value || '').trim();
}

function isMessageReplyButton(button = {}) {
  return button.actionType === 'message' || (!button.url && (button.replyText || button.messageText));
}

export function findReplyInButtons(buttons = [], text) {
  const normalizedText = normalizeText(text);
  if (!normalizedText || !Array.isArray(buttons)) return null;

  for (const button of buttons) {
    if (!isMessageReplyButton(button) || !normalizeText(button.replyText)) continue;
    const triggerText = normalizeText(button.messageText || button.label);
    if (triggerText && normalizedText === triggerText) {
      return button.replyText;
    }
  }

  return null;
}

export function collectRetargetingTemplates(config = {}) {
  if (!config || typeof config !== 'object') return [];
  const templates = [];
  const seen = new Set();
  const addTemplate = (template) => {
    if (!template || template.enabled === false) return;
    const key = [
      template.templateId || template.id || '',
      template.cycle || '',
      template.stage || '',
      normalizeText(template.title),
      normalizeText(template.message || template.body),
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    templates.push(template);
  };

  if (Array.isArray(config.cycleFlows) && config.cycleFlows.length > 0) {
    for (const flow of config.cycleFlows) {
      if (flow?.enabled === false) continue;
      for (const stage of flow?.stages || []) {
        addTemplate(stage);
      }
    }
  }

  for (const template of config.stageTemplates || []) {
    addTemplate(template);
  }

  return templates;
}

export function findReplyInRetargetingConfig(config, text) {
  for (const template of collectRetargetingTemplates(config)) {
    const reply = findReplyInButtons(template.buttons, text);
    if (reply) return reply;
  }
  return null;
}

export function parseRetargetingSettings(rows = []) {
  const map = Object.fromEntries((rows || []).map((row) => [row.key, row.value]));
  const activityLibrary = safeJsonParse(map[RETARGETING_ACTIVITY_LIBRARY_KEY], []);
  const primaryConfig = safeJsonParse(map[RETARGETING_PRIMARY_CONFIG_KEY], null);
  const activities = (Array.isArray(activityLibrary) ? activityLibrary : [])
    .filter((activity) => activity && activity.enabled !== false && activity.active !== false)
    .sort((a, b) => {
      const priorityDiff = Number(a.priority || 999) - Number(b.priority || 999);
      if (priorityDiff !== 0) return priorityDiff;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });

  return { activities, primaryConfig };
}

export function findReplyInPushLogs(logs = [], text) {
  for (const log of logs || []) {
    const reply = findReplyInButtons(log?.buttons, text);
    if (reply) return reply;
  }
  return null;
}

export function findRetargetingButtonReply(text, {
  userLogs = [],
  generalLogs = [],
  activities = [],
  primaryConfig = null,
} = {}) {
  const userLogReply = findReplyInPushLogs(userLogs, text);
  if (userLogReply) return userLogReply;

  const generalLogReply = findReplyInPushLogs(generalLogs, text);
  if (generalLogReply) return generalLogReply;

  for (const activity of activities || []) {
    const reply = findReplyInRetargetingConfig(activity, text);
    if (reply) return reply;
  }

  return findReplyInRetargetingConfig(primaryConfig, text);
}
