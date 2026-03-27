-- 來源管理表
-- 在 Supabase SQL Editor 執行

CREATE TABLE IF NOT EXISTS official_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 預設來源
INSERT INTO official_sources (id, name, url) VALUES
('quiz', '測驗', NULL),
('direct', '直接加入', 'https://lin.ee/ApHSqCU'),
('live', '直播加入', 'https://lin.ee/AKxO2Nz'),
('legacy', 'Bot 上線前加入', NULL)
ON CONFLICT (id) DO NOTHING;
