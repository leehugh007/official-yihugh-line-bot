-- migration_004: push_logs 新增 exclude_enrolled 欄位
ALTER TABLE official_push_logs
  ADD COLUMN IF NOT EXISTS exclude_enrolled BOOLEAN DEFAULT FALSE;
