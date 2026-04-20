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
 * 依體重差距選 Q2 分組 condition
 * 需傳入 small_max / large_min 閾值（從 getSettingTyped 讀）
 */
export function pickWeightDiffCondition(diff, smallMax, largeMin) {
  if (diff <= smallMax) return 'weight_diff_small';
  if (diff >= largeMin) return 'weight_diff_large';
  return 'weight_diff_medium';
}
