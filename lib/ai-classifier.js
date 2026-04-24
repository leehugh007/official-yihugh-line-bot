// Phase 3.2a/b/c：Gemini Flash Lite 對話路徑 AI 層
// 契約：契約_對話路徑.md v6.1 第 3 章 + 第 4.2 章 + 附錄 D/E
// Phase 3.2c 重新詮釋（2026-04-22 一休定調）：
//   Q1/Q2/Q3 = 純選項收資訊（低阻力）
//   Q4 = AI 綜合前三題產個人化回饋（DYNAMIC path_all_q4_feedback）
//
// 職責：
// 1. classifyQ4Condition({ path, current, target, userText }) — 原 Q3 自由打字分類（Phase 3.2a/b，Phase 3.2c 重設計後暫不用，保留備用）
// 2. generateFinalFeedback({ current, target, path, q3Label, metabolismType }) — Q4 綜合個人化回饋 DYNAMIC（Phase 3.2c）
// 3. validateAiOutput(stage, path, output) — 契約 3.3 防禦層（型別/enum/coerce）
// 4. getValidConditions(stage, path) — 返回合法 condition 清單
//
// 不含：
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
 * ai_tags 共用防禦（classify / meal feedback 共用）
 * Mutates output.ai_tags in place：coerce 字串→陣列、去掉非字串、intent 降級。
 */
function sanitizeAiTags(output) {
  if (output.ai_tags == null) return;
  if (typeof output.ai_tags !== 'object' || Array.isArray(output.ai_tags)) {
    output.ai_tags = {};
    return;
  }
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

  sanitizeAiTags(output);

  return { ok: true, output, fallback: output.confidence === 'low' };
}

/**
 * 驗證 DYNAMIC 餐點回饋輸出（Phase 3.2c）
 * 契約 4.2：eatOut 走 feedback_text 直出，不走 condition。
 */
export function validateMealFeedback(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { ok: false, reason: 'output_not_object' };
  }
  if (!output.confidence) return { ok: false, reason: 'missing_confidence' };
  if (!['high', 'medium', 'low'].includes(output.confidence)) {
    return { ok: false, reason: `invalid_confidence_${output.confidence}` };
  }
  if (typeof output.feedback_text !== 'string' || output.feedback_text.trim().length === 0) {
    return { ok: false, reason: 'missing_feedback_text' };
  }
  // 字數保護（prompt 要求 120-220，實際給 80-400 緩衝；過短降 fallback、過長截斷）
  const len = output.feedback_text.length;
  if (len < 40) {
    return { ok: true, output, fallback: true, reason: 'feedback_too_short' };
  }
  if (len > 600) {
    output.feedback_text = output.feedback_text.slice(0, 600);
  }

  sanitizeAiTags(output);

  return { ok: true, output, fallback: output.confidence === 'low' };
}

/**
 * 呼叫 Gemini（含 timeout + JSON 解析）
 * 拋錯：gemini_timeout / gemini_api_{status} / gemini_no_text / gemini_json_parse / gemini_no_key
 */
// Phase 4.2: export 給 lib/q5-classifier.js 共用（契約 Ch.3.1「抄 verifyHandoffIntent pattern」）
export async function callGemini(prompt, { model, timeoutMs }) {
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

// Path 白話描述（給 Q4 DYNAMIC prompt 用）
const PATH_LABEL = {
  healthCheck: '健檢紅字想改善',
  rebound: '以前瘦過又復胖',
  postpartum: '產後瘦不回來',
  eatOut: '外食比例高',
};

// 代謝類型白話描述（可選；Q1 前測過代謝才有值）
const METABOLISM_LABEL = {
  highRPM: '高轉速型（皮質醇偏高、越努力越胖）',
  rollerCoaster: '雲霄飛車型（血糖忽高忽低、下午易崩）',
  burnout: '燃燒殆盡型（長期能量透支、身體進入保護）',
  powerSave: '省電模式型（吃很少但甲狀腺被拉低、代謝調降）',
  steady: '穩定燃燒型（代謝健康但有精進空間）',
};

/**
 * Phase 3.2c 重設計：Q4 綜合個人化回饋 prompt
 * 看用戶 Q1/Q2/Q3 收集的資訊，產一段 120-220 字的專屬回饋。
 */
function buildFinalFeedbackPrompt({ current, target, path, q3Label, metabolismType }) {
  const diff = current && target ? Math.abs(current - target) : null;
  const pathLabel = PATH_LABEL[path] || path;
  const metaLabel = metabolismType ? METABOLISM_LABEL[metabolismType] : null;

  const metaBlock = metaLabel
    ? `- 代謝類型：${metaLabel}`
    : '- 代謝類型：未做代謝測驗（不知道）';

  return `你是一休（ABC 代謝瘦身法的創辦人、教練），正在回饋一位走完三題問答的用戶（40+ 台灣女性）。

🎭 視角定位（絕對不可錯）：
- 「我」= 你自己（一休，教練視角）— 帶過很多學員、看過很多案例
- 「你」= 對方（用戶，40+ 女性）— 她有痛點、她要被理解
- ❌ 絕不可寫「我看過很多跟我一樣狀況的學員」（錯：把自己當用戶）
- ✅ 必須寫「我看過很多跟你一樣狀況的學員」（對：一休以教練身份看用戶）

你的任務：看完她的【背景資料】產一段個人化回饋，讓她感覺「你真的懂我、你真的可以解決我的問題」。

═══════════════════════════════════════
【用戶背景】（這些就是他告訴你的資訊，你要從這裡抓素材）

- 用戶類型：40+ 台灣女性
${metaBlock}
- 主因路徑：${pathLabel}
- Q3 實際狀況：${q3Label}
- 目前體重：${current || '?'}kg → 目標：${target || '?'}kg${diff !== null ? `（想減 ${diff}kg）` : ''}

═══════════════════════════════════════

你的任務（只回 JSON）：

1. feedback_text: string — 一段 120-220 字的個人化回饋。

必備結構（以下六個要素都要有，但自然流暢，不要硬塞段落符號）：

① 重述痛點：用他的具體資訊（幾公斤、差幾公斤、主因、Q3 狀況）讓他感覺「你懂我」
② 解釋為什麼卡：科學 + 白話，帶他走因果推導（不是堆結論）
③ ABC 方法方向：不給菜單，給洞察，跟他選的狀況直接相關

④ 結果 framing — 給夢想 + 給確定感（4A 和 4B 兩層都必有，可同一段或分兩句）：

   4A. 具體成果（給夢想 — 根據 path 和 Q3 選項挑最對口的一種，量級用保守說法，禁編單一精確數字）：
   - 體重量級：「有人瘦了 10 幾公斤」「有人減了 8-15 公斤」「有人瘦下來 20 公斤」
     ❌ 不可寫「瘦 12 公斤」「減 8.5 公斤」這種單一精確數字
   - 健檢改善（healthCheck path 優先）：「有人糖化血色素從 7 多降到 6 以下」「有人血壓從紅字回到正常」「有人不用再吃藥」
   - 身體感受：「不再下午必甜」「晚上不再暴食」「睡得比以前深」「精神回來了」「肚子不再漲」
   - 外表變化：「腰圍減了 5 公分」「肚子整個消下去」「衣服小一號」「下巴有線條了」

   4B. 長期 framing（給確定感 — 必含「瘦一輩子」或「不復胖」或「學一次用一輩子」之類關鍵字）：
   - 「瘦下來到現在都沒復胖」
   - 「我們要的不是短期瘦，是瘦一輩子」
   - 「學一次用一輩子的吃法」
   - 「這次就是最後一次，不會再復胖」
   - 「短期瘦幾公斤不難，難的是不復胖」

⑤ 輕推方案：故事導向，不是方案導向。擇一：
   - 「想不想看我們怎麼幫這種狀況的學員做的？」
   - 「要不要聽聽她們當時是怎麼從這裡走出來的？」

🚫 禁忌（絕對不可出現）：
- 開頭不可用「哈囉！」「嗨」「你好」這種客服招呼語
- 不可用「喔！」「囉！」「唷！」「呢！」當結尾感嘆詞
- 不可用「別擔心」「加油」「這真的是很棒的目標」這種安慰／客套式包裝
- 不可用「我懂你」當起手（太淺）
- 不可編造具體數字（「3 個月瘦 12 公斤」「維持了 2 年」）— 要用保守說法

✅ 必有（至少一處自然帶出）：
- 一處一休個人判斷口氣：「說真的」「我要跟你說」「坦白講」「我看你這狀況」擇一
- 4A 具體成果（量級／健檢／身體感受／外表 四類擇一，根據 path 挑最對口）
- 4B 長期 framing（「瘦一輩子」「不復胖」「學一次用一輩子」之類關鍵字必含）

⭐ 優先（有更好，自然即可）：
- 「我帶過這種狀況的學員⋯」具體觀察

其他要求：
- 繁體中文、台灣口語、像真人 LINE 寫給朋友
- 帶讀者走推導（狀況→身體反應→長期影響→出路，因果鏈不是堆點）
- 溫暖直接，不說教、不安慰式包裝
- 術語要白話化（「血糖震盪」「胰島素阻抗」「皮質醇」出現時附白話翻譯）
- 不要條列符號（用逗句）
- 長度：120-220 字

📐 排版要求（LINE 可讀性，絕對遵守）：
- feedback_text 內**必須分 3-4 段**
- **段與段之間用「\\n\\n」（兩個換行符）分開**
- 每段 2-4 句，約 40-80 字
- ❌ 不可整段 200+ 字連成一塊（在 LINE 像一堵牆）
- 段落自然分法：
  1. 痛點重述（一段）
  2. 原因 + ABC 洞察（可合一段或拆兩段）
  3. 結果 framing（一段）
  4. 輕推方案（一段，短，一句話帶問句）

完整示範（給你定位用，不要照抄措辭）：

情境：Q1=78→70, Q2=eatOut, Q3=不知道外食怎麼選才對, 代謝類型=高轉速型

❌ 爛範例：「哈囉！想瘦 8 公斤是個很棒的目標！我們很多學員一開始都擔心外食族怎麼辦，結果 3 個月瘦了 12 公斤。你會想了解我們的方案嗎？」（客服腔、編數字、直接推方案）

✅ 好範例（注意分 4 段，段與段之間空一行；4A 量級 + 4B 長期關鍵字都有）：
「想瘦 8 公斤、主因外食、卡在不知道怎麼選 — 說真的，你這組合我看過太多。

你現在的問題不是吃多少，是沒人教你同一家便當店、同一間超商怎麼挑組合。血糖一天上上下下好幾次，下午三四點想吃甜、晚上就容易暴食，這不是意志力問題。

我帶過很多跟你一樣狀況的學員，有人瘦了 10 幾公斤、到現在都沒復胖 — 她們成功的關鍵不是換菜單，是學會在各種場景都自己挑得出『對的組合』。我們要的不是這次瘦幾公斤，是這次就是最後一次，學一次用一輩子。

想不想聽聽她們當時怎麼走出來的？」

（feedback_text JSON 值裡直接用 \\n\\n 分段，不要用 markdown 或其他標記）

═══════════════════════════════════════

2. ai_tags 抽取：Q3 是選項不是自由打字，所以大部分 ai_tags 填空陣列就好。例外：

   - intent: "high" | "medium" | "low" — 報名意願（預設 "medium"；這階段無法從 Q3 選項判斷高低意願）
   - pain_points: string[] — 只有當 q3Label 明確指向一個可抽象成 tag 的痛點時抽（例：「工作忙沒時間煮」→「忙碌」）；否則填 []
   - hesitations: string[] — 空陣列（這階段沒有用戶明確說的猶豫）
   - attentions: string[] — 空陣列（這階段沒有明確個人細節）

3. confidence: "high" | "medium" | "low"
   - 這階段都有完整資訊（Q1+Q2+Q3），預設 "high"
   - 只有當素材明顯不足（例如 path 或 q3Label 缺失）才給 medium/low

═══════════════════════════════════════

輸出 JSON schema（嚴格遵守，key 必須英文）：
{
  "feedback_text": "一段 120-220 字的個人化回饋",
  "ai_tags": {
    "pain_points": [],
    "hesitations": [],
    "intent": "medium",
    "attentions": []
  },
  "confidence": "high"
}

嚴禁：中文 key、markdown 包裝、額外解釋文字、編造用戶沒提到的具體數字、客服腔開頭結尾。`;
}

/**
 * Phase 3.2c 核心入口：Q4 綜合個人化回饋 DYNAMIC 生成
 *
 * @param {object} params
 * @param {number} [params.current]
 * @param {number} [params.target]
 * @param {'healthCheck'|'rebound'|'postpartum'|'eatOut'} params.path
 * @param {string} params.q3Label — Q3 選項的白話 label（例：「不知道外食怎麼選才對」）
 * @param {string} [params.metabolismType] — highRPM/rollerCoaster/burnout/powerSave/steady，可選
 * @returns {Promise<{ok, output?, reason?, fallback?}>}
 */
export async function generateFinalFeedback({ current, target, path, q3Label, metabolismType }) {
  if (!path || !q3Label) {
    return { ok: false, reason: 'missing_path_or_q3Label' };
  }

  const model = await getSettingTyped('gemini_model_version');
  const timeoutMs = await getSettingTyped('ai_call_timeout_ms');
  const prompt = buildFinalFeedbackPrompt({ current, target, path, q3Label, metabolismType });

  try {
    const raw = await callGemini(prompt, { model, timeoutMs });
    return validateMealFeedback(raw);
  } catch (err) {
    return { ok: false, reason: err.message || 'gemini_unknown_error' };
  }
}

// ============================================================
// Phase 3.3 — Handoff 方案 C：關鍵字命中後 AI 二次判斷
// 解決：family 關鍵字（老婆/老公/家人/一起）在描述情境時被 text.includes() 誤觸
// 例：「老婆煮家常菜」「陪家人吃飯」不該觸發 asked_family handoff
// ============================================================

// Reason 白話描述（給 Gemini 理解這次 keyword 命中是在判斷什麼意圖）
const HANDOFF_REASON_DESC = {
  want_enroll: '想直接報名／加入課程',
  asked_price: '在問課程價格／費用／方案',
  asked_family: '在詢問家人（老公／老婆／小孩）是否能一起參與、對家人有疑慮、家人反對',
};

/**
 * 組 Handoff 意圖驗證 prompt
 * 設計原則：寧誤觸（保守觸發）勝於漏送；只在「明顯是在描述情境」時才判定 false
 */
function buildHandoffVerifyPrompt({ text, reason }) {
  const desc = HANDOFF_REASON_DESC[reason] || reason;

  return `你是 ABC 代謝瘦身法 LINE Bot 的意圖判斷助手。

情境：用戶的訊息剛剛觸發了「${reason}」關鍵字（含義：${desc}）。
你的任務是判斷——這句話是否真的在表達「${reason}」這個意圖？還是只是在描述情境？

═══════════════════════════════════════
【用戶訊息】
「${text}」
═══════════════════════════════════════

判斷原則：

1. **明顯只在描述情境** → is_intent=false
   - 例（asked_family）：「老婆煮家常菜」「陪老公去吃飯」「家人聚餐」「跟家人一起吃火鍋」
   - 這些是在講自己的外食／飲食情境，不是在問家人相關問題

2. **明顯在表達該意圖** → is_intent=true
   - 例（asked_family）：「我老公不支持」「家人都反對我瘦身」「老婆怕我瘦太快」「可以帶家人一起嗎」
   - 這些是在詢問家人態度、擔心家人反對、想讓家人一起參與

3. **模糊／判斷不出來** → is_intent=true（保守觸發）
   - 漏送真有意圖的人代價 >> 誤觸一次

4. 不要腦補。只看這句話明不明顯。

═══════════════════════════════════════

輸出 JSON（嚴格遵守）：
{
  "is_intent": true | false,
  "confidence": "high" | "medium" | "low"
}

嚴禁：中文 key、markdown 包裝、額外解釋文字。`;
}

/**
 * 驗證 Handoff 意圖輸出
 */
function validateHandoffVerify(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { ok: false, reason: 'output_not_object' };
  }
  if (typeof output.is_intent !== 'boolean') {
    return { ok: false, reason: 'is_intent_not_bool' };
  }
  if (!['high', 'medium', 'low'].includes(output.confidence)) {
    // 不 reject，降級
    output.confidence = 'medium';
  }
  return { ok: true, output };
}

/**
 * Phase 3.3：Handoff 關鍵字命中後的 AI 二次判斷
 *
 * @param {object} params
 * @param {string} params.text — 用戶訊息原文
 * @param {'want_enroll'|'asked_price'|'asked_family'} params.reason — matchGlobalHandoff 命中的 reason
 * @returns {Promise<{is_intent: boolean, confidence: 'high'|'medium'|'low', fallback?: boolean, error?: string}>}
 *
 * Fallback 策略：Gemini 失敗一律 is_intent=true（保守觸發）——
 * 漏送真想報名／真問價格／真問家人的人代價高，誤觸代價低（婉馨稍微看一下）。
 */
export async function verifyHandoffIntent({ text, reason }) {
  if (!text || !reason) {
    return { is_intent: true, confidence: 'low', fallback: true, error: 'missing_input' };
  }

  const model = await getSettingTyped('gemini_model_version');
  const timeoutMs = await getSettingTyped('ai_call_timeout_ms');
  const prompt = buildHandoffVerifyPrompt({ text, reason });

  try {
    const raw = await callGemini(prompt, { model, timeoutMs });
    const validated = validateHandoffVerify(raw);
    if (!validated.ok) {
      console.warn('[verifyHandoffIntent] validation failed, fallback to conservative:', validated.reason);
      return { is_intent: true, confidence: 'low', fallback: true, error: validated.reason };
    }
    return { ...validated.output, fallback: false };
  } catch (err) {
    console.warn('[verifyHandoffIntent] gemini error, fallback to conservative:', err?.message);
    return { is_intent: true, confidence: 'low', fallback: true, error: err?.message || 'gemini_unknown_error' };
  }
}

// Export internals for unit testing（test-helpers.mjs 只測純函式，不打真實 API）
export const __test = { buildQ4Prompt, buildFinalFeedbackPrompt, buildHandoffVerifyPrompt, callGemini, PATH_DESC, CONDITION_HINT, PATH_LABEL, METABOLISM_LABEL };
