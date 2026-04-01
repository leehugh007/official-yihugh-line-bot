-- migration_006: 推播 + 排程支援圖片
-- Storage bucket: push-images（公開讀取）
-- 三張表加 image_url 欄位

-- 1. Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('push-images', 'push-images', true)
ON CONFLICT (id) DO NOTHING;

-- 2. 欄位
ALTER TABLE official_push_logs ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE official_push_templates ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE official_drip_schedule ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 3. Storage policies
CREATE POLICY "Public read push-images" ON storage.objects
  FOR SELECT USING (bucket_id = 'push-images');
CREATE POLICY "Service role upload push-images" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'push-images');
