// lib/q5-story-templates.js
// Q4「想聽聽」postback q4_continue 觸發時推的「path-specific 學員故事」
//
// 設計目的（一休 2026-04-26）：
//   原 Q4 → Q5 是直接推軟邀請（看看做法 / 有問題想問），跳得太快。
//   中間插一層「依 path 對應的學員故事」做情緒承接：
//     - 用戶感受「她（學員）跟我一樣 → ABC 對我也有效」
//     - 比起跳轉看完整 landing，先給一個對應自己困境的成功案例更有說服力
//
// 4 個 path 對應 4 個學員（對齊 Q2 path_choice ABCD）：
//   A healthCheck → 沛蓁（健檢紅字、體型誤判）
//   B rebound     → 俐臻（127→65kg「胖是改變的機會」）
//   C postpartum  → 溫溫（產後 3 個月 -10kg）
//   D eatOut      → 美美（拒絕抽脂、純外食族）
//
// path=other / null：fallback 給 caller，不推故事走原邏輯（handoff / Q5 軟邀請）
//
// 圖片來源：public/images/landing/ 已部署的 land006-016（/apply landing 同源）
//   prod URL: https://official-yihugh-line-bot.vercel.app/images/landing/landXXX.png
//   LINE 抓 HTTPS public URL，不用上傳 Storage

const STORIES = {
  healthCheck: {
    studentName: '沛蓁',
    weightChange: '85 → 67 kg（−18 kg）',
    imageUrl:
      'https://official-yihugh-line-bot.vercel.app/images/landing/land008.png',
    imageAlt: '沛蓁：「她曾經被誤認是他媽媽」—— before/after 對比',
    body:
      '沛蓁煮雞湯要征服老公的胃，結果外人卻把她認成老公的媽媽。\n' +
      '她沒節食、沒吃藥，是「吃飽」瘦下來的。\n\n' +
      '健檢紅字、體型誤判讓人崩潰 — 但身體願意給你機會，只要方法對。',
  },
  rebound: {
    studentName: '俐臻',
    weightChange: '127 → 65 kg（−62 kg）',
    imageUrl:
      'https://official-yihugh-line-bot.vercel.app/images/landing/land016.png',
    imageAlt: '俐臻：「胖是她的命」→ 一年 -62 kg，溫柔對自己',
    body:
      '她原本連穿襪子都要女兒幫忙彎腰，覺得這輩子就這樣了。\n' +
      '一年後 −62 公斤，她說：「原來胖是給我改變的機會。」\n\n' +
      '復胖過幾次的人最知道挫折感 — 她學會的不是怎麼瘦，是怎麼溫柔對自己。',
  },
  postpartum: {
    studentName: '溫溫',
    weightChange: '產後 3 個月 −10 kg',
    imageUrl:
      'https://official-yihugh-line-bot.vercel.app/images/landing/land006.png',
    imageAlt: '溫溫：產後肚子真的回得去 — 不挨餓也能瘦',
    body:
      '她生完小孩之後，陷在暴食跟自責的循環裡三年。\n' +
      '來我這之後，第一次發現 — 瘦身可以吃飽、不用挨餓。\n\n' +
      '三個月瘦十公斤，不只她變回來，連家人也跟著改變。',
  },
  eatOut: {
    studentName: '美美',
    weightChange: '拒絕抽脂的那個選擇',
    imageUrl:
      'https://official-yihugh-line-bot.vercel.app/images/landing/land009.png',
    imageAlt: '美美：原本準備去抽脂，最後選擇換對方法',
    body:
      '美美姐姐做過切胃手術 — 瘦下來，又胖回去，胖得更多。\n' +
      '美美去醫美諮詢抽脂，最後決定不做：「我不要再走一次我姐的路。」\n\n' +
      '全外食、應酬多的人最怕方法不能融入生活 — 美美用這套一次做對。',
  },
};

// 結尾統一 punchline（4 個故事共用）
export const STORY_PUNCHLINE = '你不是輸給意志力，是還沒找對方法。';

/**
 * 依 path 取對應學員故事
 * @param {string|null|undefined} path
 * @returns {{studentName, weightChange, imageUrl, imageAlt, body}|null}
 */
export function getStoryByPath(path) {
  if (!path || typeof path !== 'string') return null;
  return STORIES[path] || null;
}

/**
 * 給後台/debug 用，列出所有可用 path
 */
export function listAvailablePaths() {
  return Object.keys(STORIES);
}
