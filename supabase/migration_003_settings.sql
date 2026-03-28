-- ============================================================
-- 003: 設定表 + 推播排程欄位
-- ============================================================

-- 1. 設定表（關鍵字回覆等可編輯內容）
CREATE TABLE IF NOT EXISTS official_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 預設值
INSERT INTO official_settings (key, value) VALUES
  ('seminar_info', E'📢 最近一場線上說明會：\n\n📅 日期：待公布\n⏰ 時間：待公布\n📍 方式：線上直播\n\n👉 報名連結：\nhttps://abcmetabolic.com/seminar\n\n說明會完全免費，我會完整介紹 ABC 代謝重建瘦身法的原理和課程內容。\n有任何問題也可以直接問我！'),
  ('pricing_info', E'目前 ABC 代謝重建瘦身法有提供線上課程 💪\n\n想了解詳細方案和價格的話，可以先參加我們的免費說明會，我會完整說明課程內容和適合的方案：\n\n👉 最近一場說明會報名：\nhttps://abcmetabolic.com/seminar\n\n有任何問題也可以直接問我！'),
  ('abc_info', E'ABC 代謝重建瘦身法的核心概念：\n\n你的問題不是胖，是代謝失調。\n重建代謝力，瘦只是順便的事。\n\n✅ 不算熱量、不挨餓\n✅ 用加法思維：增加好的食物\n✅ 重建胰島素敏感度\n✅ 恢復身體的代謝彈性\n\n想知道自己的代謝狀態嗎？\n花 2 分鐘測一下 👇\nhttps://abcmetabolic.com/quiz'),
  ('welcome_message', E'我是一休 🙂\n\n這裡會分享代謝重建、健康瘦身的觀念和方法。\n\n如果你想了解自己的代謝狀態，可以花 2 分鐘做個測驗：\nhttps://abcmetabolic.com/quiz\n\n有任何問題隨時問我！')
ON CONFLICT (key) DO NOTHING;

-- 2. 推播排程欄位
ALTER TABLE official_push_logs ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
