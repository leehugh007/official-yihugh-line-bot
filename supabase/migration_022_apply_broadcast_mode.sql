-- Migration 022: /apply 廣播入口配套（契約_apply廣播入口.md）
-- 日期：2026-05-07
--
-- 三件 DB 改動：
--   1. ALTER source CHECK 加 'broadcast'
--   2. 加 partial unique index 防同人重複 pending（攻擊面 + 防雙擊保護）
--   3. submit_application RPC 加 p_mode 第 15 參數 + upsert 分支
--
-- 設計：
--   - mode='private'（既有漏斗）：用戶不在 → raise（防漏斗資料表異常）
--   - mode='public'（廣播）：用戶不在 → INSERT path='broadcast_imported' + stage=8
--   - GREATEST(path_stage, 8) 防 regress（既有 6/7 的人 submit 後升 8 不被 reset）
--   - partial unique index：同人同時間最多一筆 pending
--     → 廣播模式下，curl 偽造 userid 攻擊面從「無限筆」鎖到「最多一筆」
--
-- 部署順序（重要）：
--   constraint 在 RPC 之前 alter，避免 RPC 寫入時 constraint 還沒包含 'broadcast'
--   全包在 BEGIN/COMMIT 失敗 rollback，可重跑（DROP IF EXISTS / IF NOT EXISTS）
--
-- Rollback：
--   ALTER TABLE official_program_applications
--     DROP CONSTRAINT IF EXISTS official_program_applications_source_check;
--   ALTER TABLE official_program_applications
--     ADD CONSTRAINT official_program_applications_source_check
--     CHECK (source IN ('bot_q5', 'manual_offline', 'seminar', 'referral'));
--   DROP INDEX IF EXISTS idx_apps_pending_per_user;
--   DROP FUNCTION IF EXISTS submit_application(
--     TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, NUMERIC, TEXT
--   ) CASCADE;
--   -- 重跑 migration_018 還原舊 14 參數 RPC

BEGIN;

-- ============================================================
-- 1. ALTER source CHECK 加 'broadcast'
-- ============================================================
ALTER TABLE official_program_applications
  DROP CONSTRAINT IF EXISTS official_program_applications_source_check;

ALTER TABLE official_program_applications
  ADD CONSTRAINT official_program_applications_source_check
  CHECK (source IN ('bot_q5', 'manual_offline', 'seminar', 'referral', 'broadcast'));

COMMENT ON CONSTRAINT official_program_applications_source_check
  ON official_program_applications IS
  '報名來源：bot_q5=Q5漏斗 / manual_offline=後台代填 / seminar=說明會 / referral=轉介 / broadcast=廣播入口';

-- ============================================================
-- 2. partial unique index 防同人重複 pending
-- ============================================================
-- 保留同人多筆已 paid / cancelled 的歷史紀錄（家庭共用 / 真重新報名）
-- 但同時間只能一筆 pending：
--   - 防雙擊重複 submit（race lost）
--   - 廣播模式攻擊面保護（curl 偽造同 userid 多筆 pending 不行）
CREATE UNIQUE INDEX IF NOT EXISTS idx_apps_pending_per_user
  ON official_program_applications (line_user_id)
  WHERE status = 'pending';

COMMENT ON INDEX idx_apps_pending_per_user IS
  '同人同時間僅一筆 pending（migration_022，廣播入口攻擊面保護 + 防雙擊）';

-- ============================================================
-- 3. submit_application RPC 加 p_mode + upsert 分支
-- ============================================================
DROP FUNCTION IF EXISTS submit_application(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, NUMERIC
) CASCADE;

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
  p_final_price NUMERIC,
  p_mode TEXT DEFAULT 'private'  -- 'private'=HMAC 漏斗（既有）/ 'public'=廣播
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
  -- 1. SELECT 驗用戶是否存在（拿 path）
  SELECT path INTO v_user_path
  FROM official_line_users
  WHERE line_user_id = p_line_user_id;

  -- 2. 用戶不存在 → 分流
  IF NOT FOUND THEN
    IF p_mode = 'public' THEN
      -- 廣播模式：自動 upsert 用戶，path='broadcast_imported' 標明跳過漏斗
      INSERT INTO official_line_users (
        line_user_id, display_name, source, segment,
        path, path_stage,
        path_stage_updated_at, last_interaction_at
      ) VALUES (
        p_line_user_id, p_display_name, 'broadcast', 'active',
        'broadcast_imported', 8,
        NOW(), NOW()
      )
      ON CONFLICT (line_user_id) DO NOTHING;
      v_user_path := 'broadcast_imported';
    ELSE
      -- 漏斗模式：維持既有 raise（防漏斗資料表異常）
      RAISE EXCEPTION 'user_not_found: %', p_line_user_id USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- 3. INSERT applications
  -- 注意：partial unique index 擋同人重複 pending，會觸發 unique_violation (23505)
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

  -- 4. UPDATE users stage（GREATEST 防 regress — 既有 6/7 的人 submit 升 8，不被 reset）
  UPDATE official_line_users
  SET
    path_stage = GREATEST(path_stage, 8),
    enrolled_at = COALESCE(enrolled_at, NOW()),
    enrolled_from_path = COALESCE(enrolled_from_path, v_user_path),
    path_stage_updated_at = NOW(),
    last_interaction_at = NOW()
  WHERE line_user_id = p_line_user_id
  RETURNING enrolled_at INTO v_enrolled_at;

  -- 5. 查重複報名計數（給 UI 警示重複用，既有邏輯）
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
  'Q5 報名原子操作 v3（migration_022）：加 p_mode 雙模式分流 — public 模式自動 upsert path=broadcast_imported 用戶。partial unique 擋同人重複 pending。';

COMMIT;