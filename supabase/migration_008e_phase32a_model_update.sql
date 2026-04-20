-- Phase 3.2a：把 gemini_model_version 從 deprecated 的 gemini-2.0-flash-lite-001
-- 切到 gemini-2.5-flash-lite（官方 current / budget 選擇，非 preview）
--
-- Yi-Challenge 發現：
-- 1. gemini-2.0-flash-lite-001 已被 Google 標記 deprecated，列在 Previous models
-- 2. 2.0 flash-lite 對 thinkingConfig 支援不明確（非 thinking model），拔掉
-- 3. 阿算 Bot 改用 gemini-3.1-flash-lite-preview，但 preview 不穩
--    → 本專案選 2.5 flash-lite（stable budget tier）

UPDATE official_settings
SET value = 'gemini-2.5-flash-lite',
    updated_at = NOW()
WHERE key = 'gemini_model_version';

-- 驗證：
-- SELECT key, value FROM official_settings WHERE key = 'gemini_model_version';
-- 期望：value='gemini-2.5-flash-lite'
