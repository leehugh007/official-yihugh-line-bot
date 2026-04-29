// 全域 Handoff + 禮貌結束 + notify
// 契約：契約_對話路徑.md v6.1 第 6 章 + 附錄 C
//
// Handoff Priority（附錄 C）：
//   Level 0（最高）：禮貌結束關鍵字 → 回禮貌話 + intent='low'，path_stage 保持
//   Level 1：全域 Handoff 關鍵字（stage>=2）→ stage=5 + notify 婉馨/一休
//   Level 2/3：模板 on_keyword_match（Phase 3.2 後續處理）
//   Level 4：fallback（Phase 3.2 後續）

import supabase from './supabase.js';
import { getSettingTyped } from './official-settings.js';
import { updatePathStage, updateAiTags } from './users.js';
import { pushMessage, textMessage } from './line.js';
import { NOTIFY_USER_IDS } from './constants.js';

/**
 * Level 1 全域 Handoff 關鍵字比對（stage>=2 才呼叫）
 * 優先序：want_enroll > asked_price > asked_family
 *
 * @param {string} text
 * @returns {Promise<'want_enroll'|'asked_price'|'asked_family'|null>}
 */
export async function matchGlobalHandoff(text) {
  if (!text) return null;
  const [enroll, price, family] = await Promise.all([
    getSettingTyped('handoff_keywords_enroll'),
    getSettingTyped('handoff_keywords_price'),
    getSettingTyped('handoff_keywords_family'),
  ]);

  if (Array.isArray(enroll) && enroll.some((kw) => text.includes(kw))) return 'want_enroll';
  if (Array.isArray(price) && price.some((kw) => text.includes(kw))) return 'asked_price';
  if (Array.isArray(family) && family.some((kw) => text.includes(kw))) return 'asked_family';
  return null;
}

/**
 * Level 0 禮貌結束關鍵字（任何 stage 都檢查）
 * 契約 6.3：命中 → 回禮貌結束 + 寫 intent='low'，path_stage 保持
 */
export async function matchPoliteEnd(text) {
  if (!text) return false;
  const keywords = await getSettingTyped('ai_polite_end_keywords');
  if (!Array.isArray(keywords)) return false;
  return keywords.some((kw) => text.includes(kw));
}

/**
 * 回用戶的禮貌結束話（stage 不變，intent 寫 low）
 * 必須帶 _from_ai: true 觸發 EN→ZH 映射（intent → 意願），否則 ALLOWED_KEYS 只認中文 key 會靜默丟失
 */
export async function handlePoliteEnd(event, userId, replyFn) {
  await updateAiTags(userId, { intent: 'low', _from_ai: true, _op: 'overwrite' });
  const msg = textMessage('好的，了解了，如果未來想聊再來找我就好，不打擾你。');
  await replyFn(event.replyToken, [msg]);
}

/**
 * 觸發 Handoff：更新 DB (stage=5) + 降意願 + notify（全部 await）
 * 回傳是否成功推進 stage=5
 *
 * 注意：notify 必須 await，不能 fire-and-forget
 * —— Vercel serverless 在 POST handler return 後可能 kill runtime，
 *    fire-and-forget 的 pushMessage 可能沒跑完，婉馨收不到通知 = 用戶等不到人
 */
export async function triggerHandoff(userId, reason) {
  const r = await updatePathStage(userId, 5, { handoff_reason: reason });
  if (!r.ok) {
    console.error('[Handoff] updatePathStage(5) failed:', r.error);
    return false;
  }

  // 契約 6.6 步驟 3：high intent 降級 medium（Handoff 已經是「高意願要進人工」訊號，
  // 繼續標 high 會在 14d ai_tags freshness cron 週期內持續被當主要標籤，誤導婉馨）
  await updateAiTags(userId, { intent: 'medium', _from_ai: true, _op: 'overwrite' }).catch(
    (err) => console.error('[Handoff] intent downgrade failed:', err?.message)
  );

  // notify await 確保 Vercel serverless 不在 push 完成前結束 runtime
  // 代價：~2s reply latency；收益：notify 可靠送達（這是 Phase 3.2a 核心 UX）
  try {
    await notifyHandoff(userId, reason);
  } catch (err) {
    console.error('[Handoff] notify failed:', err?.message);
    // notify 失敗不回傳 false（stage=5 已 commit，回 true 讓 webhook reply 用戶）
  }

  return true;
}

async function notifyHandoff(userId, reason) {
  const notifyTo = (await getSettingTyped('handoff_notify_to')) || ['yixiu', 'wanxin'];

  const { data: user } = await supabase
    .from('official_line_users')
    .select(
      'display_name, metabolism_type, current_weight, target_weight, path, path_stage, ai_tags'
    )
    .eq('line_user_id', userId)
    .maybeSingle();

  if (!user) {
    console.error('[Handoff] user not found for notify:', userId);
    return;
  }

  const pathZh = {
    healthCheck: '健康檢查異常',
    rebound: '復胖過',
    postpartum: '產後',
    eatOut: '外食多',
    other: '其他',
  }[user.path] || '未知';

  const reasonZh = {
    want_enroll: '想報名',
    asked_price: '問價格',
    asked_family: '問家人',
    high_intent: '高意願',
    postpartum_returned: '產後回來',
    manual: '手動',
    // Q5 契約 v2.3 Ch.0.2 / Ch.7.2
    q5_followup: 'Q5 後有問題要問',
    q5_non_text_query: 'Q5 階段傳非文字訊息', // PR 0.7 用
    // Phase 3.3 bridging（Q5 wire 前）：Q4 後有自由文字回應 → 直接進人工
    // TODO Phase 4.2：Q5 classifier wire 上線後拿掉這個 reason（stage=4 走 Q5 flow）
    q4_followup_before_q5_wire: 'Q4 後有回應（Q5 未 wire，臨時 bridging）',
    // 2026-04-24：Q4 Quick Reply 三按鈕「想聽聽」= 明確表達想進下一步
    // TODO Phase 4.2：Q5 classifier wire 後改走 performQ5Transition 而非 handoff
    q4_continue: 'Q4 Quick Reply「想聽聽」— 高意願',
    // 2026-04-24：Q4 Quick Reply「再考慮看看」= 仍在猶豫，建議婉馨先給學員故事再慢慢導
    q4_maybe: 'Q4 Quick Reply「再考慮看看」— 考慮中，建議先分享學員故事',
    // 2026-04-30：Q4 AI 自動重試 3 次都失敗（Gemini 不穩 4/29 事故），請 fifi 親自接
    q4_ai_failed: '✗ Q4 AI 失敗（自動重試 3 次都失敗）— 請 fifi 親自接',
  }[reason] || reason;

  const pains = Array.isArray(user.ai_tags?.['痛點'])
    ? user.ai_tags['痛點'].map((x) => x?.value).filter(Boolean)
    : [];

  const msg = [
    '🔴 高意願用戶進 Handoff',
    `名字：${user.display_name || '(無名)'}`,
    `路徑：${pathZh}`,
    `第 ${user.path_stage} 步`,
    `想瘦：${user.current_weight ?? '?'} → ${user.target_weight ?? '?'} 公斤`,
    `代謝類型：${user.metabolism_type || '未測'}`,
    `Handoff 原因：${reasonZh}`,
    `痛點：${pains.length ? pains.join('、') : '無'}`,
    '',
    `→ 開對話：https://official-yihugh-line-bot.vercel.app/admin?user=${userId}`,
  ].join('\n');

  const targets = notifyTo
    .map((name) => NOTIFY_USER_IDS[name])
    .filter(Boolean);

  for (const to of targets) {
    try {
      await pushMessage(to, [textMessage(msg)]);
    } catch (e) {
      console.error(`[Handoff] push to ${to} failed:`, e.message);
    }
  }
}
