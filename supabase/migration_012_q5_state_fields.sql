-- migration_012: Q5 狀態欄位最小集（Q5 契約 v2.3 Ch.0.8 前置 PR 0.8）
-- 目的：為了能跑 scripts/verify-q5-atomic.js（passive + active 雙模擬 race）
--       必須先把 helper 讀寫的 5 個欄位建好。
-- 範圍：只加 atomic 驗證 + updateQ5Intent 會碰到的欄位。
--       其餘 Q5 欄位（q5_click_count / q5_clicked_at / q5_visit_followup_sent_at）
--       以及 official_program_applications 整張表，留到 Phase 4.1 migration_013。
--
-- 執行：Supabase Dashboard → SQL Editor → 貼上執行

ALTER TABLE official_line_users
  ADD COLUMN IF NOT EXISTS q5_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS q5_followup_trigger_source TEXT,
  ADD COLUMN IF NOT EXISTS q5_active_invite_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS q5_intent TEXT,
  ADD COLUMN IF NOT EXISTS q5_classified_at TIMESTAMPTZ;

COMMENT ON COLUMN official_line_users.q5_sent_at IS
  'Q5 軟邀請推送時間。performQ5Transition 以 IS NULL 為 race guard。';
COMMENT ON COLUMN official_line_users.q5_followup_trigger_source IS
  'Q5 觸發來源：passive（被動軌）/ active（主動軌）。應用層 enum，無 CHECK。';
COMMENT ON COLUMN official_line_users.q5_active_invite_sent_at IS
  '主動軌專屬：cron 推 Q5 的時間戳。被動軌留 NULL。';
COMMENT ON COLUMN official_line_users.q5_intent IS
  'Q5 AI 分類結果：continue / decline / ai_failed。NULL=尚未分類。';
COMMENT ON COLUMN official_line_users.q5_classified_at IS
  'q5_intent 最後一次寫入時間。';
