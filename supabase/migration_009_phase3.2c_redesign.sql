-- migration_009_phase3.2c_redesign.sql
-- Phase 3.2c 重新詮釋：Q3 改 1/2/3/4 選項（非自由打字），Q4 改單一通用 DYNAMIC
-- 設計（一休 2026-04-22 定調）：
--   Q1/Q2/Q3 = 純選項收資訊（低阻力）
--   Q4 = AI 綜合前三題產個人化回饋（必含：痛點重述 + 原因白話 + ABC 洞察 + 結果 framing + 輕推方案）
-- 變更：
--   1. UPDATE 4 條 Q3 模板 message_template（改成 1/2/3/4 選項，拿掉自由描述引導）
--   2. INSERT 新 Q4 通用 DYNAMIC `path_all_q4_feedback`（path=NULL, condition='ai_final_feedback', is_active=false 等 FlexPreview）
--   3. 舊靜態 Q4 模板不動（保留備用，反正都 is_active=false）

-- === 1a. path_a_q3（healthCheck）===
UPDATE official_reply_templates
SET message_template = $tpl$你的紅字是哪個？回數字就好：

1 血糖／糖化血色素
2 膽固醇／三酸甘油脂
3 血壓
4 不只一個紅字$tpl$,
    updated_at = now()
WHERE id = 'path_a_q3';

-- === 1b. path_b_q3（rebound）===
UPDATE official_reply_templates
SET message_template = $tpl$你這次復胖，最貼近哪個？回數字就好：

1 停掉某個方法就胖回來（停藥／停運動／停節食）
2 壓力來就暴食
3 不知道為什麼就胖了
4 更年期或年紀大代謝變差$tpl$,
    updated_at = now()
WHERE id = 'path_b_q3';

-- === 1c. path_c_q3（postpartum）===
UPDATE official_reply_templates
SET message_template = $tpl$你最卡的是？回數字就好：

1 時間不夠（顧小孩沒時間）
2 試過方法都沒效
3 哺乳中，怕影響奶量$tpl$,
    updated_at = now()
WHERE id = 'path_c_q3';

-- === 1d. path_d_q3（eatOut）===
UPDATE official_reply_templates
SET message_template = $tpl$你最大的困擾是？回數字就好：

1 不知道外食怎麼選才對
2 知道要吃好但抗拒不了誘惑
3 三餐都外食，不知道怎麼開始
4 工作忙，沒時間煮也沒時間選$tpl$,
    updated_at = now()
WHERE id = 'path_d_q3';

-- === 2. 新 Q4 通用 DYNAMIC 模板 ===
INSERT INTO official_reply_templates (
  id, path, stage, condition, label, message_template,
  chain_next_id, on_keyword_match, buttons, image_url, is_active
) VALUES (
  'path_all_q4_feedback',
  NULL,
  4,
  'ai_final_feedback',
  '全路徑・Q4 最終 AI 回饋（DYNAMIC，通用）',
  $tpl$任務：看完用戶 Q1/Q2/Q3 資訊，產一段 120-220 字的個人化回饋。

結構（每段必須有）：
1. 重述痛點（讓他感覺「你懂我」）— 用他的具體資訊（幾公斤、差幾公斤、哪條 path、Q3 選的狀況）
2. 解釋為什麼卡（科學 + 白話，帶他走因果推導，不是堆結論）
3. ABC 方法方向（不給菜單，給洞察，跟他選的狀況直接相關）
4. 結果 framing（學員結果／瘦一輩子／不復胖 擇一自然帶出）
5. 輕推方案（「想不想看我們怎麼幫這種學員做的」故事導向，不是「想了解費用嗎」方案導向）$tpl$,
  NULL,
  '{"想了解":"high_intent","想看":"high_intent","怎麼做":"high_intent","了解":"high_intent"}'::jsonb,
  '[]'::jsonb,
  NULL,
  false
)
ON CONFLICT (id) DO UPDATE SET
  message_template = EXCLUDED.message_template,
  on_keyword_match = EXCLUDED.on_keyword_match,
  updated_at = now();
