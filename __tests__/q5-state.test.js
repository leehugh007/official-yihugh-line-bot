// Q5 契約 v2.4 Ch.0.8：q5-state.js 單元測試（stateful queue mock）
//
// 跑法：npm test
//
// 為什麼用 queue mock（取代舊的 single-value _resolveTo）：
//   yi-challenge #6 洞 — 舊 mock 一個 resolve value 重複回，rollback 路徑跟主 UPDATE 的
//   resolve 會串在一起。rollback test 用 [push_failed_rollback, race_lost] 寬鬆斷言蒙混過
//   （實測發現 rollback 的第二次 UPDATE 沒被驗證到）。
//
//   新 mock：每個 supabase.from(...).update(...)... 的 await 會從 queue 頭彈一個 resolve。
//   兩次 call 可分別塞不同 resolve，+ 追蹤 update/eq 的 args，真的驗證 rollback 執行。
//
// 測試範圍：
//   performQ5Transition：
//     - invalid source
//     - DB error（主 UPDATE 就失敗）
//     - race_lost（UPDATE 回空陣列）
//     - 成功 passive
//     - 成功 active（含 q5_active_invite_sent_at）
//     - push 失敗 rollback — ✨ 驗證第二次 UPDATE 真的有 path_stage=4 + .eq('path_stage', 6) guard
//     - push 失敗 + rollback 也失敗（第二次 UPDATE 拋錯）
//   updateQ5Intent：
//     - invalid intent
//     - continue / decline / ai_failed 都 OK
//     - DB error
//
// 實測（非 mock）的 atomic race → 走 scripts/verify-q5-atomic.js（需真實 DB）

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Queue-based mock：每次 await chain 從 _queue 彈一個 resolve value
vi.mock('../lib/supabase.js', () => {
  const state = {
    queue: [],
    updateCalls: [],
    eqCalls: [],
    fromCalls: [],
    isCalls: [],
    selectCalls: [],
  };

  const chain = {
    from: vi.fn((table) => {
      state.fromCalls.push(table);
      return chain;
    }),
    update: vi.fn((values) => {
      state.updateCalls.push(values);
      return chain;
    }),
    eq: vi.fn((col, val) => {
      state.eqCalls.push({ col, val });
      return chain;
    }),
    is: vi.fn((col, val) => {
      state.isCalls.push({ col, val });
      return chain;
    }),
    select: vi.fn((cols) => {
      state.selectCalls.push(cols);
      return chain;
    }),
    then: (cb) => {
      const next = state.queue.shift();
      if (next === undefined) {
        // queue 空了 → 回 null data no error（防 test 寫錯塞不夠 resolve）
        return Promise.resolve({ data: null, error: null }).then(cb);
      }
      return Promise.resolve(next).then(cb);
    },
  };

  // 給 test 用的 helpers
  chain._state = state;
  chain._reset = () => {
    state.queue.length = 0;
    state.updateCalls.length = 0;
    state.eqCalls.length = 0;
    state.fromCalls.length = 0;
    state.isCalls.length = 0;
    state.selectCalls.length = 0;
  };
  chain._enqueue = (...items) => {
    state.queue.push(...items);
  };

  return { default: chain };
});

const supabase = (await import('../lib/supabase.js')).default;
const { performQ5Transition, updateQ5Intent, Q5_TRIGGER_SOURCES } = await import(
  '../lib/q5-state.js'
);

const USER = 'U51808e2cc195967eba53701518e6f547';

describe('Q5_TRIGGER_SOURCES', () => {
  it('只允許 passive 和 active', () => {
    expect(Q5_TRIGGER_SOURCES).toEqual(['passive', 'active']);
  });
});

describe('performQ5Transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase._reset();
  });

  it('invalid source → {ok:false, reason:invalid_source}，不打 DB', async () => {
    const pushFn = vi.fn(async () => true);
    const result = await performQ5Transition({
      userId: USER,
      source: 'somebody',
      pushFn,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_source' });
    expect(supabase._state.updateCalls).toHaveLength(0);
    expect(pushFn).not.toHaveBeenCalled();
  });

  it('主 UPDATE DB error → {ok:false, reason:db_error}，不 call pushFn', async () => {
    supabase._enqueue({ data: null, error: { message: 'connection lost' } });
    const pushFn = vi.fn(async () => true);
    const result = await performQ5Transition({
      userId: USER,
      source: 'passive',
      pushFn,
    });
    expect(result).toEqual({ ok: false, reason: 'db_error' });
    expect(pushFn).not.toHaveBeenCalled();
  });

  it('UPDATE 回空陣列 → race_lost，不 call pushFn', async () => {
    supabase._enqueue({ data: [], error: null });
    const pushFn = vi.fn(async () => true);
    const result = await performQ5Transition({
      userId: USER,
      source: 'passive',
      pushFn,
    });
    expect(result).toEqual({ ok: false, reason: 'race_lost' });
    expect(pushFn).not.toHaveBeenCalled();
  });

  it('passive 成功：UPDATE 寫 stage=6 + q5_sent_at + trigger，不寫 active_invite_sent_at', async () => {
    supabase._enqueue({ data: [{ line_user_id: USER, path_stage: 6 }], error: null });
    const pushFn = vi.fn(async () => true);
    const result = await performQ5Transition({
      userId: USER,
      source: 'passive',
      pushFn,
    });
    expect(result).toEqual({ ok: true });
    expect(supabase._state.updateCalls).toHaveLength(1);
    const [updateArgs] = supabase._state.updateCalls;
    expect(updateArgs.path_stage).toBe(6);
    expect(updateArgs.q5_followup_trigger_source).toBe('passive');
    expect(updateArgs.q5_sent_at).toBeTruthy();
    expect(updateArgs.path_stage_updated_at).toBeTruthy();
    expect(updateArgs.q5_active_invite_sent_at).toBeUndefined();
    expect(
      supabase._state.isCalls.some((c) => c.col === 'q5_sent_at' && c.val === null)
    ).toBe(true);
    expect(pushFn).toHaveBeenCalledWith(USER);
  });

  it('active 成功：額外寫 q5_active_invite_sent_at', async () => {
    supabase._enqueue({ data: [{ line_user_id: USER, path_stage: 6 }], error: null });
    const result = await performQ5Transition({
      userId: USER,
      source: 'active',
      pushFn: async () => true,
    });
    expect(result).toEqual({ ok: true });
    const [updateArgs] = supabase._state.updateCalls;
    expect(updateArgs.q5_followup_trigger_source).toBe('active');
    expect(updateArgs.q5_active_invite_sent_at).toBeTruthy();
  });

  // ✨ yi-challenge #6 補洞核心：驗證 rollback 真的執行 + guard 條件對
  it('push 失敗 → rollback UPDATE 寫 stage=4 + .eq(path_stage, 6) guard', async () => {
    // queue[0]：主 UPDATE 成功
    // queue[1]：rollback UPDATE 不回 error
    supabase._enqueue(
      { data: [{ line_user_id: USER, path_stage: 6 }], error: null },
      { data: null, error: null }
    );
    const pushFn = vi.fn(async () => false); // 推失敗

    const result = await performQ5Transition({
      userId: USER,
      source: 'passive',
      pushFn,
    });

    expect(result).toEqual({ ok: false, reason: 'push_failed_rollback' });
    expect(pushFn).toHaveBeenCalledTimes(1);

    // 驗證 2 次 UPDATE 都跑
    expect(supabase._state.updateCalls).toHaveLength(2);

    // 第 1 次：主 UPDATE（stage=6）
    expect(supabase._state.updateCalls[0].path_stage).toBe(6);
    expect(supabase._state.updateCalls[0].q5_sent_at).toBeTruthy();

    // 第 2 次：rollback UPDATE（stage=4，不清 q5_sent_at）
    // 契約 yi-challenge #1 洞決策：保留 q5_sent_at 防 cron 重推
    expect(supabase._state.updateCalls[1].path_stage).toBe(4);
    expect(supabase._state.updateCalls[1].path_stage_updated_at).toBeTruthy();
    expect(supabase._state.updateCalls[1]).not.toHaveProperty('q5_sent_at');
    expect(supabase._state.updateCalls[1]).not.toHaveProperty('q5_followup_trigger_source');

    // 驗證 rollback 用 .eq('path_stage', 6) guard（防 regress 已被別處改的 stage）
    const rollbackGuard = supabase._state.eqCalls.some(
      (c) => c.col === 'path_stage' && c.val === 6
    );
    expect(rollbackGuard).toBe(true);

    // 驗證兩次 UPDATE 都 .eq('line_user_id', USER)
    const userEqCount = supabase._state.eqCalls.filter(
      (c) => c.col === 'line_user_id' && c.val === USER
    ).length;
    expect(userEqCount).toBe(2);
  });

  it('push 失敗 + rollback 也失敗（DB 不通）→ 仍回 push_failed_rollback（不升級 reason）', async () => {
    supabase._enqueue(
      { data: [{ line_user_id: USER, path_stage: 6 }], error: null },
      { data: null, error: { message: 'rollback db error' } }
    );
    const result = await performQ5Transition({
      userId: USER,
      source: 'passive',
      pushFn: async () => false,
    });
    // 契約 Ch.0.8：rollback 失敗 → stage 卡 6 但 q5_sent_at 有值，靠 Ch.5.5 48h cron reset 兜底
    // 所以 reason 不變
    expect(result).toEqual({ ok: false, reason: 'push_failed_rollback' });
    expect(supabase._state.updateCalls).toHaveLength(2);
  });
});

describe('updateQ5Intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabase._reset();
  });

  it('invalid intent → {ok:false, error:invalid_intent}，不打 DB', async () => {
    const result = await updateQ5Intent(USER, 'maybe');
    expect(result).toEqual({ ok: false, error: 'invalid_intent' });
    expect(supabase._state.updateCalls).toHaveLength(0);
  });

  it('continue / decline / ai_failed 都 OK，且 UPDATE 寫 q5_intent + q5_classified_at', async () => {
    for (const intent of ['continue', 'decline', 'ai_failed']) {
      supabase._reset();
      supabase._enqueue({ data: null, error: null });
      const result = await updateQ5Intent(USER, intent);
      expect(result).toEqual({ ok: true });
      expect(supabase._state.updateCalls).toHaveLength(1);
      expect(supabase._state.updateCalls[0].q5_intent).toBe(intent);
      expect(supabase._state.updateCalls[0].q5_classified_at).toBeTruthy();
    }
  });

  it('DB error → {ok:false, error:<msg>}', async () => {
    supabase._enqueue({ data: null, error: { message: 'write denied' } });
    const result = await updateQ5Intent(USER, 'continue');
    expect(result).toEqual({ ok: false, error: 'write denied' });
  });
});
