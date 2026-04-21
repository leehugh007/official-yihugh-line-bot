// Phase 3.2a+b：Gemini Flash Lite 對話路徑 AI 分類器
// 契約：契約_對話路徑.md v6.1 第 3 章 + 第 5 章 + 附錄 D/E
//
// 職責：
// 1. classifyQ4Condition({ path, current, target, userText }) — stage=3→4 Q4 子情境分類 + ai_tags 抽取
// 2. validateAiOutput(stage, path, output) — 契約 3.3 防禦層（型別/enum/coerce）
// 3. getValidConditions(stage, path) — 返回合法 condition 清單
//
// 不含：
// - DYNAMIC path_d_ai_meal_feedback（Phase 3.2c 另做）
// - Q2 其他狀況自由文字分類（Phase 3.2 後續）

import { getSettingTyped } from './official-settings.js';

const GEMINI_API_URL = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

// 合法 Q4 condition 清單（契約第 2.3 / 附錄 B）
// key 格式：`{stage}-{path}`
const VALID_CONDITIONS = {
  '3-healthCheck': ['blood_sugar', 'cholesterol', 'blood_pressure', 'on_meds', 'no_meds'],
  '3-rebound': ['stopped', 'stress', 'unknown', 'menopause_or_age'],
  '3-postpartum': ['time', 'method', 'breastfeeding'],
  // eatOut 用 DYNAMIC feedback_text（Phase 3.2c），不走 condition 分類
};

export function getValidConditions(stage, path) {
  return VALID_CONDITIONS[`${stage}-${path}`] || [];
}

/**
 * 驗證 AI 輸出（契約 3.3 強化版）
 * 不拋錯，回 { ok, output?, reason?, fallback }。
 * 處理型別/enum/coerce；confidence=low 標 fallback=true。
 */
export function validateAiOutput(stage, path, output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { ok: false, reason: 'output_not_object' };
  }
  if (!output.confidence) return { ok: false, reason: 'missing_confidence' };
  if (!['high', 'medium', 'low'].includes(output.confidence)) {
    return { ok: false, reason: `invalid_confidence_${output.confidence}` };
  }

  // conditions coerce + enum gate
  if (output.conditions != null) {
    if (typeof output.conditions === 'string') output.conditions = [output.conditions];
    if (!Array.isArray(output.conditions)) {
      return { ok: false, reason: 'conditions_not_array' };
    }
    const valid = getValidConditions(stage, path);
    const invalid = output.conditions.filter((c) => !valid.includes(c));
    if (invalid.length > 0) {
      return { ok: false, reason: `invalid_conditions_${invalid.join(',')}` };
    }
  }

  // ai_tags top-level 防禦（契約 3.3 v4 新增）
  if (output.ai_tags != null) {
    if (typeof output.ai_tags !== 'object' || Array.isArray(output.ai_tags)) {
      output.ai_tags = {};
    } else {
      const a = output.ai_tags;
      for (const k of ['pain_points', 'hesitations', 'attentions']) {
        if (a[k] == null) continue;
        if (typeof a[k] === 'string') a[k] = [a[k]];
        if (!Array.isArray(a[k])) {
          a[k] = [];
          continue;
        }
        // 處理 AI 回 [{value:"..."}] + 純 string 混合陣列
        a[k] = a[k]
          .map((x) => (typeof x === 'string' ? x : x?.value || null))
          .filter((x) => typeof x === 'string' && x.length > 0);
      }
      if (a.intent != null && !['high', 'medium', 'low'].includes(a.intent)) {
        a.intent = 'medium'; // 降級不 reject
      }
    }
  }

  return { ok: true, output, fallback: output.confidence === 'low' };
}

/**
 * 呼叫 Gemini（含 timeout + JSON 解析）
 * 拋錯：gemini_timeout / gemini_api_{status} / gemini_no_text / gemini_json_parse / gemini_no_key
 */
async function callGemini(prompt, { model, timeoutMs }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('gemini_no_key');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(GEMINI_API_URL(model, key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
          // thinkingConfig 在 2.5 flash-lite 非 thinking model 可能觸發 400，拔掉
        },
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`gemini_api_${resp.status}: ${body.substring(0, 200)}`);
    }

    const data = await resp.json();
    const textPart = data?.candidates?.[0]?.content?.parts?.find((p) => p.text);
    if (!textPart) throw new Error('gemini_no_text');

    // Sanitize：剝 markdown ```json ... ``` 包裝（Gemini 偶爾會加，即使 responseMimeType=json）
    const cleaned = textPart.text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      throw new Error(`gemini_json_parse: ${e.message}`);
    }
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('gemini_timeout');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Path 描述（prompt 用）
const PATH_DESC = {
  healthCheck: '健康檢查出了紅字（血糖/膽固醇/血壓）想透過瘦身改善',
  rebound: '以前瘦過但復胖了',
  postpartum: '產後瘦不回來',
};

// Condition 語意解釋（讓 AI 知道每個 enum 代表什麼）
const CONDITION_HINT = {
  // healthCheck
  blood_sugar: '血糖相關異常（糖化血色素、空腹血糖）',
  cholesterol: '膽固醇相關異常',
  blood_pressure: '血壓相關異常',
  on_meds: '目前有在吃藥（降血糖/降血壓/降血脂）',
  no_meds: '還沒吃藥、只是紅字想自己改善',
  // rebound
  stopped: '停止某個方法（如停藥、停運動、停節食）後復胖',
  stress: '壓力 / 情緒性暴食導致復胖',
  unknown: '不知道為什麼就胖回來了',
  menopause_or_age: '更年期或年紀大代謝變差',
  // postpartum
  time: '時間不夠（顧小孩沒時間運動/煮飯）',
  method: '方法不對（試過很多沒效）',
  breastfeeding: '哺乳中、擔心影響奶量',
};

/**
 * 組 Q4 子情境分類 prompt
 * 契約 3.1：英文 key、禁止中文 key、內容值中文 OK
 *
 * Phase 3.2b 調整（2026-04-21）：明確分「背景資料」vs「用戶訊息」區塊 + 加反例，
 * 防 AI 把 PATH_DESC / current/target 當 ai_tags 抽出來（實測發現）。
 */
function buildQ4Prompt({ path, current, target, userText, conditions }) {
  const desc = PATH_DESC[path] || path;
  const hints = conditions
    .map((c) => `  - "${c}"：${CONDITION_HINT[c] || c}`)
    .join('\n');

  const diff = current && target ? Math.abs(current - target) : null;

  return `你是 ABC 代謝瘦身法的對話分類助手。
以下分兩區，【背景資料】只是讓你理解情境，【用戶訊息】才是要分析的唯一主體。

═══════════════════════════════════════
【背景資料】（供你理解情境，嚴禁從這區抽任何 tag！）

- 用戶類型：40+ 台灣女性
- 主因路徑：${desc}
- 目前體重：${current || '?'}kg → 目標：${target || '?'}kg${diff !== null ? `（差 ${diff}kg）` : ''}

═══════════════════════════════════════
【用戶訊息】（唯一的 ai_tags 抽取來源）

「${userText}」

═══════════════════════════════════════

你的任務（只回 JSON）：

1. condition 分類：從【用戶訊息】判斷子情境，從下列合法清單選（可多選，至少一個最相關）：
${hints}

2. ai_tags 抽取規則（英文 key，內容值可中文）：

   ❗ 絕對規則：只從【用戶訊息】那句話抽 tag。如果用戶訊息沒提到，填 [] 空陣列。不准從【背景資料】抽、不准從主因路徑描述抽、不准從體重數字抽、不准腦補推測。

   - pain_points: string[] — 用戶明確在訊息裡「說出來」的痛點
     ✅ 用戶說「膝蓋痛」「工作忙沒時間」「老公嫌胖」→ 抽
     ❌ 背景是 healthCheck 就抽「健康檢查紅字」→ 不准（用戶沒說就不抽）
   - hesitations: string[] — 用戶明確「說出」的猶豫／擔心
     ✅「怕復胖」「不敢試新方法」「擔心花錢沒效」
     ❌ 背景資料沒提到的不准加
   - intent: "high" | "medium" | "low" — 報名意願
     high=用戶主動問方案／想試 / medium=觀望聽 / low=沒興趣
   - attentions: string[] — 用戶訊息裡「特別值得婉馨注意的細節」
     ✅ 用戶說「我目前懷孕」「我已吃藥三年」「剛流產」→ 抽
     ❌「40+ 台灣女性」「身高 170 公分」「目前 78kg」「想瘦 8kg」← 這些是背景資料，絕對不准抽！

3. confidence: "high" | "medium" | "low"
   - high：用戶訊息明確對應某個 condition
   - low：訊息太短 / 離題 / 跟路徑無關（例如用戶又打一次體重句或問其他事）

═══════════════════════════════════════

輸出 JSON schema（嚴格遵守，key 必須英文）：
{
  "conditions": ["合法_condition_值"],
  "ai_tags": {
    "pain_points": [],
    "hesitations": [],
    "intent": "medium",
    "attentions": []
  },
  "confidence": "high|medium|low"
}

嚴禁：中文 key、markdown 包裝、額外解釋文字、從背景資料抽 tag、編造用戶沒說的內容。`;
}

/**
 * Phase 3.2a 核心入口：Q4 子情境分類 + ai_tags 抽取
 *
 * @param {object} params
 * @param {'healthCheck'|'rebound'|'postpartum'} params.path
 * @param {number} [params.current]
 * @param {number} [params.target]
 * @param {string} params.userText
 * @returns {Promise<{ok, output?, reason?, fallback?}>}
 */
export async function classifyQ4Condition({ path, current, target, userText }) {
  const conditions = getValidConditions(3, path);
  if (conditions.length === 0) {
    return { ok: false, reason: `no_valid_conditions_for_path_${path}` };
  }
  if (!userText || userText.length === 0) {
    return { ok: false, reason: 'empty_user_text' };
  }

  const model = await getSettingTyped('gemini_model_version');
  const timeoutMs = await getSettingTyped('ai_call_timeout_ms');
  const prompt = buildQ4Prompt({ path, current, target, userText, conditions });

  try {
    const raw = await callGemini(prompt, { model, timeoutMs });
    return validateAiOutput(3, path, raw);
  } catch (err) {
    return { ok: false, reason: err.message || 'gemini_unknown_error' };
  }
}

// Export internals for unit testing（test-helpers.mjs 只測純函式，不打真實 API）
export const __test = { buildQ4Prompt, callGemini, PATH_DESC, CONDITION_HINT };
