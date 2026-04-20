-- migration_008b.sql — Phase 2c 40 條模板 seed（契約 v6 附錄 B）
-- 用途：seed 40 條對話路徑模板，全部 is_active=false（婉馨後台 FlexPreview 確認後再啟用）
-- 來源：official-yihugh-line-bot/契約_對話路徑.md 附錄 B + 附錄 F
-- 文案來源：Bot對話設計_2026-04-18_定版.md L97-324 + 附錄 F 補齊
--
-- 規則（契約 10.2）：
--   - ON CONFLICT 只更新結構欄位（path/stage/condition/label/message_template/chain_next_id/on_keyword_match）
--   - **刻意不更新** buttons / image_url / is_active（這三欄是婉馨後台編輯區）
--   - message_template 用 dollar quoting $tpl$...$tpl$ 避免中文引號轉義
--
-- Retry 類 6 條（F.2/F.3/F.4/F.5/F.6/F.8）原契約「同 v3」未補全文字，
-- 本 migration 依一休語感 draft，is_active=false 不觸發，婉馨 FlexPreview 會再改。

INSERT INTO official_reply_templates (
  id, path, stage, condition, label, message_template,
  chain_next_id, on_keyword_match, buttons, image_url, is_active
) VALUES

-- === Q1 階段（5 條）===
('q1_init', NULL, 1, 'init', 'Q1・破冰',
$tpl$報告看完了嗎？
先跟我說一下 — 你現在幾公斤，想瘦到幾公斤？
我看看你狀況，幫你抓個方向。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('q1_reawaken', NULL, 1, 'reawaken', 'Q1・喚醒舊用戶',
$tpl$好一陣子沒聊了 — 你狀況還好嗎？
先跟我說一下，你現在幾公斤、想瘦到幾公斤？
我再幫你抓方向。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('q1_retry_weight', NULL, 1, 'retry_weight', 'Q1・追問體重',
$tpl$想幫你抓方向，還少兩個數字 —
你現在大概幾公斤、想瘦到幾公斤？
直接給我兩個數字就好。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('q1_target_invalid', NULL, 1, 'weight_target_invalid', 'Q1・目標無效',
$tpl$你給我的是「{current} 公斤 想到 {target} 公斤」—
是不是打反了？
正常順序：現在體重、目標體重。
再跟我說一次。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

-- === Q2 階段（4 條）===
('q2_weight_small', NULL, 2, 'weight_diff_small', 'Q2・差距≤5',
$tpl${diff} 公斤不算多。
但關鍵不在這次瘦下來，在瘦完不再回來。
很多人減過很多次，問題是沒有一次是最後一次。$tpl$,
'q2_path_choice', '{}'::jsonb, '[]'::jsonb, NULL, false),

('q2_weight_medium', NULL, 2, 'weight_diff_medium', 'Q2・差距5-15',
$tpl$想瘦 {diff} 公斤，幅度不小，但做得到。
重點不是這次能瘦幾公斤 —
是瘦完之後，能不能穩穩維持，這次就是最後一次。$tpl$,
'q2_path_choice', '{}'::jsonb, '[]'::jsonb, NULL, false),

('q2_weight_large', NULL, 2, 'weight_diff_large', 'Q2・差距>15',
$tpl$想瘦 {diff} 公斤，幅度很大。
我帶過比你狀況更糟的學員瘦回來過。
關鍵不是一下瘦多少，是代謝底盤要先打好，
這次才是最後一次。$tpl$,
'q2_path_choice', '{}'::jsonb, '[]'::jsonb, NULL, false),

('q2_path_choice', NULL, 2, 'path_choice', 'Q2・主因選項',
$tpl$你想開始瘦，主要是為了哪個？

A 健檢紅字、想把數字壓回來
B 以前瘦過又復胖、想結束這個循環
C 產後一直瘦不回來
D 外食族、怎麼吃都搞不定

或有其他狀況直接講，我看看。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

-- === 路徑 A：健檢紅字（8 條）===
('path_a_q3', 'healthCheck', 3, 'q3', '路徑A・Q3問紅字',
$tpl$紅字哪幾項？多選 OK，也可以直接回數字。

A 血糖 / 糖化血色素
B 膽固醇 / 三酸甘油脂
C 血壓
D 肝指數

順便講一下 — 醫生有沒有叫你開始吃藥？$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_a_retry', 'healthCheck', 3, 'retry', '路徑A・追問',
$tpl$再告訴我多一點 —
是哪一項紅字？血糖、膽固醇、血壓、還是肝？
有沒有開始吃藥？$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_a_blood_sugar', 'healthCheck', 4, 'blood_sugar', '路徑A・血糖紅',
$tpl$血糖紅不只是數字，是胰島素已經開始失衡 — 這叫胰島素阻抗（白話講就是身體處理糖分的效率變差了）。
繼續下去會越來越難瘦、越吃越餓，身體在發警報。
好消息是這可以重建，不用一輩子吃藥。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_a_cholesterol', 'healthCheck', 4, 'cholesterol', '路徑A・膽固醇紅',
$tpl$八成膽固醇是身體自己做的，不是油吃太多 —
真正的原因是「身體在發炎」。
ABC 的 C 就在處理這個。
少吃油沒用，要先把發炎降下來。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_a_blood_pressure', 'healthCheck', 4, 'blood_pressure', '路徑A・血壓紅',
$tpl$血壓跟代謝綁在一起。
代謝重建起來，血壓通常會跟著回正常。
吃藥是壓症狀不是解因 — 我很多學員 3 個月停藥的。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_a_on_meds', 'healthCheck', 4, 'on_meds', '路徑A・已吃藥',
$tpl$吃藥壓的是數字，原因還在。
有學員 3 個月把紅字拉回正常就停藥 — 他做的不是吃更少，是吃對。
蛋白質拉足、發炎降下來、胰島素敏感度回來（白話講就是身體處理食物的效率）。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_a_no_meds', 'healthCheck', 4, 'no_meds', '路徑A・未吃藥',
$tpl$現在是黃金期。
早 3 個月處理，跟拖到要吃藥 5 年後再處理，差別非常大。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_a_outro', 'healthCheck', 4, 'outro', '路徑A・結尾',
$tpl$想看怎麼做的嗎？直接回我「了解」就好。$tpl$,
NULL, '{"了解":"high_intent","怎麼做":"high_intent"}'::jsonb, '[]'::jsonb, NULL, false),

-- === 路徑 B：復胖（6 條）===
('path_b_q3', 'rebound', 3, 'q3', '路徑B・Q3問復胖',
$tpl$先問你兩個 — 之前最瘦到幾公斤？維持了多久？
然後是怎麼回來的？

A 停掉那個方法，慢慢就回來了
B 壓力大吃回去
C 就...不知道怎麼回事回來了

直接說也 OK。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_b_retry', 'rebound', 3, 'retry', '路徑B・追問',
$tpl$再多講一點 —
你最瘦過幾公斤？維持了多久？
怎麼回來的？是停了方法、還是壓力大？$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_b_stopped', 'rebound', 4, 'stopped', '路徑B・停方法就回',
$tpl$這不是你沒意志力 — 是節食把你的代謝壓低了。
你一回到正常吃，體重自然就回來，因為代謝還沒修好。
很多人減肥成功過，但只成功過一次，就是這個原因。
ABC 的做法是先把代謝重建起來再瘦，瘦完正常吃也不會回。
這才是最後一次。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_b_stress', 'rebound', 4, 'stress', '路徑B・壓力型',
$tpl$壓力一大就想吃，這不是你沒意志力 — 是荷爾蒙在影響你。
壓力大皮質醇（壓力荷爾蒙）會升高，身體就開始想要高糖高油的東西，這是生存機制。
我們要解決的不是叫你忍 — 是讓壓力大的時候，荷爾蒙也能正常運作，不用一直靠意志力撐到最後爆發。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_b_unknown', 'rebound', 4, 'unknown', '路徑B・不知道怎回',
$tpl$很多人最後都會問一個問題 —
「我也沒吃特別多，怎麼就默默胖回去了？」
不是你吃太多，是代謝已經開始失衡了。
胖回來，其實是身體在發訊號。
要學的不是少吃，是把代謝重建起來。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_b_outro', 'rebound', 4, 'outro', '路徑B・結尾',
$tpl$想聽這套方法嗎？$tpl$,
NULL, '{"想了解":"high_intent","學員故事":"high_intent"}'::jsonb, '[]'::jsonb, NULL, false),

-- === 路徑 C：產後（7 條，含 retry 拆兩條）===
('path_c_q3', 'postpartum', 3, 'q3', '路徑C・Q3問狀況',
$tpl$生完多久？小孩現在多大？
你現在最影響你的是哪一點？

A 時間真的不夠
B 知道該吃但不知道怎麼開始
C 還在哺乳不敢亂動

直接講也可以。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_c_retry_q3', 'postpartum', 3, 'retry', '路徑C・Q3 追問',
$tpl$再多跟我講一點你的狀況 —
生完多久？小孩多大？
哪裡最卡你？時間、方法、還是哺乳？$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_c_retry_q4_short', 'postpartum', 4, 'retry_short', '路徑C・stage4 字數不夠追問',
$tpl$想到什麼直接跟我說，不急。
你現在的狀況、時間、心情、哪裡卡住，都可以講。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_c_time', 'postpartum', 4, 'time', '路徑C・時間',
$tpl$媽媽帶小孩卡時間，我懂。
產後瘦不回來不是你懶 — 是生完荷爾蒙還沒調回來，加上長期睡不飽。
身體在這個狀態下，硬用以前的方法根本行不通。
先看一下溫溫的故事，跟你狀況很像。
看完有感覺我們再聊。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_c_method', 'postpartum', 4, 'method', '路徑C・方法',
$tpl$產後的身體跟產前完全不一樣 —
荷爾蒙還沒完全調回來，身體對食物的反應也變了，白話講就是吃一樣的份量更容易胖。
硬用以前的方法一定撞牆。
先看這篇，產後代謝要注意的三件事。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_c_breastfeeding', 'postpartum', 4, 'breastfeeding', '路徑C・哺乳',
$tpl$哺乳期不能亂節食 — 奶量跟營養都要顧好。
有專門給哺乳媽媽的方法，不是少吃，是吃對。
先看這篇。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_c_outro', 'postpartum', 4, 'outro', '路徑C・結尾（不急成交）',
$tpl$看完有感覺再回來跟我說，不急。$tpl$,
NULL, '{"__ANY__":"postpartum_returned"}'::jsonb, '[]'::jsonb, NULL, false),

-- === 路徑 D：外食族（3 條）===
('path_d_q3', 'eatOut', 3, 'q3', '路徑D・Q3問吃法',
$tpl$你平常大致怎麼吃？先簡單說一下是哪種型態：

A 三餐都外面（超商 / 便當 / 小吃 / 早餐店）
B 早午外食、晚上自己煮
C 外食為主但有時自煮
D 其他

選好後跟我具體講一下你常吃什麼 —
早餐、午餐、晚餐舉幾個例子，
我幫你看看有什麼可以調整的。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_d_retry_meal_detail', 'eatOut', 3, 'retry', '路徑D・追問餐點細節',
$tpl$具體一點比較好抓 —
早餐大概吃什麼？午餐呢？晚餐呢？
隨便寫都可以，我看得懂。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

-- path_d_ai_meal_feedback 是 DYNAMIC：message_template 存 AI prompt 骨架（renderTemplate 會檢查 isDynamic 不套變數）
('path_d_ai_meal_feedback', 'eatOut', 4, 'ai_meal_feedback', '路徑D・AI讀餐點（DYNAMIC）',
$tpl$讀用戶分享的餐點 → 找一個最明顯的血糖穩定相關問題
→ 白話指出（避免術語或術語配白話翻譯）
→ 帶到「我們教的不是菜單，是怎麼在各種場景選對組合」
→ 延伸到聚餐 / 旅遊 / 應酬都能用$tpl$,
NULL, '{"想學":"high_intent","課程細節":"high_intent"}'::jsonb, '[]'::jsonb, NULL, false),

-- === 路徑 E：其他（8 條）===
('path_e_drug', 'other', 3, 'drug', '路徑E・減肥藥',
$tpl$吃過什麼？停了多久？
減肥藥不管停多久，代謝都會被壓得更低 — 那才是真正復胖的原因。
你狀況多講一點，我看看該怎麼重建。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_e_ozempic', 'other', 3, 'ozempic', '路徑E・瘦瘦針',
$tpl$瘦瘦針是在考慮、還是已經打過？
打過的人我看過一個共通點：停針就反彈。
因為瘦下來的是「食慾被壓住」，不是「代謝變好」。
先看這篇，了解瘦瘦針的代價再決定。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_e_appearance', 'other', 3, 'appearance', '路徑E・外觀焦慮',
$tpl$體脂高、肚子大，通常不是胖 — 是代謝在囤積。
建議你先做一下代謝測驗，看自己是哪種類型，再決定下一步。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_e_guide_lazy', 'other', 3, 'guide_lazy', '路徑E・引導懶',
$tpl$懶通常不是原因 — 很多時候是身體已經累了。
你之前有試過什麼方法嗎？還是最近健康有什麼狀況？$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_e_guide_looks', 'other', 3, 'guide_looks', '路徑E・引導想變好看',
$tpl$想變好看沒問題。
但我問你 — 你是想瘦一陣子穿漂亮衣服，還是想瘦一輩子不用每年再來一次？
你平常常外食嗎？有健康警訊嗎？$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_e_guide_nothing', 'other', 3, 'guide_nothing', '路徑E・引導沒什麼',
$tpl$那我換個問法 —
你最近一次量體重，比去年同期是胖還是瘦？
為什麼？$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_e_guide_just_know', 'other', 3, 'guide_just_know', '路徑E・引導只是想了解',
$tpl$了解可以，我問你兩個問題幫你釐清 —
你現在幾公斤，想瘦到幾公斤？
瘦了之後最想改變生活裡哪一塊？$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false),

('path_e_fallback', 'other', 3, 'fallback', '路徑E・連續不命中',
$tpl$不急著回答，先看一下這兩個故事，你看完再跟我說。$tpl$,
NULL, '{}'::jsonb, '[]'::jsonb, NULL, false)

ON CONFLICT (id) DO UPDATE SET
  path = EXCLUDED.path,
  stage = EXCLUDED.stage,
  condition = EXCLUDED.condition,
  label = EXCLUDED.label,
  message_template = EXCLUDED.message_template,
  chain_next_id = EXCLUDED.chain_next_id,
  on_keyword_match = EXCLUDED.on_keyword_match,
  updated_at = NOW()
-- **刻意不更新** buttons, image_url, is_active（這三欄是婉馨後台編輯區）
;
