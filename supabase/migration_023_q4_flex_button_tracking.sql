-- migration_023: Q4 末尾 + 中間層學員故事 Flex 6 個按鈕點擊追蹤
-- 目的：解開「答完 Q4 → 進 Q5 漏斗」中間的流失黑盒（目前 ~36% 掉在這段，看不到細節）
-- 範圍：official_line_users 加 6 欄
--
--   Q4 末尾 3 按鈕：
--     q4_continue_at  (按「想聽聽」→ 推中間層 Flex)
--     q4_maybe_at     (按「再考慮看看」→ Handoff)
--     q4_decline_at   (按「不適合」→ 靜默退場)
--
--   中間層學員故事 Flex 3 按鈕（Phase 4.6）：
--     q4_story_interested_at  (按「想了解 ABC 在做什麼」→ 推 msg1)
--     q4_story_question_at    (按「有問題想問」→ Handoff)
--     q4_story_maybe_at       (按「我再想想」→ 靜默退場)
--
-- 寫入策略：webhook handler 用 `.is(col, null)` race guard → 首次點擊時間優先（COALESCE 效果）
--
-- 執行：Supabase MCP apply_migration 或 Dashboard SQL Editor
-- 已驗證：information_schema 確認 6 欄位全部不存在無衝突

ALTER TABLE official_line_users
  -- Q4 末尾 3 按鈕（共用全 path，2026-04-24 Phase 4.2 加的 Quick Reply）
  ADD COLUMN IF NOT EXISTS q4_continue_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS q4_maybe_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS q4_decline_at TIMESTAMPTZ,
  -- 中間層學員故事 Flex 3 按鈕（Phase 4.6, 2026-04-26 加的）
  ADD COLUMN IF NOT EXISTS q4_story_interested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS q4_story_question_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS q4_story_maybe_at TIMESTAMPTZ;

-- COMMENT 說明（給未來 session 看 schema 時有上下文）
COMMENT ON COLUMN official_line_users.q4_continue_at IS 'Q4 末尾按「想聽聽」(postback q4_continue) 時間，首次點擊 race guard 寫入';
COMMENT ON COLUMN official_line_users.q4_maybe_at IS 'Q4 末尾按「再考慮看看」(postback q4_maybe) 時間，首次點擊';
COMMENT ON COLUMN official_line_users.q4_decline_at IS 'Q4 末尾按「不適合」(postback q4_decline) 時間，首次點擊';
COMMENT ON COLUMN official_line_users.q4_story_interested_at IS '中間層 Flex 按「想了解 ABC 在做什麼」(postback q4_story_interested) 時間，首次點擊';
COMMENT ON COLUMN official_line_users.q4_story_question_at IS '中間層 Flex 按「有問題想問」(postback q4_story_question) 時間，首次點擊';
COMMENT ON COLUMN official_line_users.q4_story_maybe_at IS '中間層 Flex 按「我再想想」(postback q4_story_maybe) 時間，首次點擊';