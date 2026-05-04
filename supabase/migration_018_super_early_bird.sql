-- Migration 018: V3.2 超早鳥優惠（cutoff_at + 三段價錨點 + settings）
-- 日期：2026-05-04
--
-- 內容：
--   1. ALTER official_program_applications 加 super_early_bird_applied + final_price
--   2. INSERT 5 個 settings：cutoff_at + 4 個 price tiers
--   3. CREATE OR REPLACE submit_application RPC 加 2 個新參數
--
-- 設計：
--   - cutoff_at 是「進入說明會階段」的 hard gate：NOW() < cutoff_at = 享超早鳥
--   - 一休後台改 cutoff_at 達成「立刻關 / 排程關 / 延長」三種操作
--   - 不做個人 24h 計時（一休拍板：3 天後再點還是要享超早鳥）
--   - $12,600 是 anchor 錨點（永不真實顯示給用戶報名，只在 landing 劃線當對比）
--   - landing 顯示倒數「剩 X 天」當急迫感，取代個人 24h 計時
--
-- Rollback：
--   ALTER TABLE official_program_applications
--     DROP COLUMN super_early_bird_applied,
--     DROP COLUMN final_price;
--   DELETE FROM official_settings WHERE key IN (
--     'super_early_bird_cutoff_at',
--     'price_12weeks_super', 'price_12weeks_regular', 'price_12weeks_anchor',
--     'price_4weeks_trial'
--   );
--   DROP FUNCTION IF EXISTS submit_application(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, NUMERIC) CASCADE;
--   -- 然後重跑 migration_014 還原舊 12 參數 RPC

-- ============================================================
-- 1. ALTER applications 加 2 欄
-- ============================================================
ALTER TABLE official_program_applications
  ADD COLUMN super_early_bird_applied BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN final_price NUMERIC(10, 2);

COMMENT ON COLUMN official_program_applications.super_early_bird_applied IS
  'V3.2 超早鳥優惠是否享有 — submit 當下根據 settings.super_early_bird_cutoff_at 算（NOW() < cutoff_at = true）';
COMMENT ON COLUMN official_program_applications.final_price IS
  '成交當下價格（snapshot），未來改價可追溯。NULL = migration 之前的舊報名';

-- ============================================================
-- 2. INSERT 5 個 settings（已存在則略過）
-- ============================================================
INSERT INTO official_settings (key, value) VALUES
  ('super_early_bird_cutoff_at', '2026-05-31T15:59:59Z'),
  ('price_12weeks_super', '10400'),
  ('price_12weeks_regular', '11400'),
  ('price_12weeks_anchor', '12600'),
  ('price_4weeks_trial', '4980')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 3. submit_application RPC 加 2 個新參數
-- ============================================================
-- 先 DROP 舊 12 參數版本（避免 overload ambiguity）
DROP FUNCTION IF EXISTS submit_application(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) CASCADE;

-- CREATE 新 14 參數版本（加 p_super_early_bird_applied + p_final_price）
CREATE OR REPLACE FUNCTION submit_application(
  p_line_user_id TEXT,
  p_real_name TEXT,
  p_phone TEXT,
  p_email TEXT,
  p_address TEXT,
  p_gender TEXT,
  p_age INTEGER,
  p_line_id TEXT,
  p_display_name TEXT,
  p_program_choice TEXT,
  p_agreed_refund_policy BOOLEAN,
  p_source TEXT,
  p_super_early_bird_applied BOOLEAN,
  p_final_price NUMERIC
) RETURNS submit_application_result
LANGUAGE plpgsql
AS $$
DECLARE
  v_app_id BIGINT;
  v_user_path TEXT;
  v_enrolled_at TIMESTAMPTZ;
  v_other_apps INTEGER;
  v_other_phone INTEGER;
BEGIN
  -- 1. 先驗用戶存在（擋 NOT FOUND 靜默成功）
  SELECT path INTO v_user_path
  FROM official_line_users
  WHERE line_user_id = p_line_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found: %', p_line_user_id USING ERRCODE = 'P0002';
  END IF;

  -- 2. INSERT 報名資料（含新 2 欄）
  INSERT INTO official_program_applications (
    line_user_id, real_name, phone, email, address, gender, age,
    line_id, display_name, program_choice, agreed_refund_policy,
    source, status, notify_status,
    super_early_bird_applied, final_price
  ) VALUES (
    p_line_user_id, p_real_name, p_phone, p_email, p_address, p_gender, p_age,
    p_line_id, p_display_name, p_program_choice, p_agreed_refund_policy,
    p_source, 'pending', 'pending',
    COALESCE(p_super_early_bird_applied, false),
    p_final_price
  ) RETURNING id INTO v_app_id;

  -- 3. UPDATE 用戶 stage + enrolled_* snapshot
  UPDATE official_line_users
  SET
    path_stage = 8,
    enrolled_at = COALESCE(enrolled_at, now()),
    enrolled_from_path = COALESCE(enrolled_from_path, v_user_path)
  WHERE line_user_id = p_line_user_id
  RETURNING enrolled_at INTO v_enrolled_at;

  -- 4. 查是否有其他報名（同 line_user_id 或同 phone，不含本次）
  SELECT COUNT(*) INTO v_other_apps
  FROM official_program_applications
  WHERE line_user_id = p_line_user_id AND id != v_app_id;

  SELECT COUNT(*) INTO v_other_phone
  FROM official_program_applications
  WHERE phone = p_phone AND id != v_app_id;

  RETURN (v_app_id, v_enrolled_at, v_other_apps, v_other_phone)::submit_application_result;
END;
$$;

COMMENT ON FUNCTION submit_application IS
  'Q5 報名原子操作 v2：INSERT applications（含 super_early_bird_applied + final_price）+ UPDATE users stage=8 + 回傳重複計數。Migration 018';
