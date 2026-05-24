-- Migration 023: influence-principle funnel copy update
-- Date: 2026-05-24
--
-- Purpose:
--   Update DB-backed Q5 texts so production uses the lower-pressure
--   "fit confirmation" framing without changing schema or state machine.

INSERT INTO official_settings (key, value) VALUES
  (
    'q5_soft_invite_passive_text',
    '剛剛那些問題我都有看到。下一步不是要你立刻報名，是先讓 fifi 看你適不適合這一班。要先讓她幫你確認嗎？'
  ),
  (
    'q5_soft_invite_active_text',
    '之前跟你聊到的那些卡關，我有一套帶學員時在用的做法。你不用急著決定，可以先讓 fifi 看你適不適合。要先確認嗎？'
  ),
  (
    'q5_visit_followup_text',
    '我看到你剛剛有進去看介紹頁。
不用急著報名，我只是想確認你是不是卡在某個點。

你比較想先確認哪一個？
1. 價格 / 付款方式
2. 我適不適合
3. 時間 / 課程怎麼上
4. 要跟家人討論
5. 想直接問 fifi

直接回數字或文字都可以。'
  )
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
