-- migration_010_remove_q2_open_loop.sql — Phase 3.3
--
-- 背景：
-- migration_008c（04-20，Phase 3.1 時期）在 q2_path_choice 末段加了動機 open loop
-- 「對了，順便跟我說 — 這次想瘦下來，你最想做的第一件事是什麼？」
--
-- Phase 3.2c redesign（04-22）把 Q3 改成 1/2/3/4 選項後，
-- 這個 open loop 成為孤兒：
--   1. webhook Q2 分支（route.js:708-740）只接 A/B/C/D，自由文字靜默 return false
--   2. Q4 prompt（buildFinalFeedbackPrompt）參數無該回答欄位
--   3. 用戶認真回答 → Bot 不回，感覺被冷處理
--   4. 違反 Phase 3.2c 核心原則「Q1/Q2/Q3 = 純選項低阻力，Q4 AI 綜合爆發」
--
-- 本次改動：拿掉末段兩行 open loop，保留 A/B/C/D 選項 + 「或有其他狀況直接講，我看看。」
-- 不動 code、不動 state machine。

UPDATE official_reply_templates SET
  message_template = $tpl$你想開始瘦，主要是為了哪個？

A 健檢紅字、想把數字壓回來
B 以前瘦過又復胖，或年紀到了代謝變差，想結束這個循環
C 產後一直瘦不回來
D 外食族、怎麼吃都搞不定

或有其他狀況直接講，我看看。$tpl$,
  updated_at = now()
WHERE id = 'q2_path_choice';
