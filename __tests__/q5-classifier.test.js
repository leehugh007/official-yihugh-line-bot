// Q5 契約 v2.4 Ch.3.1：q5-classifier.js 單元測試
//
// 跑法：npm test
//
// 測試範圍：
//   classifyQ5Intent：
//     - missing input（空字串 / null / 非 string） → ai_failed
//     - 5 gemini error path（timeout / api_xxx / no_text / no_key / json_parse）→ ai_failed
//     - validator reject（output 非 object / intent 非 continue|decline）→ ai_failed
//     - validator 降級（confidence 不在 enum → medium, reason 非 string → ''）→ 仍 ok
//     - success continue / decline
//   __test.buildQ5IntentPrompt：含用戶訊息 + intent/confidence/reason 欄位
//   __test.validateQ5Intent：純函式邊界

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock callGemini (from ai-classifier.js) + getSettingTyped (from official-settings.js)
vi.mock('../lib/ai-classifier.js', () => ({
  callGemini: vi.fn(),
}));

vi.mock('../lib/official-settings.js', () => ({
  getSettingTyped: vi.fn(async (key) => {
    if (key === 'gemini_model_version') return 'gemini-2.5-flash-lite';
    if (key === 'ai_call_timeout_ms') return 10000;
    return null;
  }),
}));

const { callGemini } = await import('../lib/ai-classifier.js');
const { classifyQ5Intent, __test } = await import('../lib/q5-classifier.js');

describe('classifyQ5Intent — input validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('userText 空字串 → ai_failed，不打 AI', async () => {
    const r = await classifyQ5Intent({ userText: '' });
    expect(r.intent).toBe('ai_failed');
    expect(r.fallback).toBe(true);
    expect(r.error).toBe('missing_input');
    expect(callGemini).not.toHaveBeenCalled();
  });

  it('userText 純空白 → ai_failed，不打 AI', async () => {
    const r = await classifyQ5Intent({ userText: '   \n  ' });
    expect(r.intent).toBe('ai_failed');
    expect(r.error).toBe('missing_input');
    expect(callGemini).not.toHaveBeenCalled();
  });

  it('userText undefined → ai_failed', async () => {
    const r = await classifyQ5Intent({});
    expect(r.intent).toBe('ai_failed');
    expect(r.error).toBe('missing_input');
    expect(callGemini).not.toHaveBeenCalled();
  });

  it('userText null → ai_failed', async () => {
    const r = await classifyQ5Intent({ userText: null });
    expect(r.intent).toBe('ai_failed');
    expect(r.error).toBe('missing_input');
    expect(callGemini).not.toHaveBeenCalled();
  });

  it('userText 非 string → ai_failed', async () => {
    const r = await classifyQ5Intent({ userText: 123 });
    expect(r.intent).toBe('ai_failed');
    expect(r.error).toBe('missing_input');
    expect(callGemini).not.toHaveBeenCalled();
  });
});

describe('classifyQ5Intent — 5 gemini error paths (all → ai_failed)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gemini_timeout → ai_failed', async () => {
    callGemini.mockRejectedValueOnce(new Error('gemini_timeout'));
    const r = await classifyQ5Intent({ userText: '好' });
    expect(r.intent).toBe('ai_failed');
    expect(r.fallback).toBe(true);
    expect(r.error).toBe('gemini_timeout');
  });

  it('gemini_api_429 → ai_failed', async () => {
    callGemini.mockRejectedValueOnce(new Error('gemini_api_429: rate limit'));
    const r = await classifyQ5Intent({ userText: '好' });
    expect(r.intent).toBe('ai_failed');
    expect(r.error).toMatch(/^gemini_api_429/);
  });

  it('gemini_no_text → ai_failed', async () => {
    callGemini.mockRejectedValueOnce(new Error('gemini_no_text'));
    const r = await classifyQ5Intent({ userText: '好' });
    expect(r.intent).toBe('ai_failed');
    expect(r.error).toBe('gemini_no_text');
  });

  it('gemini_no_key → ai_failed + console.error CRITICAL', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    callGemini.mockRejectedValueOnce(new Error('gemini_no_key'));
    const r = await classifyQ5Intent({ userText: '好' });
    expect(r.intent).toBe('ai_failed');
    expect(r.error).toBe('gemini_no_key');
    // 契約 Ch.3.1：gemini_no_key 必須額外告警
    const criticalLog = errSpy.mock.calls.find((c) =>
      String(c[0] || '').includes('CRITICAL')
    );
    expect(criticalLog).toBeTruthy();
    errSpy.mockRestore();
  });

  it('gemini_json_parse → ai_failed', async () => {
    callGemini.mockRejectedValueOnce(new Error('gemini_json_parse: unexpected token'));
    const r = await classifyQ5Intent({ userText: '好' });
    expect(r.intent).toBe('ai_failed');
    expect(r.error).toMatch(/^gemini_json_parse/);
  });

  it('generic error（無 message）→ ai_failed + gemini_unknown_error', async () => {
    callGemini.mockRejectedValueOnce({}); // 非 Error instance、沒 message
    const r = await classifyQ5Intent({ userText: '好' });
    expect(r.intent).toBe('ai_failed');
    expect(r.error).toBe('gemini_unknown_error');
  });
});

describe('classifyQ5Intent — validator reject paths (→ ai_failed)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('output 非 object（string）→ ai_failed', async () => {
    callGemini.mockResolvedValueOnce('not an object');
    const r = await classifyQ5Intent({ userText: '好' });
    expect(r.intent).toBe('ai_failed');
    expect(r.error).toBe('output_not_object');
  });

  it('output 是 array → ai_failed', async () => {
    callGemini.mockResolvedValueOnce([]);
    const r = await classifyQ5Intent({ userText: '好' });
    expect(r.intent).toBe('ai_failed');
    expect(r.error).toBe('output_not_object');
  });

  it('output 是 null → ai_failed', async () => {
    callGemini.mockResolvedValueOnce(null);
    const r = await classifyQ5Intent({ userText: '好' });
    expect(r.intent).toBe('ai_failed');
    expect(r.error).toBe('output_not_object');
  });

  it('intent 非 continue|decline → ai_failed', async () => {
    callGemini.mockResolvedValueOnce({
      intent: 'maybe',
      confidence: 'high',
      reason: 'not sure',
    });
    const r = await classifyQ5Intent({ userText: '好' });
    expect(r.intent).toBe('ai_failed');
    expect(r.error).toMatch(/^invalid_intent/);
  });

  it('intent 缺失 → ai_failed', async () => {
    callGemini.mockResolvedValueOnce({
      confidence: 'high',
      reason: 'missing intent',
    });
    const r = await classifyQ5Intent({ userText: '好' });
    expect(r.intent).toBe('ai_failed');
  });
});

describe('classifyQ5Intent — validator downgrade (仍 ok)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confidence 非 enum → 降成 medium（不 reject）', async () => {
    callGemini.mockResolvedValueOnce({
      intent: 'continue',
      confidence: 'super_high',
      reason: '用戶想聽',
    });
    const r = await classifyQ5Intent({ userText: '好' });
    expect(r.intent).toBe('continue');
    expect(r.confidence).toBe('medium');
    expect(r.fallback).toBe(false);
  });

  it('reason 非 string → 補空字串（不 reject）', async () => {
    callGemini.mockResolvedValueOnce({
      intent: 'decline',
      confidence: 'high',
      reason: 42,
    });
    const r = await classifyQ5Intent({ userText: '不用' });
    expect(r.intent).toBe('decline');
    expect(r.reason).toBe('');
    expect(r.fallback).toBe(false);
  });
});

describe('classifyQ5Intent — success paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('continue + high + 合法 reason → fallback=false', async () => {
    callGemini.mockResolvedValueOnce({
      intent: 'continue',
      confidence: 'high',
      reason: '用戶說好，明顯想繼續',
    });
    const r = await classifyQ5Intent({ userText: '好 想聽聽' });
    expect(r.intent).toBe('continue');
    expect(r.confidence).toBe('high');
    expect(r.reason).toBe('用戶說好，明顯想繼續');
    expect(r.fallback).toBe(false);
    expect(r.error).toBeUndefined();
  });

  it('decline + medium → fallback=false', async () => {
    callGemini.mockResolvedValueOnce({
      intent: 'decline',
      confidence: 'medium',
      reason: '客氣拒絕',
    });
    const r = await classifyQ5Intent({ userText: '謝謝不用了' });
    expect(r.intent).toBe('decline');
    expect(r.confidence).toBe('medium');
    expect(r.fallback).toBe(false);
  });
});

describe('__test.buildQ5IntentPrompt', () => {
  it('包含用戶訊息', () => {
    const p = __test.buildQ5IntentPrompt({ userText: '我想了解更多' });
    expect(p).toContain('「我想了解更多」');
  });

  it('提示 continue / decline 兩選項', () => {
    const p = __test.buildQ5IntentPrompt({ userText: 'x' });
    expect(p).toContain('continue');
    expect(p).toContain('decline');
  });

  it('要求 JSON 輸出 intent/confidence/reason', () => {
    const p = __test.buildQ5IntentPrompt({ userText: 'x' });
    expect(p).toContain('intent');
    expect(p).toContain('confidence');
    expect(p).toContain('reason');
  });

  it('禁止 markdown / 中文 key（防 JSON parse 失敗）', () => {
    const p = __test.buildQ5IntentPrompt({ userText: 'x' });
    expect(p).toContain('嚴禁');
  });
});

describe('__test.validateQ5Intent', () => {
  it('合法輸出 → ok:true', () => {
    const r = __test.validateQ5Intent({
      intent: 'continue',
      confidence: 'high',
      reason: 'ok',
    });
    expect(r.ok).toBe(true);
    expect(r.output.intent).toBe('continue');
  });

  it('output undefined → ok:false', () => {
    const r = __test.validateQ5Intent(undefined);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('output_not_object');
  });

  it('intent invalid → ok:false', () => {
    const r = __test.validateQ5Intent({ intent: 'x', confidence: 'high', reason: '' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/^invalid_intent/);
  });

  it('confidence 不在 enum → 降成 medium, ok:true', () => {
    const r = __test.validateQ5Intent({
      intent: 'continue',
      confidence: 'xxx',
      reason: 'ok',
    });
    expect(r.ok).toBe(true);
    expect(r.output.confidence).toBe('medium');
  });

  it('reason 非 string → 補空字串，ok:true', () => {
    const r = __test.validateQ5Intent({
      intent: 'continue',
      confidence: 'high',
      reason: null,
    });
    expect(r.ok).toBe(true);
    expect(r.output.reason).toBe('');
  });
});
