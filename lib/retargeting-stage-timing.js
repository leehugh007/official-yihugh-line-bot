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
