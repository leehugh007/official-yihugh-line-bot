-- migration_007: AI 對話路徑系統 — Phase 1（users 擴充 + reply_templates）
--
-- 依據：Bot對話設計_2026-04-18_定版.md Section 4（含 yi-challenge 補丁）
-- 執行日期：2026-04-18
-- 狀態：Phase 1（chat_history 表留到 Phase 3 跟 webhook 邏輯一起上）
--
-- 避坑補丁（雙 agent Opus 挑戰結論）：
--   - ai_tags_updated_at: 抄阿算 insights 14 天過期，避免 journey 重生
--   - path_stage_updated_at: stage timeout cron 基準，避免永久冷凍
--   - enrolled_from_path / enrolled_at: 10%→15% 北極星成交歸因量測
--   - is_active DEFAULT false: 承襲 04-04 Drip placeholder 事故教訓
--
-- 執行前狀態：official_line_users 273 row（2026-04-18 列表查詢確認）
-- 風險：ADD COLUMN 無 DEFAULT 常數 = metadata-only，瞬間完成，不重寫 row
-- 回滾：DROP COLUMN IF EXISTS / DROP TABLE IF EXISTS，無資料損失（新欄位是 NULL）

-- ==================================================================
-- 1. 擴充 official_line_users（12 個欄位 = 8 核心 + 4 補丁）
-- ==================================================================

ALTER TABLE official_line_users
  -- 核心欄位（原定版 8 個）
  ADD COLUMN IF NOT EXISTS current_weight NUMERIC,
  ADD COLUMN IF NOT EXISTS target_weight NUMERIC,
  ADD COLUMN IF NOT EXISTS path TEXT,
  ADD COLUMN IF NOT EXISTS path_stage INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_user_reply_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_tags JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS handoff_triggered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handoff_reason TEXT,
  -- 避坑補丁
  ADD COLUMN IF NOT EXISTS ai_tags_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS path_stage_updated_at TIMESTAMPTZ,
  -- 北極星量測
  ADD COLUMN IF NOT EXISTS enrolled_from_path TEXT,
  ADD COLUMN IF NOT EXISTS enrolled_at TIMESTAMPTZ;

-- 值域（code 層約束，DB 不加 CHECK 以保留調整彈性）：
--   path: 'healthCheck' | 'rebound' | 'postpartum' | 'eatOut' | 'other' | NULL
--   path_stage: 0=未進 / 1=Q1 / 2=Q2 / 3=Q3 / 4=Q4 已導向
--   handoff_reason: 'asked_price' | 'asked_family' | 'high_intent' | 'postpartum_returned' | 'manual'
--   ai_tags: { 痛點:[], 猶豫:[], 意願:'high|medium|low', 關注:[] }
--   enrolled_from_path: 與 path 同值域（snapshot 成交時的路徑）

-- ==================================================================
-- 2. 新表 official_reply_templates（對話模板，後台可編輯）
-- ==================================================================

CREATE TABLE IF NOT EXISTS official_reply_templates (
  id TEXT PRIMARY KEY,                      -- 'q1_init' / 'q2_weight_small' / 'path_a_blood_sugar' ...
  path TEXT,                                -- 'healthCheck' | 'rebound' | 'postpartum' | 'eatOut' | 'other' | NULL（通用）
  stage INTEGER,                            -- 0 | 1 | 2 | 3 | 4
  condition TEXT,                           -- 'weight_diff_small' | 'blood_sugar' | NULL
  message_template TEXT NOT NULL,           -- 含 {current}{target}{diff}{user_meal} 等變數
  buttons JSONB DEFAULT '[]'::jsonb,        -- Flex 按鈕 [{label, url_or_postback, linkId}]
  image_url TEXT,                           -- Flex hero 圖
  is_active BOOLEAN DEFAULT false,          -- 04-04 Drip placeholder 事故教訓：啟用前必須 FlexPreview 確認
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Partial index：webhook 每則訊息查模板時，只掃 is_active=true 的 row
CREATE INDEX IF NOT EXISTS idx_official_reply_templates_lookup
  ON official_reply_templates(path, stage, condition)
  WHERE is_active = true;

-- ==================================================================
-- 3. Phase 1 範圍外（延後到 Phase 3 跟 webhook 邏輯一起上）
-- ==================================================================
-- official_chat_history（對話記錄表）— 見 Phase 3 migration
-- 原因：path_at_time / stage_at_time 快照欄位在 Phase 4 AI 上線前都是 NULL
-- 綁 webhook 一起建，上線即有資料
