-- migration_015: Q1 漏接修復 — 新增 3 個 partial-match template + 改 q1_retry_weight 文案
-- 2026-04-24 / 對應 extractPartialWeight 函式（lib/conversation-path.js）
--
-- 背景：Yun 類用戶（stage=1）打單數字「52」「64」被 q1_retry_weight 「還少兩個數字」
--       無限循環，Becky 類（stage=0 + source=protein/quiz）打「瘦3公斤」靜默漏接。
-- 解法：extractPartialWeight 抓到 diff/current/target 任一 → 回對應反問 template。
--
-- 規則（對齊 migration_008b）：
--   ON CONFLICT 只更新結構欄位，不更新 buttons/image_url/is_active（婉馨後台編輯區）
--   is_active=true（立即生效，這三條是漏接修復，不需要 FlexPreview）
--   q1_retry_weight 的文案改「給具體範例」

INSERT INTO official_reply_templates (
  id, path, stage, condition, label, message_template,
  chain_next_id, on_keyword_match, buttons, image_url, is_active
) VALUES

-- Q1 partial_current：用戶只給了 current（例：「52」「58公斤」「我現在58」）
-- 反問 target 讓用戶補完另一個數字
('q1_partial_current', NULL, 1, 'partial_current', 'Q1・只給現在體重',
$tpl${current} — 這個是你現在的體重對嗎？
那你想瘦到幾公斤？
再給我一個數字我就能幫你抓方向。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, true),

-- Q1 partial_target：用戶只給了 target（例：「瘦到50」「目標48」「降到60」）
-- 反問 current 讓用戶補完
('q1_partial_target', NULL, 1, 'partial_target', 'Q1・只給目標體重',
$tpl$想瘦到 {target} 公斤 — 那你現在大概幾公斤？
兩個數字我都需要才看得出該怎麼幫你。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, true),

-- Q1 partial_diff：用戶只給了 diff（例：「瘦3公斤」「-5kg」「想瘦10」）
-- 反問 current 讓用戶補完（有 diff 沒 current 無法算 target）
('q1_partial_diff', NULL, 1, 'partial_diff', 'Q1・只給想瘦的公斤數',
$tpl$想瘦 {diff} 公斤 — 那你現在大概幾公斤？
告訴我你目前的體重，我才看得出該怎麼幫你抓。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, true)

ON CONFLICT (id) DO UPDATE SET
  path = EXCLUDED.path,
  stage = EXCLUDED.stage,
  condition = EXCLUDED.condition,
  label = EXCLUDED.label,
  message_template = EXCLUDED.message_template,
  chain_next_id = EXCLUDED.chain_next_id,
  on_keyword_match = EXCLUDED.on_keyword_match;
  -- 不更新 buttons / image_url / is_active

-- 改 q1_retry_weight 文案：加具體範例讓用戶照抄
-- 原文案「想幫你抓方向，還少兩個數字 — 你現在大概幾公斤、想瘦到幾公斤？直接給我兩個數字就好。」
-- 新文案給範例「回我像這樣就好：『我現在 58，想瘦到 50』」降低打字阻力
UPDATE official_reply_templates
SET message_template = $tpl$想幫你抓方向，要兩個數字才能看 —
你可以這樣回我：「我現在 58，想瘦到 50」
直接告訴我你目前幾公斤、想瘦到幾公斤？$tpl$
WHERE id = 'q1_retry_weight';
