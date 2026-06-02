-- Migration 025: 排程文章類型欄位
-- 日期：2026-06-02
--
-- 目的：
-- 1. 讓每篇 drip 排程文章可標記文章類型
-- 2. 讓受眾再行銷可精準判斷「學員故事 / 健康文章」點擊
-- 3. 保留後續成效分析與交互影響判斷所需欄位

ALTER TABLE official_drip_schedule
  ADD COLUMN IF NOT EXISTS article_type TEXT NOT NULL DEFAULT 'other';

ALTER TABLE official_drip_schedule
  DROP CONSTRAINT IF EXISTS official_drip_schedule_article_type_check;

ALTER TABLE official_drip_schedule
  ADD CONSTRAINT official_drip_schedule_article_type_check
  CHECK (article_type IN ('student_story', 'health_article', 'intro', 'method', 'apply', 'other'));

CREATE INDEX IF NOT EXISTS idx_official_drip_schedule_article_type
  ON official_drip_schedule (article_type);

COMMENT ON COLUMN official_drip_schedule.article_type IS
  '排程文章類型：student_story, health_article, intro, method, apply, other。用於受眾再行銷與文章成效分析。';
