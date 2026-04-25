// 對話路徑純函式工具（Phase 3.1+）
// 從 webhook route.js 抽出，便於單元測試 + Phase 3.2 AI 層 reuse

// 路徑選項字典：A/B/C/D → path enum（對齊契約 v6 第 2 章 path 值域）
export const CHOICE_TO_PATH = {
  A: 'healthCheck',
  B: 'rebound',
  C: 'postpartum',
  D: 'eatOut',
};

/**
 * 偵測用戶是否回主因選項 A/B/C/D
 * 支援：A / a / Ａ / 選A / 我選A / A. / A、
 * 拒絕：ABCD / 我是 A 類型（長句含 A）/ AB
 * @returns {'A'|'B'|'C'|'D'|null}
 */
export function isMainChoice(text) {
  const t = String(text || '')
    .trim()
    .toUpperCase()
    .replace(/[Ａ-Ｄ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const m = t.match(/^(?:選|我選)?\s*([A-D])[\s.、。！!\u3002]*$/);
  return m ? m[1] : null;
}

/**
 * Phase 3.3: 偵測複選（AB / ABD / A,B / A B D）— Q2 引導用戶選單一
 * - 全形轉半形、去標點空白後，純 A-D 字母 2-4 個才算複選
 * - 去重 + 排序回傳（輸出穩定）
 * - 排除「ABC」（handleABC 會先接住）— 但本函式不特別處理 ABC，交給 matchKeyword 優先攔截
 * @returns {string[]|null} 例如 ['A','B','D']
 */
export function detectMultiChoice(text) {
  const cleaned = String(text || '')
    .replace(/[Ａ-Ｄ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s.、,，。！!？?\u3002]/g, '')
    .toUpperCase();
  if (!/^[A-D]{2,4}$/.test(cleaned)) return null;
  return [...new Set(cleaned.split(''))].sort();
}

/**
 * 從用戶訊息抽體重數字
 * 要求同句含體重相關關鍵字 + 兩個合理範圍數字（30-250）
 * @returns {{ current: number, target: number }|null}
 */
export function extractWeights(text) {
  const s = String(text || '');
  // 剔除身高相關數字，避免誤抽當體重
  // - 數字 + 公分/cm/CM → 身高
  // - 「N 身高」/「身高 N」→ 身高（順序重要：先剔 N+身高，避免「身高」先被吃掉）
  const stripped = s
    .replace(/\d{2,3}(?:\.\d)?\s*(?:公分|cm|CM|Cm)/g, '')
    .replace(/\d{2,3}(?:\.\d)?\s*身高/g, '')
    .replace(/身高\s*\d{2,3}(?:\.\d)?/g, '');

  const hasKeyword = /(公斤|KG|kg|Kg|瘦到|瘦成|目標|降到|減到)/.test(stripped);
  if (!hasKeyword) return null;
  const nums = Array.from(stripped.matchAll(/(\d{2,3}(?:\.\d)?)/g)).map((m) => parseFloat(m[1]));
  const inRange = nums.filter((n) => n >= 30 && n <= 250);
  if (inRange.length < 2) return null;
  const [current, target] = inRange;
  // 人類體重 > 200 屬極端，current > 200 多半是身高漏剔
  if (!(current >= 30 && current <= 200)) return null;
  if (!(target >= 30 && target <= 200)) return null;
  return { current, target };
}

/**
 * Q1 部分資訊抓取（extractWeights 雙數字抓不到時用）
 *
 * 設計目的：用戶 Q1 階段的回答形態五花八門，不一定給「現在 X 公斤 瘦到 Y」完整兩個數字。
 * 這個函式抓「部分線索」→ caller 用來生成反問文案讓用戶補完。
 *
 * 回傳：{ diff?, current?, target? } 或 null（什麼都沒抓到）
 *   - 不抓身高（已剔除含「公分/cm/身高」的片段）
 *   - 數字範圍 30-200（體重合理區間）
 *
 * stage-aware：傳 { mode: 'strict' } 拒絕純單數字（stage=0 用，防「2024 年」誤觸）
 *              傳 { mode: 'loose' } 純數字預設 current（stage=1 用，已被 Bot 明確問過體重）
 *
 * 優先序：diff > target > current（從最明確的意圖關鍵字往下降）
 */
export function extractPartialWeight(text, { mode = 'loose' } = {}) {
  const raw = String(text || '');
  // 先剔除身高（對齊 extractWeights）
  const s = raw
    .replace(/\d{2,3}(?:\.\d)?\s*(?:公分|cm|CM|Cm)/g, '')
    .replace(/\d{2,3}(?:\.\d)?\s*身高/g, '')
    .replace(/身高\s*\d{2,3}(?:\.\d)?/g, '');

  // 規則 1 — diff：「瘦3公斤 / 減5kg / -3 公斤 / 想瘦 10」
  //   數字 1-3 位（diff 可以是 3、8、10、20），上限 100（想瘦 300 公斤不合理）
  const diffMatch = s.match(/(?:想)?(?:瘦|減|-)\s*(\d{1,3}(?:\.\d)?)\s*(?:公斤|kg|KG|Kg)?/);
  if (diffMatch) {
    const d = parseFloat(diffMatch[1]);
    if (d >= 1 && d <= 100) {
      // 若該數字 ≥ 30（看起來像體重而非差距），還要看後文有無「到 / 成」判斷為 target
      // 例：「瘦到50」→ target=50，不是 diff=50
      const hasTargetHint = /瘦\s*(?:到|成)/.test(s) || /(?:目標|降到|想變|希望到)/.test(s);
      if (!hasTargetHint) {
        return { diff: d };
      }
    }
  }

  // 規則 2 — target：「瘦到50 / 目標48 / 降到60 / 想變50公斤 / 希望到55」
  const targetMatch = s.match(/(?:瘦到|瘦成|想瘦到|目標|降到|想變|希望到)\s*(\d{2,3}(?:\.\d)?)/);
  if (targetMatch) {
    const t = parseFloat(targetMatch[1]);
    if (t >= 30 && t <= 200) return { target: t };
  }

  // 規則 3 — current 明確意圖：「我現在58 / 目前65 / 我是58公斤 / 現在 65」
  const currentMatch = s.match(/(?:我現在|目前|現在|我是)\s*(\d{2,3}(?:\.\d)?)/);
  if (currentMatch) {
    const c = parseFloat(currentMatch[1]);
    if (c >= 30 && c <= 200) return { current: c };
  }

  // 規則 4 — 單數字 + 公斤單位：「58公斤 / 50 kg」（整段訊息 = 一個數字 + 單位）
  //   兩個 stage 共用。用 trimmed string match 避免「58公斤 瘦到 50」被誤抓（該 case 走 extractWeights）
  const kgOnlyMatch = s.trim().match(/^(\d{2,3}(?:\.\d)?)\s*(?:公斤|kg|KG|Kg)\s*[。！!\s]*$/);
  if (kgOnlyMatch) {
    const n = parseFloat(kgOnlyMatch[1]);
    if (n >= 30 && n <= 200) return { current: n };
  }

  // 規則 5 — 純單數字（僅 loose mode 啟用，stage=1 A 軌後用戶可信）
  //   整段訊息 = 一個 2-3 位數字（防 stage=0 打「2024 年」「52 號」誤觸）
  if (mode === 'loose') {
    const pureMatch = s.trim().match(/^(\d{2,3}(?:\.\d)?)\s*[。！!\s]*$/);
    if (pureMatch) {
      const n = parseFloat(pureMatch[1]);
      if (n >= 30 && n <= 200) return { current: n };
    }
  }

  return null;
}

/**
 * 偵測「純瘦身意圖」（無具體體重數字）
 *
 * 目的：用戶從外部工具（fatty-liver / TDEE / 手搖飲等）來 LINE，可能說
 *      「我想瘦」「我可以瘦幾公斤」「想瘦下來」這種純意圖訊息。
 *      extractPartialWeight 抓不到（沒數字），webhook stage=0 預設靜默。
 *      這個函式補洞：偵測純意圖 → caller 可 upgrade stage=1 + 推 q1_retry_weight。
 *
 * 規則：
 *   - 訊息含「想/要/可以/能 + 瘦/減肥/減重/變瘦」
 *   - 排除「含數字」（那種交給 extractPartialWeight）
 *   - 排除代他人問（老婆/老公/朋友/同事/家人）
 *   - 限制長度 ≤ 30 字（防誤攔長句裡的偶然字組合）
 *
 * 設計決策（一休 2026-04-25）：
 *   只在 stage=0 caller 用（避免 B 軌進行中誤攔）。
 *   limit 30 字防「我之前去看醫生說我想瘦但是又怕復胖怎麼辦」這種長句誤觸。
 *
 * @param {string} text
 * @returns {boolean}
 */
export function detectIntentToLoseWeight(text) {
  const s = String(text || '').trim();
  if (!s || s.length > 30) return false;

  // 排除代他人問（含人物代詞 = 不是自己想瘦）
  if (/(老婆|老公|男友|女友|朋友|同事|同學|爸|媽|姐|妹|哥|弟|阿姨|叔叔|姪|甥|爺爺|奶奶|外婆|外公)/.test(s)) {
    return false;
  }

  // 含數字 → 交給 extractPartialWeight 處理（diff/target/current）
  if (/\d/.test(s)) return false;

  // 純意圖：含「想/要/可以/能 + 瘦/減肥/減重/變瘦」
  return /(想|要|可以|能).*(瘦|減肥|減重|變瘦)/.test(s);
}

/**
 * 依體重差距選 Q2 分組 condition
 * 需傳入 small_max / large_min 閾值（從 getSettingTyped 讀）
 */
export function pickWeightDiffCondition(diff, smallMax, largeMin) {
  if (diff <= smallMax) return 'weight_diff_small';
  if (diff >= largeMin) return 'weight_diff_large';
  return 'weight_diff_medium';
}

/**
 * Phase 3.2c 重設計：Q3 1/2/3/4 選項 → (condition, label) 對應
 * label 給 Q4 prompt 塞進去讓 AI 知道用戶實際狀況（用文字不是 enum）
 * condition 只用來寫 ai_tags.q3_choice 方便追蹤
 */
export const Q3_OPTIONS = {
  healthCheck: {
    1: { cond: 'blood_sugar', label: '血糖／糖化血色素紅字' },
    2: { cond: 'cholesterol', label: '膽固醇／三酸甘油脂紅字' },
    3: { cond: 'blood_pressure', label: '血壓紅字' },
    4: { cond: 'multiple', label: '不只一個紅字' },
  },
  rebound: {
    1: { cond: 'stopped', label: '停掉某個方法就胖回來（停藥／停運動／停節食）' },
    2: { cond: 'stress', label: '壓力來就暴食' },
    3: { cond: 'unknown', label: '不知道為什麼就胖了' },
    4: { cond: 'menopause_or_age', label: '更年期或年紀大代謝變差' },
  },
  postpartum: {
    1: { cond: 'time', label: '時間不夠（顧小孩沒時間）' },
    2: { cond: 'method', label: '試過方法都沒效' },
    3: { cond: 'breastfeeding', label: '哺乳中，怕影響奶量' },
  },
  eatOut: {
    1: { cond: 'dont_know_how', label: '不知道外食怎麼選才對' },
    2: { cond: 'temptation', label: '知道要吃好但抗拒不了誘惑' },
    3: { cond: 'all_out', label: '三餐都外食，不知道怎麼開始' },
    4: { cond: 'too_busy', label: '工作忙，沒時間煮也沒時間選' },
  },
};

/**
 * 偵測用戶 Q3 回的 1/2/3/4 選項
 * 支援：1 / １（全形）/ 選 1 / 我選 1 / 1. / 1、
 * 拒絕：12 / 我是 1 類（長句）
 * @param {string} text
 * @param {'healthCheck'|'rebound'|'postpartum'|'eatOut'} path
 * @returns {{ choice: number, cond: string, label: string }|null}
 */
export function parseQ3Choice(text, path) {
  const map = Q3_OPTIONS[path];
  if (!map) return null;
  const t = String(text || '')
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const m = t.match(/^(?:選|我選)?\s*([1-9])[\s.、。！!\u3002]*$/);
  if (!m) return null;
  const choice = parseInt(m[1], 10);
  const entry = map[choice];
  if (!entry) return null;
  return { choice, cond: entry.cond, label: entry.label };
}
