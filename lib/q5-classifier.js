// Q5 轉換漏斗契約 v2.4 Ch.3.1：Q5_intent_classifier
//
// 職責：判斷 Q4 後用戶自由文字的意圖 — continue / decline / ai_failed
// Pattern：抄 verifyHandoffIntent try-catch（ai-classifier.js L583）
// 錯誤策略：5 種 error path 全 return intent='ai_failed'（契約 Ch.3.1 強制）
//   - gemini_timeout
//   - gemini_api_{status}
//   - gemini_no_text
//   - gemini_no_key（額外告警 — 環境問題）
//   - gemini_json_parse
//   - validator reject
//
// 呼叫方（webhook stage=4 被動軌）：
//   - continue → updateQ5Intent + performQ5Transition + pushQ5SoftInvite
//   - decline → updateQ5Intent + 靜默 or polite end
//   - ai_failed → updateQ5Intent + 保持 stage=4（下次再試 or cron 主動軌接手）
//
// 呼叫前 precondition（呼叫方必須保證）：
//   - userText 非空 + trim().length >= q5_intent_min_text_chars (2)
//   - 未命中禮貌結束（handoff.js matchPoliteEnd）
//   - 未命中 handoff 關鍵字（handoff.js matchGlobalHandoff）
//   - q5_intent IS NULL（避免重跑 AI 浪費 token）

import { withGeminiRetry } from './ai-classifier.js';
import { getSettingTyped } from './official-settings.js';

/**
 * 組 Q5 意圖分類 prompt（纯函式，測試用）
 */
function buildQ5IntentPrompt({ userText }) {
  return `你是 ABC 代謝瘦身法 LINE Bot 的意圖判斷助手。

情境：用戶剛收到一休的 Q4 綜合回饋（針對她瘦身卡關的原因 + 問她想不想聽學員怎麼走出來）。她傳了下面這則訊息。
你的任務：判斷她現在是「想繼續了解（甚至聽下一步）」還是「想結束對話」？

═══════════════════════════════════════
【用戶訊息】
「${userText}」
═══════════════════════════════════════

判斷原則：

1. **continue（想繼續）**：
   - 正面回應：「好」「想」「嗯」「可以」「OK」「聽聽看」「可以聊」
   - 進一步詢問：問更多問題、想知道細節、分享自己的狀況（不管內容是什麼）
   - 不確定但帶正向：「再看看」「先聽聽」「想了解」

2. **decline（想結束）**：
   - 明確拒絕：「不用」「先不用」「不需要」「先不要」
   - 客氣收場：「謝謝」（單獨出現、像告別）、「不打擾了」
   - 自我否定：「我自己想想」「再說吧」

3. **模糊／判斷不出** → continue（保守策略：誤觸只是多一則 Q5 訊息，漏送才真的斷在這）

═══════════════════════════════════════

輸出 JSON（嚴格遵守）：
{
  "intent": "continue" | "decline",
  "confidence": "high" | "medium" | "low",
  "reason": "一句話解釋判斷理由（50 字內）"
}

嚴禁：中文 key、markdown 包裝、額外解釋文字。`;
}

/**
 * 驗證 Q5 意圖輸出（契約 Ch.3.1 validator）
 *
 * 回傳：
 *   { ok: true, output }                         驗證通過（output 可能被降級）
 *   { ok: false, reason: '<reason>' }            拒絕，呼叫方轉 ai_failed
 *
 * 降級策略（抄 validateHandoffVerify）：
 *   - confidence 不在 enum → 降成 'medium'（不 reject）
 *   - reason 非 string → 補空字串（不 reject）
 *
 * 硬拒絕：
 *   - output 非 object / array → reject
 *   - intent 不在 ['continue', 'decline'] → reject（ai_failed 不能從 AI 直接出，是錯誤 fallback）
 */
function validateQ5Intent(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { ok: false, reason: 'output_not_object' };
  }
  if (!['continue', 'decline'].includes(output.intent)) {
    return { ok: false, reason: `invalid_intent_${output.intent}` };
  }
  if (!['high', 'medium', 'low'].includes(output.confidence)) {
    output.confidence = 'medium'; // 降級
  }
  if (typeof output.reason !== 'string') {
    output.reason = ''; // 補空
  }
  return { ok: true, output };
}

/**
 * Q5 意圖 AI 分類（被動軌 stage=4 自由文字觸發）
 *
 * @param {object} params
 * @param {string} params.userText — 用戶訊息原文（呼叫方必須已過濾，見檔頭 precondition）
 * @returns {Promise<{
 *   intent: 'continue' | 'decline' | 'ai_failed',
 *   confidence: 'high' | 'medium' | 'low',
 *   reason: string,
 *   fallback: boolean,
 *   error?: string
 * }>}
 *
 * 錯誤策略：5 種 error path 全 return intent='ai_failed' + fallback=true + error=<reason>。
 * 成功 return intent='continue'|'decline' + fallback=false。
 */
export async function classifyQ5Intent({ userText }) {
  if (!userText || typeof userText !== 'string' || userText.trim().length === 0) {
    return {
      intent: 'ai_failed',
      confidence: 'low',
      reason: '',
      fallback: true,
      error: 'missing_input',
    };
  }

  const model = await getSettingTyped('gemini_model_version');
  const timeoutMs = await getSettingTyped('ai_call_timeout_ms');
  const prompt = buildQ5IntentPrompt({ userText });

  try {
    const raw = await withGeminiRetry(prompt, { model, timeoutMs });
    const validated = validateQ5Intent(raw);
    if (!validated.ok) {
      console.warn('[classifyQ5Intent] validator reject:', validated.reason);
      return {
        intent: 'ai_failed',
        confidence: 'low',
        reason: '',
        fallback: true,
        error: validated.reason,
      };
    }
    return { ...validated.output, fallback: false };
  } catch (err) {
    const msg = err?.message || 'gemini_unknown_error';
    console.warn('[classifyQ5Intent] gemini error:', msg);

    // gemini_no_key = 環境問題（GEMINI_API_KEY 沒設），不是用戶問題 — 需要告警
    // 契約 Ch.3.1：額外 telegram 告警
    // TODO(Phase 4.3)：接 telegram webhook；目前 console.error 讓 Vercel log 立刻被注意到
    if (msg === 'gemini_no_key' || msg.startsWith('gemini_no_key')) {
      console.error('[classifyQ5Intent] CRITICAL: GEMINI_API_KEY missing in env');
    }

    return {
      intent: 'ai_failed',
      confidence: 'low',
      reason: '',
      fallback: true,
      error: msg,
    };
  }
}

// Export internals for unit testing
export const __test = { buildQ5IntentPrompt, validateQ5Intent };
