-- Migration 019: V3.2 三段價邏輯（加一般早鳥階段）
-- 日期：2026-05-04
--
-- 業務時間軸：
--   ~5/18 超早鳥 $10,400
--   5/19~5/24 一般早鳥 $11,400
--   5/24 之後 原價 $12,600（**真實成交**，不再是純錨點）
--
-- 改動：
--   1. 加 regular_early_bird_cutoff_at setting（預設 5/24 23:59 +08）
--   2. 改 super_early_bird_cutoff_at 預設從 5/31 改成 5/18 23:59 +08
--
-- 不動 schema（applications 仍用既有 super_early_bird_applied + final_price + 程式 tier 邏輯）
--
-- Rollback:
--   DELETE FROM official_settings WHERE key = 'regular_early_bird_cutoff_at';
--   UPDATE official_settings SET value = '2026-05-31T15:59:59Z' WHERE key = 'super_early_bird_cutoff_at';

-- 1. 加一般早鳥截止日
INSERT INTO official_settings (key, value) VALUES
  ('regular_early_bird_cutoff_at', '2026-05-24T15:59:59Z')
ON CONFLICT (key) DO NOTHING;

-- 2. 改超早鳥截止日預設
UPDATE official_settings
SET value = '2026-05-18T15:59:59Z'
WHERE key = 'super_early_bird_cutoff_at';
