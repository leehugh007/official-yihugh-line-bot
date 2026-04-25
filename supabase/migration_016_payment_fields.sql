-- Phase 4.5 Admin 報名管理 — schema 補強
--
-- 加 5 個欄位到 official_program_applications：
--   3 個匯款資訊（用戶提供 / 婉馨對帳）：payment_last5 / payment_amount / payment_date
--   2 個 admin 操作 audit log：paid_marked_by / marked_at
--
-- 全 nullable + 無 default：
--   - 既有 row id=1（一休測試）三個新欄位都 NULL，不破壞 cron notify_retry
--   - submit_application RPC（migration_014）的 INSERT VALUES 不寫到這幾欄不會 break
--
-- 狀態機規則（lib/applications.js helper 強制，DB 層暫不加 trigger 第一版彈性）：
--   pending  → paid       (admin mark_paid: 寫 paid_at + payment_* + paid_marked_by + marked_at)
--   pending  → cancelled  (admin cancel:    寫 marked_at + paid_marked_by + notes)
--   paid     → cancelled  (admin 退費:      寫 marked_at + paid_marked_by + notes 退費理由)
--   cancelled→ X          (不能回 pending/paid，重新報名要新 row)
--
-- 不動：official_line_users.path_stage（已是 8）/ users.enrolled_at（submit 時已寫）

ALTER TABLE official_program_applications
  ADD COLUMN IF NOT EXISTS payment_last5 TEXT,
  ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS payment_date DATE,
  ADD COLUMN IF NOT EXISTS paid_marked_by TEXT,
  ADD COLUMN IF NOT EXISTS marked_at TIMESTAMPTZ;

COMMENT ON COLUMN official_program_applications.payment_last5 IS
  'admin 填入：用戶提供的匯款帳號後五碼（婉馨對帳用）。admin GET 端點需 mask（只顯示 ***XX）';
COMMENT ON COLUMN official_program_applications.payment_amount IS
  '實際匯款金額（含手續費），NUMERIC(10,2) 支援小數（手續費可能 NT$ 33.5）';
COMMENT ON COLUMN official_program_applications.payment_date IS
  '用戶實際匯款日期（用戶口頭/訊息提供）。跟 paid_at 不同：paid_at 是 admin 標 paid 的時間';
COMMENT ON COLUMN official_program_applications.paid_marked_by IS
  'admin 操作者識別（''yixiu'' / ''wanxin''），audit log 用。誰標 paid/cancel/edit 都會更新';
COMMENT ON COLUMN official_program_applications.marked_at IS
  'admin 任何操作的最後時間戳（mark paid / cancel / edit payment 都會更新）。跟 paid_at 不同';
