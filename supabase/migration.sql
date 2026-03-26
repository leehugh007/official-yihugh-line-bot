-- Official LINE Bot 資料表
-- 在 Supabase SQL Editor 執行

-- 用戶表
CREATE TABLE IF NOT EXISTS official_line_users (
  line_user_id TEXT PRIMARY KEY,
  display_name TEXT,
  metabolism_type TEXT, -- highRPM | rollerCoaster | burnout | powerSave | steady
  source TEXT DEFAULT 'direct', -- quiz | direct | seminar
  segment TEXT DEFAULT 'new', -- new | active | warm | silent
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  last_interaction_at TIMESTAMPTZ DEFAULT NOW(),
  last_push_click_at TIMESTAMPTZ,
  interaction_count INTEGER DEFAULT 0,
  push_click_count INTEGER DEFAULT 0,
  is_blocked BOOLEAN DEFAULT FALSE
);

-- 點擊追蹤表
CREATE TABLE IF NOT EXISTS official_line_clicks (
  id BIGSERIAL PRIMARY KEY,
  line_user_id TEXT REFERENCES official_line_users(line_user_id),
  link_id TEXT NOT NULL, -- 辨識是哪個推播連結，例如 'seminar_apr', 'article_highRPM'
  clicked_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_official_users_segment ON official_line_users(segment);
CREATE INDEX IF NOT EXISTS idx_official_users_blocked ON official_line_users(is_blocked);
CREATE INDEX IF NOT EXISTS idx_official_users_source ON official_line_users(source);
CREATE INDEX IF NOT EXISTS idx_official_clicks_user ON official_line_clicks(line_user_id);
CREATE INDEX IF NOT EXISTS idx_official_clicks_link ON official_line_clicks(link_id);
CREATE INDEX IF NOT EXISTS idx_official_clicks_time ON official_line_clicks(clicked_at);
