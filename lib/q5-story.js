// lib/q5-story.js
// Q4「想聽聽」postback q4_continue 觸發後推「path-specific 學員故事 Flex」
//
// 流程（webhook q4_continue handler 用）：
//   1. getStoryByPath(user.path) — 取對應學員故事 data
//   2. 若 null → caller fallback 走原邏輯（handoff / Q5 軟邀請）
//   3. 若有 story → buildStoryFlexMessage 組 Flex bubble
//      - hero: 學員 before/after 圖（aspectRatio 1:1 + cover）
//      - body: 學員名 + 體重變化 + 故事 + punchline
//      - footer: 三按鈕（2026-04-26 一休定調）
//          [primary]   「想了解 ABC 在做什麼」→ postback q4_story_interested → handoff 通知
//          [primary]   「有問題想問」          → postback q4_story_question  → handoff 通知
//          [secondary] 「我再想想」            → postback q4_story_maybe     → 不通知
//
// 設計重點（一休 2026-04-26）：
//   - 圖片 URL 用 public/images/landing/ 既有圖，免上傳 Storage
//   - 第一版不接 /apply，全部走 handoff 人工處理
//     理由：/apply 報名後流程未完美（金流 / 超早鳥未定）→ 先把通知接住，手動處理
//     觀察按鈕點擊比例再決定下步（接 /apply / 推早鳥優惠詢問層）
//   - 三按鈕全用 postback（沒有 URI），webhook handlePostback 集中處理

import { replyMessage, pushMessage } from './line.js';
import { getStoryByPath, STORY_PUNCHLINE } from './q5-story-templates.js';

export { getStoryByPath, STORY_PUNCHLINE } from './q5-story-templates.js';

/**
 * 組學員故事 Flex bubble（三按鈕版）
 * @param {object} story - 從 getStoryByPath 取得的 story object
 * @returns {object} LINE Flex Message object
 */
export function buildStoryFlexMessage(story) {
  return {
    type: 'flex',
    altText: `學員故事：${story.studentName}（${story.weightChange}）`,
    contents: {
      type: 'bubble',
      hero: {
        type: 'image',
        url: story.imageUrl,
        size: 'full',
        // 1:1 ratio + cover：學員 before/after 圖多為直長 → cover 顯示上半部 + 部分裁切
        // 若實測顯示效果差，後續可改 aspectMode='fit'（保留全圖但有黑邊）
        aspectRatio: '1:1',
        aspectMode: 'cover',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: story.studentName,
            weight: 'bold',
            size: 'xl',
            color: '#1a1a1a',
          },
          {
            type: 'text',
            text: story.weightChange,
            size: 'sm',
            color: '#0b6e39',
            weight: 'bold',
            margin: 'xs',
          },
          {
            type: 'separator',
            margin: 'md',
          },
          {
            type: 'text',
            text: story.body,
            size: 'sm',
            wrap: true,
            margin: 'md',
            color: '#333333',
          },
          {
            type: 'text',
            text: STORY_PUNCHLINE,
            size: 'sm',
            wrap: true,
            margin: 'md',
            weight: 'bold',
            color: '#1a1a1a',
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#06c755',
            action: {
              type: 'postback',
              label: '想了解 ABC 在做什麼',
              data: 'action=q4_story_interested',
              displayText: '想了解 ABC 在做什麼',
            },
          },
          {
            type: 'button',
            style: 'primary',
            color: '#0b6e39',
            action: {
              type: 'postback',
              label: '有問題想問',
              data: 'action=q4_story_question',
              displayText: '有問題想問',
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '我再想想',
              data: 'action=q4_story_maybe',
              displayText: '我再想想',
            },
          },
        ],
      },
    },
  };
}

/**
 * 用 reply token 推學員故事 Flex
 * @param {string} replyToken
 * @param {string} userId - 保留參數（未來 push 通知用）
 * @param {string} path - 用戶 path（healthCheck/rebound/postpartum/eatOut/other/null）
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function replyStoryFlex(replyToken, userId, path) {
  const story = getStoryByPath(path);
  if (!story) {
    return { ok: false, reason: 'no_story_for_path' };
  }

  const flex = buildStoryFlexMessage(story);
  const ok = await replyMessage(replyToken, [flex]);
  return ok ? { ok: true } : { ok: false, reason: 'reply_failed' };
}

/**
 * 用 push API 推學員故事 Flex（給未來 cron / 主動軌用）
 * @param {string} userId
 * @param {string} path
 */
export async function pushStoryFlex(userId, path) {
  const story = getStoryByPath(path);
  if (!story) {
    return { ok: false, reason: 'no_story_for_path' };
  }

  const flex = buildStoryFlexMessage(story);
  const ok = await pushMessage(userId, [flex]);
  return ok ? { ok: true } : { ok: false, reason: 'push_failed' };
}
