-- migration_008d.sql — Phase 3.1 push 前 yi-challenge + user-eye iteration
-- 三項改動：
-- 1. 關 q1_init / path_e_guide_just_know / path_e_fallback 的 is_active
--    原因：Phase 3.1 dispatch 沒實作對應觸發
--    → 啟用了但永遠不觸發 = 假 active。Phase 3.2/3.3 真接上再開
-- 2. q2_weight_large 語氣：去掉「幅度很大 / 比你狀況更糟」的當頭一棒感
--    user-eye 44+ 女性視角：被「更糟」比較會強化羞恥感
-- 3. q1_target_invalid：拿掉「正常順序」的糾正感，改口語
--
-- 同時啟用 10 條 Phase 3.1 dispatch 會用到的模板 is_active=true：
-- q1_target_invalid / q1_retry_weight / q2_weight_small/medium/large / q2_path_choice
-- path_a_q3 / path_b_q3 / path_c_q3 / path_d_q3

UPDATE official_reply_templates
SET is_active = true, updated_at = now()
WHERE id IN (
  'q1_target_invalid',
  'q1_retry_weight',
  'q2_weight_small',
  'q2_weight_medium',
  'q2_weight_large',
  'q2_path_choice',
  'path_a_q3',
  'path_b_q3',
  'path_c_q3',
  'path_d_q3'
);

UPDATE official_reply_templates
SET is_active = false, updated_at = now()
WHERE id IN ('q1_init', 'path_e_guide_just_know', 'path_e_fallback');

UPDATE official_reply_templates SET
  message_template = $tpl$想瘦 {diff} 公斤不是小事，但絕對做得到。
我帶過不少底子比你更辛苦的學員，都瘦回來過。
關鍵不是一下瘦多少，是代謝底盤要先打好，
這次才是最後一次。$tpl$,
  updated_at = now()
WHERE id = 'q2_weight_large';

UPDATE official_reply_templates SET
  message_template = $tpl$你給我的是「{current} 公斤 想到 {target} 公斤」—
是不是順序打反了？再跟我說一次就好。$tpl$,
  updated_at = now()
WHERE id = 'q1_target_invalid';
