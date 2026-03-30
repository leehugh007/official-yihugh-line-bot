-- migration_005: 支援 Flex Message 按鈕
-- official_push_templates 新增 buttons 欄位（取代單一 link_url + link_text）
ALTER TABLE official_push_templates
  ADD COLUMN IF NOT EXISTS buttons JSONB DEFAULT '[]';

-- official_push_logs 儲存推播時使用的按鈕（供排程推播重送時使用）
ALTER TABLE official_push_logs
  ADD COLUMN IF NOT EXISTS buttons JSONB DEFAULT '[]';
