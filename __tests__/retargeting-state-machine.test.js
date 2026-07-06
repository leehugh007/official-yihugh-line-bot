import { describe, expect, it } from 'vitest';
import {
  buildRetargetingHaltState,
  buildRetargetingSentState,
  findInactiveLogWindows,
  getNextRetargetingStep,
  getRetargetingSkipLastWindowKey,
  isCompletedRetargetingWindow,
  selectRetargetingWindow,
  shouldSkipRetargetingDueToCooldown,
} from '../lib/retargeting-stage-timing.js';

function stagedConfig(overrides = {}) {
  return {
    activityId: 'activity_a',
    observeDays: 1,
    repeatStrategy: 'staged',
    cycleFlows: [{
      cycle: 1,
      enabled: true,
      finalAction: 'cooldown',
      stages: [
        { stage: 1, enabled: true, message: 'stage 1' },
        { stage: 2, enabled: true, message: 'stage 2' },
        { stage: 3, enabled: false, message: 'stage 3' },
      ],
    }],
    ...overrides,
  };
}

describe('retargeting state machine', () => {
  it('does not restart at stage 1 after a no-response cooldown', () => {
    const config = stagedConfig();
    const previousState = {
      sentCount: 2,
      cycleCount: 1,
      lastAction: 'cooldown',
      lastSkipReason: 'no_more_stage',
      lastSkipAt: '2026-06-28T00:30:00.000Z',
      lastWindowKey: '2',
      completedWindowKeys: ['2'],
      currentWindowKey: null,
      stageInCycle: 2,
    };

    expect(isCompletedRetargetingWindow(previousState, '3')).toBe(false);
    expect(shouldSkipRetargetingDueToCooldown(config, previousState, '3')).toBe(true);
    expect(getNextRetargetingStep(config, previousState, '3')).toMatchObject({
      action: 'cooldown',
      reason: 'repeat_cooldown_after_no_response',
    });
  });

  it('keeps requalification cycles progressing after an engaged previous window', () => {
    const config = stagedConfig({
      cycleFlows: [
        {
          cycle: 1,
          enabled: true,
          stages: [
            { stage: 1, enabled: true, message: 'cycle 1 stage 1' },
            { stage: 2, enabled: true, message: 'cycle 1 stage 2' },
          ],
        },
        {
          cycle: 2,
          enabled: true,
          stages: [
            { stage: 1, enabled: true, message: 'cycle 2 stage 1' },
            { stage: 2, enabled: true, message: 'cycle 2 stage 2' },
          ],
        },
      ],
    });
    const requalified = buildRetargetingSentState(
      {
        sentCount: 2,
        cycleCount: 1,
        lastAction: 'engaged',
        lastWindowKey: '3',
        completedWindowKeys: ['3'],
      },
      config,
      { cycle: 2, stage: 1, flowType: 'requalification' },
      { windowKey: '5', windowLogs: [{ step_number: 5 }], windowLatestSentAt: '2026-07-01T00:00:00.000Z' },
      '2026-07-02T00:00:00.000Z'
    );

    expect(requalified.lastAction).toBe('sent');
    expect(isCompletedRetargetingWindow(requalified, '5')).toBe(false);
    expect(getNextRetargetingStep(config, requalified, '5')).toMatchObject({
      action: 'send',
      cycle: 2,
      stage: 2,
      flowType: 'requalification',
    });
  });

  it('keeps the third qualification cycle on its own stage sequence', () => {
    const config = stagedConfig({
      cycleFlows: [
        {
          cycle: 1,
          enabled: true,
          stages: [
            { stage: 1, enabled: true, message: 'cycle 1 stage 1' },
          ],
        },
        {
          cycle: 2,
          enabled: true,
          stages: [
            { stage: 1, enabled: true, message: 'cycle 2 stage 1' },
          ],
        },
        {
          cycle: 3,
          enabled: true,
          stages: [
            { stage: 1, enabled: true, message: 'cycle 3 stage 1' },
            { stage: 2, enabled: true, message: 'cycle 3 stage 2' },
          ],
        },
      ],
    });
    const thirdCycleState = buildRetargetingSentState(
      {
        sentCount: 4,
        cycleCount: 2,
        lastAction: 'engaged',
        lastWindowKey: '6',
        completedWindowKeys: ['3', '6'],
      },
      config,
      { cycle: 3, stage: 1, flowType: 'requalification' },
      { windowKey: '8', windowLogs: [{ step_number: 8 }], windowLatestSentAt: '2026-07-08T00:00:00.000Z' },
      '2026-07-09T00:00:00.000Z'
    );

    expect(thirdCycleState.lastAction).toBe('sent');
    expect(isCompletedRetargetingWindow(thirdCycleState, '8')).toBe(false);
    expect(getNextRetargetingStep(config, thirdCycleState, '8')).toMatchObject({
      action: 'send',
      cycle: 3,
      stage: 2,
      flowType: 'requalification',
    });
  });

  it('does not complete a new window while waiting for check delay after cooldown', () => {
    const config = stagedConfig();
    const previousState = {
      sentCount: 2,
      cycleCount: 1,
      lastAction: 'cooldown',
      lastWindowKey: '2',
      completedWindowKeys: ['2'],
    };
    const waitingState = {
      ...previousState,
      windowKey: '3',
      windowLogs: [{ step_number: 3 }],
      lastSkipReason: 'waiting_check_delay',
      nextCheckAfter: '2026-06-29T00:00:00.000Z',
      lastWindowKey: getRetargetingSkipLastWindowKey(previousState, '3', 'waiting_check_delay'),
    };

    expect(waitingState.lastWindowKey).toBe('2');
    expect(isCompletedRetargetingWindow(waitingState, '3')).toBe(false);
    expect(shouldSkipRetargetingDueToCooldown(config, waitingState, '3')).toBe(true);
    expect(getNextRetargetingStep(config, waitingState, '3')).toMatchObject({
      action: 'cooldown',
      reason: 'repeat_cooldown_after_no_response',
    });
  });

  it('does not complete a scheduled new window when the pending send becomes due', () => {
    const config = stagedConfig({ sendMode: 'scheduled' });
    const previousState = {
      sentCount: 2,
      cycleCount: 1,
      lastAction: 'cooldown',
      lastWindowKey: '2',
      completedWindowKeys: ['2'],
      pending: {
        cycle: 1,
        stage: 1,
        windowKey: '3',
        scheduledAt: '2026-06-29T09:00:00.000Z',
      },
    };
    const pendingState = {
      ...previousState,
      lastSkipReason: 'pending_scheduled_send',
      nextScheduledAt: '2026-06-29T09:00:00.000Z',
      lastWindowKey: getRetargetingSkipLastWindowKey(previousState, '3', 'pending_scheduled_send'),
    };

    expect(pendingState.lastWindowKey).toBe('2');
    expect(isCompletedRetargetingWindow(pendingState, '3')).toBe(false);
    expect(shouldSkipRetargetingDueToCooldown(config, pendingState, '3')).toBe(true);
  });

  it('preserves requalification intent while a new window waits for check delay', () => {
    const config = stagedConfig({
      cycleFlows: [
        {
          cycle: 1,
          enabled: true,
          stages: [{ stage: 1, enabled: true, message: 'cycle 1 stage 1' }],
        },
        {
          cycle: 2,
          enabled: true,
          stages: [{ stage: 1, enabled: true, message: 'cycle 2 stage 1' }],
        },
      ],
    });
    const previousState = {
      sentCount: 1,
      cycleCount: 1,
      lastAction: 'engaged',
      lastWindowKey: '2',
      completedWindowKeys: ['2'],
    };
    const waitingState = {
      ...previousState,
      lastSkipReason: 'waiting_check_delay',
      nextCheckAfter: '2026-07-03T00:00:00.000Z',
      lastWindowKey: getRetargetingSkipLastWindowKey(previousState, '5', 'waiting_check_delay'),
    };

    expect(waitingState.lastWindowKey).toBe('2');
    expect(isCompletedRetargetingWindow(waitingState, '5')).toBe(false);
    expect(getNextRetargetingStep(config, waitingState, '5')).toMatchObject({
      action: 'send',
      cycle: 2,
      stage: 1,
      flowType: 'requalification',
    });
  });
});

describe('retargeting inactive windows (trailing streak only)', () => {
  const logsFor = (steps) => steps.map((step) => ({ step_number: step, sent_at: `2026-07-0${step}T00:00:00.000Z` }));

  it('does not resurface old gaps once the user has clicked later articles', () => {
    // 漏了 1、2，但 3-6 都有點：屬於已回流，不該再被「最近連續沒點」抓到
    const windows = findInactiveLogWindows(logsFor([1, 2, 3, 4, 5, 6]), 2, new Set([3, 4, 5, 6]));
    expect(windows).toEqual([]);
  });

  it('matches only the trailing consecutive unclicked streak', () => {
    // 點了 1-4，漏了 5、6：最新一段連續沒點 = 5-6
    const windows = findInactiveLogWindows(logsFor([1, 2, 3, 4, 5, 6]), 2, new Set([1, 2, 3, 4]));
    expect(windows.map((window) => window.windowKey)).toEqual(['5-6']);
  });

  it('keeps sub-windows inside the trailing streak so a running flow can continue', () => {
    // 漏了 4、5、6：window 4-5 進行到一半時，新文章 6 出現也不能打斷原本的 window
    const windows = findInactiveLogWindows(logsFor([1, 2, 3, 4, 5, 6]), 2, new Set([1, 2, 3]));
    expect(windows.map((window) => window.windowKey)).toEqual(['4-5', '5-6']);
    const selected = selectRetargetingWindow(windows, { currentWindowKey: '4-5', lastAction: 'sent' });
    expect(selected?.windowKey).toBe('4-5');
  });

  it('skips windows that are already completed', () => {
    const windows = findInactiveLogWindows(logsFor([1, 2, 3, 4, 5, 6]), 2, new Set([1, 2, 3]));
    const selected = selectRetargetingWindow(windows, {
      lastAction: 'engaged',
      lastWindowKey: '4-5',
      completedWindowKeys: ['4-5'],
    });
    expect(selected?.windowKey).toBe('5-6');
  });
});

describe('retargeting halt state', () => {
  const windowPayload = { windowKey: '7', windowLogs: [{ step_number: 7 }], windowLatestSentAt: '2026-07-07T00:00:00.000Z' };

  it('keeps engaged eligibility when the next cycle is not enabled yet', () => {
    // 有互動的會員遇到「第 2 次符合未啟用」：只跳過這個 window，資格保留，之後開啟第 2 次符合還進得來
    const halted = buildRetargetingHaltState(
      { lastAction: 'engaged', cycleCount: 1, sentCount: 2 },
      { activityId: 'activity_a' },
      { action: 'cooldown', reason: 'cycle_disabled', cycle: 2 },
      windowPayload,
      '2026-07-07T01:00:00.000Z'
    );

    expect(halted.lastAction).toBe('engaged');
    expect(halted.stopped).toBe(false);
    expect(halted.completedWindowKeys).toContain('7');
    expect(shouldSkipRetargetingDueToCooldown({ repeatStrategy: 'staged' }, halted, '8')).toBe(false);
    expect(getNextRetargetingStep(
      {
        repeatStrategy: 'staged',
        cycleFlows: [
          { cycle: 1, enabled: true, stages: [{ stage: 1, enabled: true, message: 'c1s1' }] },
          { cycle: 2, enabled: true, stages: [{ stage: 1, enabled: true, message: 'c2s1' }] },
        ],
      },
      halted,
      '8'
    )).toMatchObject({ action: 'send', cycle: 2, stage: 1 });
  });

  it('records terminal cooldown when a no-response flow runs out of stages', () => {
    const halted = buildRetargetingHaltState(
      { lastAction: 'sent', cycleCount: 1, stageInCycle: 2, currentWindowKey: '7' },
      { activityId: 'activity_a' },
      { action: 'cooldown', reason: 'no_more_stage', cycle: 1 },
      windowPayload,
      '2026-07-07T01:00:00.000Z'
    );

    expect(halted.lastAction).toBe('cooldown');
    expect(halted.currentWindowKey).toBeNull();
    expect(isCompletedRetargetingWindow(halted, '7')).toBe(true);
    expect(shouldSkipRetargetingDueToCooldown({ repeatStrategy: 'staged' }, halted, '8')).toBe(true);
  });

  it('marks stopped only for a real stop action', () => {
    const halted = buildRetargetingHaltState(
      { lastAction: 'sent' },
      { activityId: 'activity_a' },
      { action: 'stop', reason: 'no_more_stage', cycle: 1 },
      windowPayload,
      '2026-07-07T01:00:00.000Z'
    );
    expect(halted.stopped).toBe(true);
    expect(isCompletedRetargetingWindow(halted, 'anything')).toBe(true);
  });
});
