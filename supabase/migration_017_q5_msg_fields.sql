-- migration_017: 結單漏斗 v3.2 自動推進 16 個欄位
-- 對應契約：契約_自動推進漏斗v32.md v3 Ch.2.1
-- 目的：自動推 4 段訊息（intro/method/offer/final）→ /apply 報名
-- 範圍：official_line_users 加 16 欄（msg1-4 sent/replied/maybe/question_at + last_pushed_at + apply_from_msg）
--
-- 執行：Supabase MCP apply_migration 或 Dashboard SQL Editor
-- 已驗證：information_schema 確認 16 欄位全部不存在無衝突（2026-05-04）

ALTER TABLE official_line_users
  -- 訊息 1（intro）：path × 4 個版本，承接學員故事 + 鋪陳 ABC
  ADD COLUMN IF NOT EXISTS q5_msg1_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS q5_msg1_replied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS q5_msg1_maybe_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS q5_msg1_question_at TIMESTAMPTZ,
  -- 訊息 2（method）：純介紹 ABC 三框架（path 中立）
  ADD COLUMN IF NOT EXISTS q5_msg2_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS q5_msg2_replied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS q5_msg2_maybe_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS q5_msg2_question_at TIMESTAMPTZ,
  -- 訊息 3（offer）：12 週課程 + 三段價 + URI 跳 /apply（path 中立）
  ADD COLUMN IF NOT EXISTS q5_msg3_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS q5_msg3_maybe_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS q5_msg3_question_at TIMESTAMPTZ,
  -- 訊息 4（final）：最後提醒（path 中立）
  ADD COLUMN IF NOT EXISTS q5_msg4_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS q5_msg4_maybe_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS q5_msg4_question_at TIMESTAMPTZ,
  -- 全域節流（一天最多推一則）
  ADD COLUMN IF NOT EXISTS q5_last_pushed_at TIMESTAMPTZ,
  -- 點擊歸因（訊息 3 vs 訊息 4 區分，由 /apply/visit 解析 ?from=msg3/msg4 寫入）
  ADD COLUMN IF NOT EXISTS q5_apply_from_msg TEXT;

-- CHECK 約束：q5_apply_from_msg 只能是 msg3 / msg4 / NULL（防 URL ?from=anything 寫垃圾）
-- 對齊 migration_013 enum CHECK pattern。0 成本最後防線。
ALTER TABLE official_line_users
  DROP CONSTRAINT IF EXISTS chk_q5_apply_from_msg,
  ADD CONSTRAINT chk_q5_apply_from_msg
    CHECK (q5_apply_from_msg IS NULL OR q5_apply_from_msg IN ('msg3', 'msg4'));

-- COMMENT 說明（給未來 session 看 schema 時有上下文）
COMMENT ON COLUMN official_line_users.q5_msg1_sent_at IS
  '訊息 1（intro）推送時間。webhook q4_story_interested handler reply 時寫入。pushMsg1 race guard。';
COMMENT ON COLUMN official_line_users.q5_msg1_replied_at IS
  '訊息 1 用戶按「想知道 ABC 怎麼運作」(intro_next) 時寫入。量測訊息 1→2 轉換率。';
COMMENT ON COLUMN official_line_users.q5_msg1_maybe_at IS
  '訊息 1 用戶按「我再想想」(intro_maybe) 時寫入。永久不再 cron 推。';
COMMENT ON COLUMN official_line_users.q5_msg1_question_at IS
  '訊息 1 用戶按「我有問題想問」(intro_question) 時寫入 + triggerHandoff(q5_msg1_question)。';

COMMENT ON COLUMN official_line_users.q5_msg2_sent_at IS
  '訊息 2（method，純介紹 ABC）推送時間。postback intro_next 即時推 / cron 段 5 24h 推進。';
COMMENT ON COLUMN official_line_users.q5_msg2_replied_at IS
  '訊息 2 用戶按「想看 12 週怎麼安排」(method_next) 時寫入。';
COMMENT ON COLUMN official_line_users.q5_msg2_maybe_at IS
  '訊息 2「我再想想」(method_maybe)。';
COMMENT ON COLUMN official_line_users.q5_msg2_question_at IS
  '訊息 2「我有問題想問」(method_question)。';

COMMENT ON COLUMN official_line_users.q5_msg3_sent_at IS
  '訊息 3（offer，課程+早鳥+URI）推送時間。postback method_next 即時 / cron 段 6 24h 推進。同次寫入升 path_stage=6（決策 6 配合既有 visit handler 6→7）。';
COMMENT ON COLUMN official_line_users.q5_msg3_maybe_at IS
  '訊息 3「我再想想」(offer_maybe)。';
COMMENT ON COLUMN official_line_users.q5_msg3_question_at IS
  '訊息 3「我有問題想問」(offer_question)。';

COMMENT ON COLUMN official_line_users.q5_msg4_sent_at IS
  '訊息 4（final，最後提醒）推送時間。postback offer_next 即時 / cron 段 7 24h 推進。';
COMMENT ON COLUMN official_line_users.q5_msg4_maybe_at IS
  '訊息 4「我再想想」(final_maybe)。';
COMMENT ON COLUMN official_line_users.q5_msg4_question_at IS
  '訊息 4「我有問題想問」(final_question)。';

COMMENT ON COLUMN official_line_users.q5_last_pushed_at IS
  '全域節流戳記。任何 q5_msg{N}_sent_at 寫入時同步寫。cron 段 5/6/7 SQL 條件：q5_last_pushed_at IS NULL OR < NOW() - INTERVAL ''23 hours''。';
COMMENT ON COLUMN official_line_users.q5_apply_from_msg IS
  '點擊歸因 metadata：msg3 / msg4 / NULL（CHECK 約束強制）。/apply/visit handler 解析 URL ?from= 寫入。COALESCE 首次寫入不覆蓋。不參與 HMAC sig（攻擊者篡改只影響 metric 不影響 auth）。量測訊息 3 vs 訊息 4 點擊率區分。';

-- =============================================================================
-- Rollback（出事時用）— 對齊 migration_013 pattern
-- =============================================================================
--
-- ALTER TABLE official_line_users
--   DROP CONSTRAINT IF EXISTS chk_q5_apply_from_msg,
--   DROP COLUMN IF EXISTS q5_msg1_sent_at,
--   DROP COLUMN IF EXISTS q5_msg1_replied_at,
--   DROP COLUMN IF EXISTS q5_msg1_maybe_at,
--   DROP COLUMN IF EXISTS q5_msg1_question_at,
--   DROP COLUMN IF EXISTS q5_msg2_sent_at,
--   DROP COLUMN IF EXISTS q5_msg2_replied_at,
--   DROP COLUMN IF EXISTS q5_msg2_maybe_at,
--   DROP COLUMN IF EXISTS q5_msg2_question_at,
--   DROP COLUMN IF EXISTS q5_msg3_sent_at,
--   DROP COLUMN IF EXISTS q5_msg3_maybe_at,
--   DROP COLUMN IF EXISTS q5_msg3_question_at,
--   DROP COLUMN IF EXISTS q5_msg4_sent_at,
--   DROP COLUMN IF EXISTS q5_msg4_maybe_at,
--   DROP COLUMN IF EXISTS q5_msg4_question_at,
--   DROP COLUMN IF EXISTS q5_last_pushed_at,
--   DROP COLUMN IF EXISTS q5_apply_from_msg;
--
-- 注意：DROP COLUMN 也是 metadata-only（無 default value），毫秒級。
--       既有 row 的 NULL 值會直接消失。沒副作用。
