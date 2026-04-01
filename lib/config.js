// ============================================================
// 可編輯設定（一休要更新說明會、方案等資訊時，改這裡就好）
// ============================================================

// 說明會資訊（每月更新一次）
export const SEMINAR_INFO =
  '📢 最近一場線上說明會：\n\n' +
  '📅 日期：待公布\n' +
  '⏰ 時間：待公布\n' +
  '📍 方式：線上直播\n\n' +
  '👉 報名連結：\nhttps://abcmetabolic.com/seminar?utm_source=line&utm_medium=bot&utm_campaign=official\n\n' +
  '說明會完全免費，我會完整介紹 ABC 代謝重建瘦身法的原理和課程內容。\n' +
  '有任何問題也可以直接問我！';

// 歡迎訊息（新用戶加入時發送）
export function getWelcomeMessages(metabolismType, displayName) {
  const greeting = displayName ? `${displayName} 你好！` : '你好！';

  if (metabolismType) {
    // 從測驗進來的用戶 → 發代謝報告
    return [
      {
        type: 'text',
        text:
          `${greeting} 歡迎加入 🙂\n\n` +
          `我看到你剛完成了代謝類型測驗，馬上幫你生成完整的代謝報告 👇`,
      },
      // 報告會在 webhook handler 裡接著發
    ];
  }

  // 一般加入的用戶
  return [
    {
      type: 'text',
      text:
        `${greeting} 我是一休 🙂\n\n` +
        `這裡會分享代謝重建、健康瘦身的觀念和方法。\n\n` +
        `如果你想了解自己的代謝狀態，可以花 2 分鐘做個測驗：\nhttps://abcmetabolic.com/quiz?utm_source=line&utm_medium=bot&utm_campaign=official\n\n` +
        `有任何問題隨時問我！`,
    },
  ];
}

// Bot 的 BASE URL（用於連結追蹤）
export const BOT_BASE_URL =
  process.env.BOT_BASE_URL || 'https://official-yihugh-line-bot.vercel.app';
