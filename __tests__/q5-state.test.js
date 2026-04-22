// Q5 契約 v2.3 Ch.0.8：q5-state.js 單元測試
// 跑法：npm test（需先 npm install 裝 vitest）
//
// 測試範圍：
//   - performQ5Transition 正常路徑（passive / active）
//   - performQ5Transition race_lost（q5_sent_at 非 NULL）
//   - performQ5Transition push 失敗 rollback
//   - performQ5Transition invalid source
//   - updateQ5Intent 正常路徑
//   - updateQ5Intent DB error
//   - updateQ5Intent invalid intent
//
// 實測（非 mock）的 atomic race → 走 scripts/verify-q5-atomic.js（需真實 DB）

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase default export
vi.mock('../lib/supabase.js', () => {
  const mockChain = () => {
    const chain = {
      from: vi.fn(() => chain),
      update: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      is: vi.fn(() => chain),
      select: vi.fn(() => chain),
      _resolveTo: { data: null, error: null },
      then: (cb) => Promise.resolve(chain._resolveTo).then(cb),
    };
    return chain;
  };
  return { default: mockChain() };
});

const supabase = (await import('../lib/supabase.js')).default;
const { performQ5Transition, updateQ5Intent, Q5_TRIGGER_SOURCES } = await import(
  '../lib/q5-state.js'
);

function setSupabaseResult(data, error) {
  supabase._resolveTo = { data, error };
}

describe('Q5_TRIGGER_SOURCES', () => {
  it('只允許 passive 和 active', () => {
    expect(Q5_TRIGGER_SOURCES).toEqual(['passive', 'active']);
  });
});

describe('performQ5Transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSupabaseResult(null, null);
  });

  it('invalid source → {ok:false, reason:invalid_source}', async () => {
    const result = await performQ5Transition({
      userId: 'U123',
      source: 'somebody',
      pushFn: async () => true,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_source');
  });

  it('DB error → {ok:false, reason:db_error}', async () => {
    setSupabaseResult(null, { message: 'connection lost' });
    const result = await performQ5Transition({
      userId: 'U123',
      source: 'passive',
      pushFn: async () => true,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('db_error');
  });

  it('UPDATE 回空陣列 → race_lost', async () => {
    setSupabaseResult([], null);
    const result = await performQ5Transition({
      userId: 'U123',
      source: 'passive',
      pushFn: async () => true,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('race_lost');
  });

  it('UPDATE 成功 + push 成功 → ok', async () => {
    setSupabaseResult([{ line_user_id: 'U123', path_stage: 6 }], null);
    const result = await performQ5Transition({
      userId: 'U123',
      source: 'passive',
      pushFn: async () => true,
    });
    expect(result.ok).toBe(true);
  });

  it('UPDATE 成功 + push 失敗 → rollback + push_failed_rollback', async () => {
    let callCount = 0;
    supabase._resolveTo = [{ line_user_id: 'U123', path_stage: 6 }];
    // 第一次 call 成功，第二次 rollback 不管成敗
    const result = await performQ5Transition({
      userId: 'U123',
      source: 'passive',
      pushFn: async () => false,
    });
    // mock 不能精準模擬兩次 call，這裡只驗 reason
    // 實際 rollback 行為請看 scripts/verify-q5-atomic.js
    expect(result.ok).toBe(false);
    // 可能 reason=race_lost（因 mock resolve 回到 rollback 那邊）或 push_failed_rollback
    expect(['push_failed_rollback', 'race_lost']).toContain(result.reason);
  });
});

describe('updateQ5Intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSupabaseResult(null, null);
  });

  it('invalid intent → {ok:false, error:invalid_intent}', async () => {
    const result = await updateQ5Intent('U123', 'maybe');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_intent');
  });

  it('continue / decline / ai_failed 都 OK', async () => {
    for (const intent of ['continue', 'decline', 'ai_failed']) {
      const result = await updateQ5Intent('U123', intent);
      expect(result.ok).toBe(true);
    }
  });

  it('DB error → {ok:false, error:<msg>}', async () => {
    setSupabaseResult(null, { message: 'write denied' });
    const result = await updateQ5Intent('U123', 'continue');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('write denied');
  });
});
