// lib/q5-story.js
// Q4「想聽聽」postback q4_continue 觸發後推「path-specific 學員故事 Flex」
//
// 流程（webhook q4_continue handler 用）：
//   1. getStoryByPath(user.path) — 取對應學員故事 data
//   2. 若 null → caller fallback 走原邏輯（handoff / Q5 軟邀請）
//   3. 若有 story → buildStoryFlexMessage 組 Flex bubble
//      - hero: 學員 before/after 圖（aspectRatio 1:1 + cover）
//      - body: 學員名 + 體重變化 + 故事 + punchline
//      - footer: 兩按鈕
//          [primary] 「想了解 ABC 在做什麼」→ URI /apply (HMAC signed URL)
//          [secondary]「我再想想」          → postback action=q4_story_maybe
//   4. pushStoryFlex 用 replyMessage（webhook 原 reply token 還沒用）
//
// 設計重點：
//   - 圖片 URL 用 public/images/landing/ 既有圖，免上傳 Storage
//   - 按鈕 URI 用 buildQ5ApplyUrl（同 Q5 軟邀請 pattern，HMAC sig + trigger=passive）
//     → 用戶點擊進 /apply 仍會升 stage 6→7（Phase 4.1 既有邏輯）
//   - postback q4_story_maybe 走 webhook handlePostback（新增 handler）

import { replyMessage, pushMessage } from './line.js';
import { buildQ5ApplyUrl } from './q5-apply-url.js';
import { getStoryByPath, STORY_PUNCHLINE } from './q5-story-templates.js';

export { getStoryByPath, STORY_PUNCHLINE } from './q5-story-templates.js';

/**
 * 組學員故事 Flex bubble
 * @param {object} story - 從 getStoryByPath 取得的 story object
 * @param {string} applyUrl - HMAC signed /apply URL
 * @returns {object} LINE Flex Message object
 */
export function buildStoryFlexMessage(story, applyUrl) {
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
              type: 'uri',
              label: '想了解 ABC 在做什麼',
              uri: applyUrl,
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
 * @param {string} replyToken - LINE webhook 的 replyToken
 * @param {string} userId - LINE userId
 * @param {string} path - 用戶 path（healthCheck/rebound/postpartum/eatOut/other/null）
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function replyStoryFlex(replyToken, userId, path) {
  const story = getStoryByPath(path);
  if (!story) {
    return { ok: false, reason: 'no_story_for_path' };
  }

  let applyUrl;
  try {
    applyUrl = await buildQ5ApplyUrl({ userId, triggerSource: 'passive' });
  } catch (err) {
    console.error('[q5-story/replyStoryFlex] buildQ5ApplyUrl failed:', err?.message);
    return { ok: false, reason: 'build_url_failed' };
  }

  const flex = buildStoryFlexMessage(story, applyUrl);
  const ok = await replyMessage(replyToken, [flex]);
  return ok ? { ok: true } : { ok: false, reason: 'reply_failed' };
}

/**
 * 用 push API 推學員故事 Flex（給未來 cron / 主動軌用，目前 webhook 用 replyStoryFlex）
 * @param {string} userId
 * @param {string} path
 */
export async function pushStoryFlex(userId, path) {
  const story = getStoryByPath(path);
  if (!story) {
    return { ok: false, reason: 'no_story_for_path' };
  }

  let applyUrl;
  try {
    applyUrl = await buildQ5ApplyUrl({ userId, triggerSource: 'passive' });
  } catch (err) {
    console.error('[q5-story/pushStoryFlex] buildQ5ApplyUrl failed:', err?.message);
    return { ok: false, reason: 'build_url_failed' };
  }

  const flex = buildStoryFlexMessage(story, applyUrl);
  const ok = await pushMessage(userId, [flex]);
  return ok ? { ok: true } : { ok: false, reason: 'push_failed' };
}
