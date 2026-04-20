-- migration_008c.sql — 基於 4月班學員自我介紹回饋的迭代（v6 → v6.1）
-- 三個結構性調整（不動 path enum / 不動 state machine）：
--
--   1. UPDATE q2_path_choice：選項 B 擴充涵蓋「年紀到了代謝變差」，末段加動機問題
--      動機：14 位學員裡 4 位主訴更年期/年紀代謝（瓊宜/陳靜韋/Rita/Penny），
--      且全部都有明確的「為誰 / 為什麼」動機（為女兒、為拍照、為健康）
--
--   2. INSERT path_b_menopause（stage=4, condition='menopause_or_age'）
--      動機：這群人 Q2 會選 B（復胖），但走到 stopped/stress/unknown 都不精準
--      ABC 核心賣點是「荷爾蒙 + 代謝」，這條模板直擊
--
--   3. UPDATE path_e_fallback 共情領先
--      動機：瓊宜原話「嘗試過太多方法…心好累」，現有「先看兩個故事」太冷
--      改成 mirror「心會累，我懂 — 不是你不夠努力」直接 bridge
--
-- is_active=false 全數保持，不動 webhook（Phase 2b 範圍）。
-- 模板總數 40 → 41。

-- (1) q2_path_choice 改選項 B + 加動機 open loop
UPDATE official_reply_templates SET
  message_template = $tpl$你想開始瘦，主要是為了哪個？

A 健檢紅字、想把數字壓回來
B 以前瘦過又復胖，或年紀到了代謝變差，想結束這個循環
C 產後一直瘦不回來
D 外食族、怎麼吃都搞不定

或有其他狀況直接講，我看看。

對了，順便跟我說 —
這次想瘦下來，你最想做的第一件事是什麼？$tpl$,
  updated_at = now()
WHERE id = 'q2_path_choice';

-- (2) 新增 path_b_menopause（更年期 / 年紀代謝）
INSERT INTO official_reply_templates (
  id, path, stage, condition, label, message_template,
  chain_next_id, on_keyword_match, buttons, image_url, is_active
) VALUES (
  'path_b_menopause', 'rebound', 4, 'menopause_or_age', '路徑B・更年期/年紀代謝',
  $tpl$這不是你「變懶了」，是荷爾蒙變了 —
更年期前後雌激素開始下降，代謝、睡眠、情緒全部會跟著變。
加上年紀一到，身體對食物的反應就是跟 30 歲不一樣，吃一樣的份量更容易存下來。
硬用以前的方法會越做越挫折，不是你的問題，是方法已經不適合這個階段的身體。
ABC 會同時處理代謝和荷爾蒙，讓身體重新平衡 — 不是跟它對抗。$tpl$,
  NULL, '{}'::jsonb, '[]'::jsonb, NULL, false
)
ON CONFLICT (id) DO UPDATE SET
  path = EXCLUDED.path,
  stage = EXCLUDED.stage,
  condition = EXCLUDED.condition,
  label = EXCLUDED.label,
  message_template = EXCLUDED.message_template,
  chain_next_id = EXCLUDED.chain_next_id,
  on_keyword_match = EXCLUDED.on_keyword_match,
  updated_at = now();

-- (3) path_e_fallback 共情領先
UPDATE official_reply_templates SET
  message_template = $tpl$試了這麼多方法，心會累，我懂 —
不是你不夠努力，是方法一直在跟身體對抗。
先看這兩個故事，跟你狀況很像。
看完有感覺再跟我說，不急。$tpl$,
  updated_at = now()
WHERE id = 'path_e_fallback';
