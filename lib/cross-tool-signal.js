// lib/cross-tool-signal.js
// 跨工具高意願信號 push（方案 A，2026-04-25）
//
// 用戶用過 N 個工具表達瘦身意圖 = 比走完 Q1-Q4 更強的信號。
// 現況 stage=5 後說「想瘦」會靜默（避免反覆通知干擾），但跨工具行為應該被識別。
//
// 設計：
//   每個 handleXxxCodeClaim handler 收尾 call notifyCrossToolUsage()，
//   只在「老用戶（source 已是其他工具）+ 領了不同工具代碼」才推通知，
//   避免：
//     - 首次用戶（source='direct' 或 null）→ 不推（這是新用戶上鉤，不是跨工具）
//     - 同工具重領（source=currentTool）→ 不推
//
// 訊息範例：
//   📊 跨工具高意願信號
//   用戶：林小姐
//   本次：脂肪肝風險
//   之前：代謝測驗
//   → 後台：https://official-yihugh-line-bot.vercel.app/admin?user=Uxxx
//
// 限制（first version）：
//   official_line_users.source 只記一個值（quiz/protein 優先），無法看完整歷史。
//   未來如需「用過 3 個工具」這種精確訊號，要查各 sessions 表 claimed_by。

import { pushMessage, textMessage } from './line.js';
import { NOTIFY_USER_IDS } from './constants.js';

// 工具 source 值對應中文名（webhook handlers 用同樣 source enum）
const TOOL_NAMES = {
  quiz: '代謝測驗',
  sugar: '手搖飲糖攝取',
  protein: '蛋白質計算',
  fatty_liver: '脂肪肝風險',
  blood_sugar: '血糖穩定度',
  tdee: 'TDEE 計算',
};

const TOOL_SOURCES = new Set(Object.keys(TOOL_NAMES));

/**
 * 領完工具代碼後判斷是否為「跨工具」並推 LINE 通知。
 *
 * @param {string} userId
 * @param {string|null} displayName
 * @param {string} currentTool   - 當前工具的 source enum（quiz/sugar/protein/fatty_liver/blood_sugar/tdee）
 * @param {string|null} previousSource - existingUser?.source（read 時機在 update 之前）
 */
export async function notifyCrossToolUsage(userId, displayName, currentTool, previousSource) {
  try {
    // Gate 1：不是有效工具 source → 跳過（防呆）
    if (!TOOL_SOURCES.has(currentTool)) return;

    // Gate 2：首次用戶（previousSource='direct' or null/undefined）→ 不推
    //   這是新用戶第一次接觸 ABC 漏斗，不是跨工具信號
    if (!previousSource || previousSource === 'direct') return;

    // Gate 3：之前 source 不是有效工具（例：'seminar' / 'live'）→ 跳過
    if (!TOOL_SOURCES.has(previousSource)) return;

    // Gate 4：同工具重領 → 不推
    if (previousSource === currentTool) return;

    const currentName = TOOL_NAMES[currentTool] || currentTool;
    const previousName = TOOL_NAMES[previousSource] || previousSource;

    const msg = [
      '📊 跨工具高意願信號',
      `用戶：${displayName || '(無 displayName)'}`,
      `本次：${currentName}`,
      `之前：${previousName}`,
      '',
      `→ 後台：https://official-yihugh-line-bot.vercel.app/admin?user=${userId}`,
    ].join('\n');

    const targets = Object.values(NOTIFY_USER_IDS);
    for (const to of targets) {
      try {
        await pushMessage(to, [textMessage(msg)]);
      } catch (err) {
        console.error('[cross-tool/notify] push failed:', to, err?.message);
      }
    }
  } catch (err) {
    // 整個函式包外層 try/catch — 不能讓通知失敗影響 handler 成功 response
    console.error('[cross-tool/notify] exception (silent):', err?.message);
  }
}
