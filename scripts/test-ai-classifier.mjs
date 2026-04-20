// Phase 3.2a+b 單元測試：ai-classifier + handoff 純函式
// 跑法：node scripts/test-ai-classifier.mjs
// 不打真實 Gemini API / 不連 DB（所有 getSettingTyped 在被測函式內不呼叫）

let results = { passed: 0, failed: 0, skipped: 0 };
function ok(name) {
  console.log(`✅ ${name}`);
  results.passed += 1;
}
function fail(name, detail) {
  console.log(`❌ ${name}: ${detail}`);
  results.failed += 1;
}
function assert(cond, name, detail) {
  if (cond) ok(name);
  else fail(name, detail);
}

// ==================================================================
// Part 1: validateAiOutput 純函式
// ==================================================================
const { validateAiOutput, getValidConditions } = await import('../lib/ai-classifier.js');

// Case 1: null / undefined output
{
  const r = validateAiOutput(3, 'rebound', null);
  assert(!r.ok && r.reason === 'output_not_object', 'Case 1: null 輸入被 reject');
}

// Case 2: 陣列輸入（不是物件）
{
  const r = validateAiOutput(3, 'rebound', ['oops']);
  assert(!r.ok && r.reason === 'output_not_object', 'Case 2: array 輸入被 reject');
}

// Case 3: 缺 confidence
{
  const r = validateAiOutput(3, 'rebound', { conditions: ['stopped'] });
  assert(!r.ok && r.reason === 'missing_confidence', 'Case 3: 缺 confidence');
}

// Case 4: 非法 confidence 值
{
  const r = validateAiOutput(3, 'rebound', { confidence: 'super' });
  assert(
    !r.ok && r.reason?.startsWith('invalid_confidence'),
    'Case 4: invalid confidence enum 被 reject',
    r.reason
  );
}

// Case 5: 合法 conditions + 完整 ai_tags
{
  const r = validateAiOutput(3, 'rebound', {
    conditions: ['stopped', 'stress'],
    ai_tags: {
      pain_points: ['之前停藥就胖回來'],
      hesitations: ['怕再復胖'],
      intent: 'medium',
      attentions: [],
    },
    confidence: 'high',
  });
  assert(r.ok && !r.fallback, 'Case 5: 合法完整輸入 ok + 不 fallback');
}

// Case 6: 非法 condition 值（不在 rebound 清單）
{
  const r = validateAiOutput(3, 'rebound', {
    conditions: ['blood_sugar'], // blood_sugar 只存在於 healthCheck
    confidence: 'high',
  });
  assert(
    !r.ok && r.reason?.startsWith('invalid_conditions_blood_sugar'),
    'Case 6: condition 不屬於該 path 被 reject',
    r.reason
  );
}

// Case 7: conditions 字串 coerce 成陣列
{
  const r = validateAiOutput(3, 'rebound', {
    conditions: 'stopped',
    confidence: 'high',
  });
  assert(
    r.ok && Array.isArray(r.output.conditions) && r.output.conditions[0] === 'stopped',
    'Case 7: conditions 字串 coerce 成陣列',
    JSON.stringify(r.output?.conditions)
  );
}

// Case 8: ai_tags 陣列混 string + {value:'...'}
{
  const r = validateAiOutput(3, 'rebound', {
    conditions: ['stopped'],
    ai_tags: {
      pain_points: ['純字串', { value: 'object 形式' }, { nope: 'no value' }, null],
    },
    confidence: 'medium',
  });
  const pts = r.output.ai_tags.pain_points;
  assert(
    r.ok && pts.length === 2 && pts.includes('純字串') && pts.includes('object 形式'),
    'Case 8: ai_tags 陣列混合格式正規化',
    JSON.stringify(pts)
  );
}

// Case 9: intent 非法值降級 medium
{
  const r = validateAiOutput(3, 'rebound', {
    conditions: ['stopped'],
    ai_tags: { intent: 'super_high' },
    confidence: 'high',
  });
  assert(
    r.ok && r.output.ai_tags.intent === 'medium',
    'Case 9: 非法 intent 降級為 medium',
    r.output.ai_tags?.intent
  );
}

// Case 10: confidence=low → fallback=true
{
  const r = validateAiOutput(3, 'postpartum', {
    conditions: ['time'],
    confidence: 'low',
  });
  assert(r.ok && r.fallback === true, 'Case 10: confidence=low 標 fallback');
}

// Case 11: ai_tags 是陣列（非法）→ 整包清空
{
  const r = validateAiOutput(3, 'rebound', {
    conditions: ['stopped'],
    ai_tags: ['wrong'],
    confidence: 'high',
  });
  assert(
    r.ok && typeof r.output.ai_tags === 'object' && Object.keys(r.output.ai_tags).length === 0,
    'Case 11: ai_tags 是陣列 → 清空不 crash',
    JSON.stringify(r.output.ai_tags)
  );
}

// Case 12: getValidConditions 各 path
{
  const hc = getValidConditions(3, 'healthCheck');
  const rb = getValidConditions(3, 'rebound');
  const pp = getValidConditions(3, 'postpartum');
  const eat = getValidConditions(3, 'eatOut');
  assert(hc.includes('on_meds') && hc.length === 5, 'Case 12a: healthCheck 有 5 個 condition');
  assert(rb.includes('menopause_or_age') && rb.length === 4, 'Case 12b: rebound 有 4 個');
  assert(pp.includes('breastfeeding') && pp.length === 3, 'Case 12c: postpartum 有 3 個');
  assert(eat.length === 0, 'Case 12d: eatOut 走 DYNAMIC 無 condition');
}

// Case 13: ai_tags 字段型別混亂不 crash
{
  const r = validateAiOutput(3, 'rebound', {
    conditions: ['stopped'],
    ai_tags: {
      pain_points: 'should be array',
      hesitations: { not: 'array' },
      attentions: null,
    },
    confidence: 'high',
  });
  assert(r.ok, 'Case 13: ai_tags 欄位型別混亂被 coerce 不 crash');
  assert(
    Array.isArray(r.output.ai_tags.pain_points) && r.output.ai_tags.pain_points[0] === 'should be array',
    'Case 13a: 字串被 wrap 成 [字串]',
    JSON.stringify(r.output.ai_tags.pain_points)
  );
  assert(
    Array.isArray(r.output.ai_tags.hesitations) && r.output.ai_tags.hesitations.length === 0,
    'Case 13b: 物件（非陣列）被清成 []',
    JSON.stringify(r.output.ai_tags.hesitations)
  );
}

// ==================================================================
// Part 2: Code Gate E2 純函式（isMostlyNonTextual 複刻 webhook 內定義）
// ==================================================================
function isMostlyNonTextual(text) {
  const real = text.replace(/\s/g, '');
  if (real.length === 0) return true;
  const textual = real.match(/[\u4e00-\u9fa5A-Za-z0-9]/g) || [];
  return textual.length / real.length < 0.3;
}

// Case 14: 純 emoji
{
  assert(isMostlyNonTextual('😊😊😊'), 'Case 14: 純 emoji 判純符號');
}
// Case 15: 正常中文句
{
  assert(!isMostlyNonTextual('我已經吃藥三年了'), 'Case 15: 中文句判有文字');
}
// Case 16: 短中文 + emoji
{
  assert(!isMostlyNonTextual('好🎉'), 'Case 16: 中文+emoji 仍算有文字');
}
// Case 17: 純標點
{
  assert(isMostlyNonTextual('。。。！！'), 'Case 17: 純標點判純符號');
}
// Case 18: 全英數
{
  assert(!isMostlyNonTextual('OK'), 'Case 18: 全英數判有文字');
}

// ==================================================================
// Part 3: handoff matchGlobalHandoff / matchPoliteEnd
// 這兩個會呼 getSettingTyped → DB。用 mock 技巧測優先序 + 關鍵字邊界
// ==================================================================

// Case 19: 關鍵字優先序（want_enroll > asked_price > asked_family）— 模擬邏輯
{
  // 手動 mock 一個 matchGlobalHandoff 版本測優先序邏輯
  const enroll = ['我要報', '直接買'];
  const price = ['價格', '報名', '方案'];
  const family = ['老公', '家人'];
  function mockMatch(text) {
    if (!text) return null;
    if (enroll.some((kw) => text.includes(kw))) return 'want_enroll';
    if (price.some((kw) => text.includes(kw))) return 'asked_price';
    if (family.some((kw) => text.includes(kw))) return 'asked_family';
    return null;
  }
  // 兩者都命中時 enroll 先贏
  assert(mockMatch('我要報名') === 'want_enroll', 'Case 19a: 兩詞命中 enroll > price');
  assert(mockMatch('老公會不會覺得貴價格') === 'asked_price', 'Case 19b: price > family');
  assert(mockMatch('老公不同意') === 'asked_family', 'Case 19c: 只 family 命中');
  assert(mockMatch('今天天氣好') === null, 'Case 19d: 無命中 → null');
}

// Case 20: ai_polite_end_keywords 邏輯
{
  const kws = ['太貴', '沒預算', '沒錢', '先不用'];
  function mockPolite(text) {
    if (!text) return false;
    return kws.some((kw) => text.includes(kw));
  }
  assert(mockPolite('太貴了我先不用'), 'Case 20a: 包含「太貴」命中');
  assert(mockPolite('可能沒預算'), 'Case 20b: 包含「沒預算」命中');
  assert(!mockPolite('太好了'), 'Case 20c: 「太好了」不命中「太貴」');
  assert(!mockPolite(''), 'Case 20d: 空字串不命中');
}

// ==================================================================
// Result
// ==================================================================
console.log('');
console.log(`===== ${results.passed} passed / ${results.failed} failed / ${results.skipped} skipped =====`);
process.exit(results.failed > 0 ? 1 : 0);
