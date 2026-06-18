import { describe, expect, it } from 'vitest';
import {
  getRetargetingStageObserveDays,
  normalizeRetargetingObserveDays,
  shouldScheduleRetargetingStep,
} from '../lib/retargeting-stage-timing.js';

describe('retargeting stage timing', () => {
  it('每個階段可使用不同觀察天數', () => {
    const config = {
      observeDays: 9,
      cycleFlows: [{
        cycle: 1,
        stages: [
          { stage: 1, observeDays: 2 },
          { stage: 2, observeDays: 4 },
          { stage: 3, observeDays: 7 },
        ],
      }],
    };

    expect(getRetargetingStageObserveDays(config, 1, 1)).toBe(2);
    expect(getRetargetingStageObserveDays(config, 1, 2)).toBe(4);
    expect(getRetargetingStageObserveDays(config, 1, 3)).toBe(7);
  });

  it('舊活動沒有階段欄位時沿用原本 observeDays', () => {
    expect(getRetargetingStageObserveDays({ observeDays: 3 }, 1, 2)).toBe(3);
    expect(getRetargetingStageObserveDays({}, 1, 1)).toBe(1);
  });

  it('相容舊 stageTemplates 內已保存的階段觀察天數', () => {
    const config = {
      observeDays: 3,
      stageTemplates: [
        { stage: 1, observeDays: 2 },
        { stage: 2, observeDays: 5 },
      ],
    };
    expect(getRetargetingStageObserveDays(config, 1, 2)).toBe(5);
  });

  it('觀察天數至少為一天且只接受有效數字', () => {
    expect(normalizeRetargetingObserveDays(0, 5)).toBe(5);
    expect(normalizeRetargetingObserveDays('4', 1)).toBe(4);
    expect(normalizeRetargetingObserveDays('invalid', 2)).toBe(2);
  });

  it('排程等待只套用每一輪第 1 階段', () => {
    const config = { sendMode: 'scheduled' };
    expect(shouldScheduleRetargetingStep(config, { cycle: 1, stage: 1 })).toBe(true);
    expect(shouldScheduleRetargetingStep(config, { cycle: 2, stage: 1 })).toBe(true);
    expect(shouldScheduleRetargetingStep(config, { cycle: 1, stage: 2 })).toBe(false);
    expect(shouldScheduleRetargetingStep(config, { cycle: 1, stage: 3 })).toBe(false);
  });
});
