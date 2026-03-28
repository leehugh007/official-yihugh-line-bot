-- Official LINE Bot 資料表
-- 在 Supabase SQL Editor 執行

-- ============================================================
-- 1. 用戶表
-- ============================================================
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
  is_blocked BOOLEAN DEFAULT FALSE,
  -- 標籤系統
  tags TEXT[] DEFAULT ARRAY['未報名減重班'], -- 標籤（用於排程過濾）
  -- 個人化排程
  drip_week INTEGER DEFAULT 0, -- 已推到第幾篇（0=還沒推）
  drip_next_at TIMESTAMPTZ, -- 下一次推送時間（null=排程未啟動）
  drip_paused BOOLEAN DEFAULT FALSE -- 停止排程（沉默用戶）
);

-- ============================================================
-- 2. 點擊追蹤表
-- ============================================================
CREATE TABLE IF NOT EXISTS official_line_clicks (
  id BIGSERIAL PRIMARY KEY,
  line_user_id TEXT, -- 可為 null（即時推播的匿名點擊）
  link_id TEXT NOT NULL,
  clicked_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. 推播模板表
-- ============================================================
CREATE TABLE IF NOT EXISTS official_push_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '📢',
  message TEXT NOT NULL,
  link_url TEXT,
  link_text TEXT,
  segments TEXT[] DEFAULT ARRAY['active', 'warm', 'new'],
  mode TEXT DEFAULT 'instant', -- instant | queued
  sort_order INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. 推播紀錄表
-- ============================================================
CREATE TABLE IF NOT EXISTS official_push_logs (
  id BIGSERIAL PRIMARY KEY,
  template_id TEXT,
  label TEXT, -- 顯示用名稱（模板名 or 自訂）
  message TEXT NOT NULL,
  link_url TEXT,
  link_id TEXT, -- 追蹤用
  segments TEXT[],
  mode TEXT DEFAULT 'instant',
  target_count INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'completed', -- completed | sending | failed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- 5. 推播佇列表（佇列模式用）
-- ============================================================
CREATE TABLE IF NOT EXISTS official_push_queue (
  id BIGSERIAL PRIMARY KEY,
  log_id BIGINT REFERENCES official_push_logs(id),
  line_user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending | sent | failed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

-- ============================================================
-- 6. 個人化排程表（每週文章推播）
-- ============================================================
CREATE TABLE IF NOT EXISTS official_drip_schedule (
  id BIGSERIAL PRIMARY KEY,
  step_number INTEGER NOT NULL UNIQUE, -- 第幾篇（1, 2, 3...）
  title TEXT NOT NULL, -- 文章標題（後台顯示用）
  message TEXT NOT NULL, -- 推播訊息內容
  link_url TEXT, -- 文章連結
  link_text TEXT DEFAULT '閱讀文章',
  delay_days INTEGER DEFAULT 7, -- 跟上一篇的間隔天數（第 1 篇用 1 = 加入後 1 天）
  send_hour INTEGER DEFAULT 8, -- 幾點發（台灣時間，24hr）
  exclude_tag TEXT DEFAULT '已報名減重班', -- 有這個 tag 就跳過
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. 排程推送紀錄（追蹤每次排程推送）
-- ============================================================
CREATE TABLE IF NOT EXISTS official_drip_logs (
  id BIGSERIAL PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  link_id TEXT, -- 追蹤用
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  clicked BOOLEAN DEFAULT FALSE,
  clicked_at TIMESTAMPTZ
);

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_official_users_segment ON official_line_users(segment);
CREATE INDEX IF NOT EXISTS idx_official_users_blocked ON official_line_users(is_blocked);
CREATE INDEX IF NOT EXISTS idx_official_users_source ON official_line_users(source);
CREATE INDEX IF NOT EXISTS idx_official_users_drip ON official_line_users(drip_next_at, drip_paused);
CREATE INDEX IF NOT EXISTS idx_official_users_tags ON official_line_users USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_official_drip_logs_user ON official_drip_logs(line_user_id);
CREATE INDEX IF NOT EXISTS idx_official_drip_logs_step ON official_drip_logs(step_number);
CREATE INDEX IF NOT EXISTS idx_official_clicks_user ON official_line_clicks(line_user_id);
CREATE INDEX IF NOT EXISTS idx_official_clicks_link ON official_line_clicks(link_id);
CREATE INDEX IF NOT EXISTS idx_official_clicks_time ON official_line_clicks(clicked_at);
CREATE INDEX IF NOT EXISTS idx_official_queue_status ON official_push_queue(status);
CREATE INDEX IF NOT EXISTS idx_official_queue_log ON official_push_queue(log_id);
CREATE INDEX IF NOT EXISTS idx_official_logs_time ON official_push_logs(created_at DESC);

-- ============================================================
-- 預設模板（4 個常用推播）
-- ============================================================
INSERT INTO official_push_templates (id, name, icon, message, link_url, link_text, segments, mode, sort_order) VALUES
(
  'broadcast_live',
  '開播通知',
  '📢',
  '說明會即將開始囉！' || E'\n\n' || '今天會完整介紹 ABC 代謝重建瘦身法的原理和課程內容。' || E'\n\n' || '準備好了就點擊下方連結進入直播 👇',
  'https://example.com/live',
  '進入直播',
  ARRAY['active', 'warm', 'new'],
  'instant',
  1
),
(
  'signup_link',
  '報名連結',
  '📝',
  '如果你覺得 ABC 代謝重建瘦身法適合你，可以直接點擊下方連結報名 👇' || E'\n\n' || '名額有限，報名後會有專人跟你確認。',
  'https://example.com/signup',
  '立即報名',
  ARRAY['active', 'warm', 'new'],
  'instant',
  2
),
(
  'replay',
  '回放連結',
  '🎬',
  '錯過了上次的說明會嗎？' || E'\n\n' || '沒關係，回放連結在這裡 👇' || E'\n\n' || '完整了解 ABC 代謝重建瘦身法的原理和課程內容。',
  'https://example.com/replay',
  '觀看回放',
  ARRAY['active', 'warm'],
  'queued',
  3
),
(
  'spots_reminder',
  '名額提醒',
  '🎯',
  '上次說明會後，有釋出少數報名名額 🙂' || E'\n\n' || '如果你有興趣，可以直接點擊下方連結報名。' || E'\n\n' || '名額有限，額滿就關閉囉！',
  'https://example.com/signup',
  '我要報名',
  ARRAY['active', 'warm'],
  'queued',
  4
);

-- ============================================================
-- 預設排程文章（6 篇，一休再來調整內容和連結）
-- ============================================================
INSERT INTO official_drip_schedule (step_number, title, message, link_url, link_text, delay_days, send_hour) VALUES
(1, '一休校長減重故事', '（待填入訊息內容）', 'https://example.com/article-1', '閱讀文章', 1, 8),
(2, '花10萬打瘦瘦針', '（待填入訊息內容）', 'https://example.com/article-2', '閱讀文章', 7, 8),
(3, '溫溫的故事', '（待填入訊息內容）', 'https://example.com/article-3', '閱讀文章', 7, 8),
(4, '節食，是這個世界...', '（待填入訊息內容）', 'https://example.com/article-4', '閱讀文章', 7, 8),
(5, '慧敏的故事', '（待填入訊息內容）', 'https://example.com/article-5', '閱讀文章', 7, 8),
(6, '偷偷暴食，你以為...', '（待填入訊息內容）', 'https://example.com/article-6', '閱讀文章', 7, 8);

-- ============================================================
-- 8. 設定表（關鍵字回覆、歡迎訊息等可從後台編輯的文字）
-- ============================================================
CREATE TABLE IF NOT EXISTS official_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 推播排程欄位（支援預約推播）
-- ============================================================
ALTER TABLE official_push_logs
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
