-- migration_008a.sql — Phase 2b 契約 v6 定版
-- 用途：對話路徑契約 v6 的 schema 擴充（對用戶零影響）
-- 來源：official-yihugh-line-bot/契約_對話路徑.md 第 10.1 章
-- 無 BEGIN/COMMIT（Supabase MCP apply_migration 自動包 transaction）

-- A. official_line_users 加 2 欄
ALTER TABLE official_line_users
  ADD COLUMN IF NOT EXISTS last_stage5_reply_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handoff_rescue_notified BOOLEAN DEFAULT false;

-- B. official_reply_templates 加 3 欄
ALTER TABLE official_reply_templates
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS on_keyword_match JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS chain_next_id TEXT;

-- C. cron C 查詢複合 partial index（stage=5 rescue）
CREATE INDEX IF NOT EXISTS idx_users_stage5_rescue
  ON official_line_users (path_stage, handoff_triggered_at)
  WHERE path_stage = 5 AND handoff_rescue_notified = false;

-- D. v5 新增：webhook idempotency 表（LINE retry 防重複處理）
CREATE TABLE IF NOT EXISTS official_webhook_events (
  event_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at
  ON official_webhook_events(processed_at);

-- E. 22 個 official_settings INSERT（不覆蓋既有）
INSERT INTO official_settings (key, value) VALUES
  ('weight_diff_small_max', '5'),
  ('weight_diff_large_min', '15'),
  ('fallback_threshold', '2'),
  ('stage_timeout_days', '7'),
  ('reawaken_days', '14'),
  ('ai_tags_expire_days', '14'),
  ('handoff_notify_to', '["yixiu","wanxin"]'),
  ('handoff_rescue_notify_to', '["yixiu"]'),
  ('handoff_rescue_hours', '48'),
  ('meal_min_chars', '20'),
  ('postpartum_min_chars', '5'),
  ('multi_condition_max', '2'),
  ('min_msg_chars_for_ai', '3'),
  ('ai_call_timeout_ms', '10000'),
  ('handoff_keywords_price', '價格,費用,多少錢,怎麼報名,開課,下一期,報名,學費,方案'),
  ('handoff_keywords_family', '老公,先生,家人,老婆,一起,女友,男友,媽媽'),
  ('handoff_keywords_enroll', '我要報,我要試,直接買,我加入,報名我'),
  ('ai_polite_end_keywords', '太貴,沒預算,沒錢,先不用'),
  ('webhook_template_cache_ttl_sec', '60'),
  ('gemini_model_version', 'gemini-2.0-flash-lite-001'),
  ('contract_version', 'v6'),
  ('test_mode', 'true')
ON CONFLICT (key) DO NOTHING;
