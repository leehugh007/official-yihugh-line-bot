-- Migration 014: submit_application PL/pgSQL RPC
-- 契約 v2.4 Ch.5.3
-- 日期：2026-04-23
--
-- 內容：
--   submit_application(...) RPC — 一次 transaction 做兩件事：
--     1. INSERT 一筆 official_program_applications（status=pending / notify_status=pending）
--     2. UPDATE official_line_users (stage=8, enrolled_at=COALESCE, enrolled_from_path=COALESCE)
--
-- 安全設計：
--   - 先 SELECT 驗用戶存在，不存在 RAISE 'user_not_found' (P0002)
--   - COALESCE 保護首次 enrolled_at / enrolled_from_path 不被後續覆蓋
--   - 回傳 other_apps_count + other_phone_count 讓呼叫方可 UI 上警示重複
--
-- HMAC 防護在 API layer (/api/apply/submit)，此 RPC 假設呼叫方已驗證
--
-- Rollback：
--   DROP FUNCTION IF EXISTS submit_application CASCADE;
--   DROP TYPE IF EXISTS submit_application_result;

DROP FUNCTION IF EXISTS submit_application(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, BOOLEAN, TEXT) CASCADE;
DROP TYPE IF EXISTS submit_application_result CASCADE;

CREATE TYPE submit_application_result AS (
  application_id BIGINT,
  enrolled_at TIMESTAMPTZ,
  other_apps_count INTEGER,
  other_phone_count INTEGER
);

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
  p_source TEXT
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

  -- 2. INSERT 報名資料
  INSERT INTO official_program_applications (
    line_user_id, real_name, phone, email, address, gender, age,
    line_id, display_name, program_choice, agreed_refund_policy,
    source, status, notify_status
  ) VALUES (
    p_line_user_id, p_real_name, p_phone, p_email, p_address, p_gender, p_age,
    p_line_id, p_display_name, p_program_choice, p_agreed_refund_policy,
    p_source, 'pending', 'pending'
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
  'Q5 報名原子操作：INSERT applications + UPDATE users stage=8 + 回傳重複計數。契約 v2.4 Ch.5.3';
