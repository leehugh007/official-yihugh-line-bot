-- Migration 013: Q5 轉換漏斗 Phase 4.1 基建
-- 契約 v2.4 Ch.2.1 / Ch.2.2
-- 日期：2026-04-23
--
-- 內容：
-- 1. official_program_applications 表（報名資料，允許家庭共用 LINE 故不加 UNIQUE）
-- 2. official_line_users 加 3 欄（q5_click_count / q5_clicked_at / q5_visit_followup_sent_at）
-- 3. 4 個 index（不含 UNIQUE）
--
-- 執行前置條件：
--   migration_011（blocked_at）+ migration_012（q5_* 5 欄）已跑 ✅
--
-- Rollback（出事時）：
--   DROP TABLE IF EXISTS official_program_applications CASCADE;
--   ALTER TABLE official_line_users DROP COLUMN IF EXISTS q5_click_count;
--   ALTER TABLE official_line_users DROP COLUMN IF EXISTS q5_clicked_at;
--   ALTER TABLE official_line_users DROP COLUMN IF EXISTS q5_visit_followup_sent_at;

-- =========================================================================
-- Part 1: official_program_applications 表
-- =========================================================================

CREATE TABLE IF NOT EXISTS official_program_applications (
  id BIGSERIAL PRIMARY KEY,
  line_user_id TEXT,                                       -- 允許 NULL（manual_offline 來源可能沒 LINE）
  real_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  address TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female', 'other')),
  age INTEGER NOT NULL CHECK (age BETWEEN 18 AND 99),
  line_id TEXT,                                            -- 選填（用戶不透過 LINE URL 報名時手填 LINE ID）
  display_name TEXT,                                       -- LINE 顯示名（有 line_user_id 時回填）
  program_choice TEXT NOT NULL CHECK (program_choice IN ('12weeks', '4weeks_trial')),
  agreed_refund_policy BOOLEAN NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('bot_q5', 'manual_offline', 'seminar', 'referral')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  notify_sent_at TIMESTAMPTZ,
  notify_status TEXT NOT NULL DEFAULT 'pending' CHECK (notify_status IN ('pending', 'sent', 'failed', 'dead_letter')),
  notes TEXT
);

-- 契約 Ch.2.1 明訂：不加 UNIQUE 到 line_user_id / phone / email
-- 理由：家庭共用 LINE（老公 + 老婆共一個 userId 分別報名）+ 同 phone 二人各報一方案

COMMENT ON TABLE official_program_applications IS
  'Q5 漏斗報名資料表。家庭共用 LINE 故不加 UNIQUE。Phase 4.5 觀察重複 phone/email 嚴重再決定是否加驗證碼。';

-- =========================================================================
-- Part 2: Indexes（不含 UNIQUE）
-- =========================================================================

-- 依 line_user_id 查某人所有報名（包含歷史取消 / 已付）
CREATE INDEX IF NOT EXISTS idx_apps_line_user
  ON official_program_applications (line_user_id)
  WHERE line_user_id IS NOT NULL;

-- 依 submitted_at 查時段
CREATE INDEX IF NOT EXISTS idx_apps_submitted
  ON official_program_applications (submitted_at DESC);

-- 依 status 查待處理
CREATE INDEX IF NOT EXISTS idx_apps_status
  ON official_program_applications (status, submitted_at DESC);

-- 依 phone 做後端 de-dup 檢查（不 UNIQUE，只查）
CREATE INDEX IF NOT EXISTS idx_apps_phone
  ON official_program_applications (phone);

-- =========================================================================
-- Part 3: official_line_users 補 3 欄
-- =========================================================================

ALTER TABLE official_line_users
  ADD COLUMN IF NOT EXISTS q5_click_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE official_line_users
  ADD COLUMN IF NOT EXISTS q5_clicked_at TIMESTAMPTZ;

ALTER TABLE official_line_users
  ADD COLUMN IF NOT EXISTS q5_visit_followup_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN official_line_users.q5_click_count IS
  '總計點擊 /apply（含 LINE-to-LINE 分享污染，契約 v2.4 Ch.12.1a）';
COMMENT ON COLUMN official_line_users.q5_clicked_at IS
  '首次點擊 /apply（COALESCE，unique 量測用）';
COMMENT ON COLUMN official_line_users.q5_visit_followup_sent_at IS
  'cron/q5-visit-followup 推送時間（24h 後推 1 次，契約 Ch.5.4）';
