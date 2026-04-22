-- migration_011: 加 blocked_at 欄位（Q5 契約 v2.3 Ch.0.6 前置 PR 0.6）
-- 用途：markBlocked 寫入 unfollow 發生時間，之後可排除長期未回應用戶、分析流失。
-- 既有 333 人 is_blocked 全 false（從未被 markBlocked 呼叫，side issue 另開任務追根因），
-- 新增欄位後預設 NULL，不影響既有資料。
-- 執行：Supabase Dashboard → SQL Editor → 貼上執行；或 psql -f supabase/migration_011_blocked_at.sql

ALTER TABLE official_line_users
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;

COMMENT ON COLUMN official_line_users.blocked_at IS
  'Unfollow 發生時間（markBlocked 寫入）。Q5 契約 v2.3 Ch.0.6 加入。';
