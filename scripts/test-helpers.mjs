// 契約 v6 第 10.1 章末：Phase 2b helpers 驗收腳本
// 跑法：node scripts/test-helpers.mjs
// 依賴：.env.local（SUPABASE_URL / SUPABASE_KEY），本地跑需 npm i -D dotenv
//
// v6 採 dynamic import 方案（不改 package.json）避免 Next.js 14 相容問題

// 載入 .env.local（Vercel 不需這段，本地需要）
try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
  dotenv.config({ path: '.env' });
} catch (e) {
  console.warn('⚠️  dotenv 未安裝。若需連 DB 跑 case 4/5，請 `npm i -D dotenv`');
}

let results = { passed: 0, failed: 0, skipped: 0 };
function ok(name) {
  console.log(`✅ ${name}`);
  results.passed += 1;
}
function fail(name, detail) {
  console.log(`❌ ${name}: ${detail}`);
  results.failed += 1;
}
function skip(name, reason) {
  console.log(`⏭️  ${name} (skipped: ${reason})`);
  results.skipped += 1;
}
function assert(cond, name, detail) {
  if (cond) ok(name);
  else fail(name, detail);
}

// ----------------------------------------------------------------
// Case 1-3：mergeByOp 純函式測試（不需 DB）
// ----------------------------------------------------------------
const { mergeByOp } = await import('../lib/users.js');

// Case 1: string[] coerce 成 object[]，帶 recorded_at
{
  const name = 'Case 1: mergeByOp string[] coerce → {value, recorded_at}';
  const r = mergeByOp({}, { 痛點: ['血糖紅'], _op: 'append' });
  const first = r.痛點?.[0];
  assert(
    first?.value === '血糖紅' && typeof first.recorded_at === 'string',
    name,
    JSON.stringify(r.痛點)
  );
}

// Case 2: append 去重 by value
{
  const name = 'Case 2: mergeByOp append 去重';
  const r = mergeByOp(
    { 痛點: [{ value: '血糖紅', recorded_at: '2026-04-01' }] },
    { 痛點: ['血糖紅'], _op: 'append' }
  );
  assert(r.痛點.length === 1, name, `expected 1, got ${r.痛點.length}`);
}

// Case 3: 白名單外的 key 靜默忽略（防 AI 幻覺）
{
  const name = 'Case 3: mergeByOp 白名單 gate（擋 AI 幻覺 weight/mood）';
  const r = mergeByOp({}, { 痛點: ['X'], weight: 80, mood: 'happy', _op: 'append' });
  assert(
    !('weight' in r) && !('mood' in r) && r.痛點?.length === 1,
    name,
    JSON.stringify(r)
  );
}

// ----------------------------------------------------------------
// Case 3.5：renderTemplate smoke（契約 10.2 章末「code 驗證」）
// 抽 5 條 non-dynamic 模板，確認 render 不 throw
// ----------------------------------------------------------------
{
  const { renderTemplate } = await import('../lib/templates.js');
  const fakeUser = { current_weight: 75, target_weight: 65 }; // diff=10
  const samples = [
    { id: 'q1_init', message_template: '破冰文字' },
    { id: 'q2_weight_small', message_template: '{diff} 公斤不算多' },
    { id: 'q2_weight_medium', message_template: '想瘦 {diff} 公斤' },
    { id: 'path_c_outro', message_template: '看完有感覺再回來跟我說' },
    { id: 'path_e_drug', message_template: '吃過什麼？停了多久？' },
  ];
  try {
    for (const t of samples) await renderTemplate(t, fakeUser);
    ok('Case 3.5: renderTemplate 5 條 non-dynamic smoke 無 throw');
  } catch (e) {
    fail('Case 3.5: renderTemplate smoke', e.message);
  }
  // DYNAMIC 模板必須帶 aiOutput
  try {
    const { renderTemplate } = await import('../lib/templates.js');
    await renderTemplate({ id: 'path_d_ai_meal_feedback', message_template: 'prompt骨架' }, fakeUser);
    fail('Case 3.6: DYNAMIC 應該 throw', '沒 throw');
  } catch (e) {
    if (String(e.message).includes('missing aiOutput')) {
      ok('Case 3.6: DYNAMIC 無 aiOutput 正確 throw');
    } else {
      fail('Case 3.6: DYNAMIC throw msg 不對', e.message);
    }
  }
}

// ----------------------------------------------------------------
// Case 4-6：連 DB，用 TEST_USER_ID 寫 → 讀 → 清
// ----------------------------------------------------------------
const hasSupabaseEnv = !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);

if (!hasSupabaseEnv) {
  skip('Case 4-6: DB 連線測試', '未讀到 SUPABASE_URL / SUPABASE_KEY');
} else {
  const TEST_USER_ID = `TEST_HELPERS_${Date.now()}`;
  const { updateAiTags, updatePathStage, getUserPathState } = await import(
    '../lib/users.js'
  );
  const { default: supabase } = await import('../lib/supabase.js');

  // 先建測試用戶（滿足 line_user_id PK）
  try {
    await supabase.from('official_line_users').insert({
      line_user_id: TEST_USER_ID,
      display_name: '[TEST HELPERS]',
      source: 'test',
    });
  } catch (e) {
    fail('TEST user insert', e.message || e);
  }

  // Case 4: updateAiTags _from_ai 英文→中文 map + 寫入
  {
    const name = 'Case 4: updateAiTags _from_ai en→zh';
    const r = await updateAiTags(TEST_USER_ID, {
      pain_points: ['血糖紅'],
      _from_ai: true,
      _op: 'append',
    });
    assert(r.ok && r.data?.痛點?.[0]?.value === '血糖紅', name, JSON.stringify(r));
  }

  // Case 5: updatePathStage → stage=3 reset retry_count_q3=0（mergeByOp overwrite）
  {
    const name = 'Case 5: updatePathStage stage=3 reset retry_count_q3';
    // 先塞一個 retry_count_q3 非 0 的值
    await updateAiTags(TEST_USER_ID, { retry_count_q3: 5, _op: 'append' });
    const r = await updatePathStage(TEST_USER_ID, 3, { path: 'healthCheck' });
    const state = await getUserPathState(TEST_USER_ID);
    assert(
      r.ok && state.path_stage === 3 && state.ai_tags?.retry_count_q3 === 0,
      name,
      `ok=${r.ok} stage=${state.path_stage} retry_count_q3=${state.ai_tags?.retry_count_q3}`
    );
  }

  // Case 6: cleanup
  {
    const { error } = await supabase
      .from('official_line_users')
      .delete()
      .like('line_user_id', 'TEST_HELPERS_%');
    if (error) fail('Case 6: cleanup', error.message);
    else ok('Case 6: cleanup TEST_HELPERS_% 完成');
  }
}

// ----------------------------------------------------------------
// Case 7-9：Phase 3.1 dispatch 純函式（extractWeights / isMainChoice / CHOICE_TO_PATH）
// ----------------------------------------------------------------
{
  const { extractWeights, isMainChoice, CHOICE_TO_PATH, pickWeightDiffCondition } = await import(
    '../lib/conversation-path.js'
  );

  // --- extractWeights 正案 ---
  {
    const cases = [
      { in: '我目前 170公分，78公斤，想瘦到70公斤', expect: { current: 78, target: 70 } },
      { in: '身高 165cm 體重 72 想瘦到 62', expect: { current: 72, target: 62 } },
      { in: '173 身高 65 體重，想瘦到 58 公斤', expect: { current: 65, target: 58 } },
      { in: '身高 180 體重 95 kg 目標 80 kg', expect: { current: 95, target: 80 } },
      { in: '78 想瘦到 70', expect: { current: 78, target: 70 } },
      { in: '目前體重 85kg，目標 65kg', expect: { current: 85, target: 65 } },
      { in: '現在 72.5 想瘦到 65.0 公斤', expect: { current: 72.5, target: 65 } },
    ];
    for (const c of cases) {
      const r = extractWeights(c.in);
      const pass = r && r.current === c.expect.current && r.target === c.expect.target;
      if (pass) ok(`Case 7: extractWeights "${c.in}" → ${r.current}/${r.target}`);
      else fail(`Case 7: extractWeights "${c.in}"`, JSON.stringify(r));
    }
  }

  // --- extractWeights 反案（不該抽到）---
  {
    const negatives = [
      '今天天氣真好',
      '我想聽說明會',
      '32 個人來看我的影片',  // 沒 weight keyword
      '走了 5 公里', // 只有 1 個數字
    ];
    for (const t of negatives) {
      const r = extractWeights(t);
      if (r === null) ok(`Case 8: extractWeights 不誤抽 "${t}"`);
      else fail(`Case 8: extractWeights 誤抽 "${t}"`, JSON.stringify(r));
    }
  }

  // --- isMainChoice 正案 ---
  {
    const cases = [
      { in: 'A', expect: 'A' },
      { in: 'B ', expect: 'B' },
      { in: '選 C', expect: 'C' },
      { in: '我選D', expect: 'D' },
      { in: 'a', expect: 'A' },
      { in: 'Ｂ', expect: 'B' }, // 全形
      { in: 'A.', expect: 'A' },
      { in: 'A、', expect: 'A' },
    ];
    for (const c of cases) {
      const r = isMainChoice(c.in);
      if (r === c.expect) ok(`Case 9: isMainChoice "${c.in}" → ${r}`);
      else fail(`Case 9: isMainChoice "${c.in}"`, `expect ${c.expect}, got ${r}`);
    }
  }

  // --- isMainChoice 反案 ---
  {
    const negatives = ['ABCD', '我是 A 類型', '感謝你', 'AB'];
    for (const t of negatives) {
      const r = isMainChoice(t);
      if (r === null) ok(`Case 10: isMainChoice 不誤判 "${t}"`);
      else fail(`Case 10: isMainChoice 誤判 "${t}"`, `got ${r}`);
    }
  }

  // --- CHOICE_TO_PATH 字典 ---
  {
    const expected = {
      A: 'healthCheck',
      B: 'rebound',
      C: 'postpartum',
      D: 'eatOut',
    };
    const match = Object.keys(expected).every((k) => CHOICE_TO_PATH[k] === expected[k]);
    if (match) ok('Case 11: CHOICE_TO_PATH 4 個 enum 對齊契約');
    else fail('Case 11: CHOICE_TO_PATH', JSON.stringify(CHOICE_TO_PATH));
  }

  // --- pickWeightDiffCondition 三段切 ---
  {
    const cases = [
      { diff: 3, expect: 'weight_diff_small' },
      { diff: 5, expect: 'weight_diff_small' }, // boundary
      { diff: 8, expect: 'weight_diff_medium' },
      { diff: 14, expect: 'weight_diff_medium' },
      { diff: 15, expect: 'weight_diff_large' }, // boundary
      { diff: 30, expect: 'weight_diff_large' },
    ];
    for (const c of cases) {
      const r = pickWeightDiffCondition(c.diff, 5, 15);
      if (r === c.expect) ok(`Case 12: pickWeightDiffCondition diff=${c.diff} → ${r}`);
      else fail(`Case 12: pickWeightDiffCondition diff=${c.diff}`, `expect ${c.expect}, got ${r}`);
    }
  }
}

// ----------------------------------------------------------------
// Summary
// ----------------------------------------------------------------
console.log('');
console.log(
  `📊 Summary: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`
);
process.exit(results.failed > 0 ? 1 : 0);
