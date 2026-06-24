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
