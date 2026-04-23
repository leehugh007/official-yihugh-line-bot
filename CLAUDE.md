# 一休官方 LINE Bot — 專案上下文

> 每次開新對話請先讀這份。

## 🚀 Session 啟動必讀（按順序）

1. **`用戶旅程.md`** — A 軌 + B 軌 + 銜接鉤子 + 當前開放範圍矩陣 + 斷點清單。**不要再問「這個流程怎麼走」**，讀這份 2 分鐘就定位
2. **`交接_2026-04-23_Phase4.1-Session1完成.md`** — 最新交接文件，含當前 prod 狀態矩陣 + 下一 session 開工指令
3. 本檔（Schema 對齊 + 技術架構 + 設計決策）
4. `指揮中心.md` — 最近異動 + 待同步項目
5. `契約_對話路徑.md` v6.1（Q1-Q4 狀態機）+ `契約_Q5轉換漏斗.md` **v2.4**（HMAC signed URL + Q5 + /apply + applications）

Supabase 直連：**三 Bot 共用一個專案**，ref `fnlkhxnfaylhqhystmbr`（Dashboard 顯示名 coach-line-bot），MCP `mcp__supabase__execute_sql` 直接可用。

## 專案概述

在一休的官方 LINE 帳號「一休陪你健康瘦」上建立的輕量 Bot。
**不是全功能 AI Bot**，是關鍵字觸發的自動回覆 + 用戶分層推播系統。

**三層功能**：
1. 關鍵字自動回覆（零成本，純邏輯）
2. 測驗用戶接住（代謝報告 + 歡迎序列）
3. 分層推播（比官方後台精準，省訊息費）

**與其他 Bot 的區別**：
- 阿算（abc-line-bot）= 付費 AI 飲食教練，深度個人化
- 休校長小幫手（coach-line-bot）= 課程助教，知識問答
- **本 Bot** = 漏斗前端，接住測驗用戶，導向信任建立

## 技術架構

- **框架**: Next.js 14 (App Router)
- **部署**: Vercel
- **資料庫**: Supabase PostgreSQL（與阿算共用專案，official_ prefix 表）
- **AI**: 無（純關鍵字比對）
- **訊息平台**: LINE Messaging API（官方帳號「一休陪你健康瘦」）

## Credentials

- **LINE Channel Secret**: （一休開通 Messaging API 後填入）
- **LINE Channel Access Token**: （一休開通後填入）
- **Supabase URL**: 環境變數 SUPABASE_URL（與阿算共用）
- **Supabase Key**: 環境變數 SUPABASE_KEY（與阿算共用）
- **Admin Secret**: official-bot-2026
- **GitHub**: leehugh007/official-yihugh-line-bot

## 檔案結構

```
official-yihugh-line-bot/
├── app/
│   ├── page.js                    # 首頁（健康檢查）
│   ├── layout.js                  # Layout
│   ├── admin/page.js              # 管理後台（推播/紀錄/排程/用戶/設定 五個 Tab）
│   └── api/
│       ├── webhook/route.js       # LINE Webhook（follow/unfollow/message/代碼領取）
│       ├── admin/route.js         # 管理 API（stats/templates/push/settings/users/sources/toggle_drip_active/upload_image/update_log/delete_log）
│       ├── cron/drip/route.js     # Cron（每 10 分鐘）：Drip 逐筆 push（並發 20）+ 到期 scheduled push
│       ├── push/route.js          # 推播 API（管理用）
│       ├── track/r/route.js       # 連結追蹤轉址
│       └── stats/route.js         # 統計 API
├── lib/
│   ├── line.js                    # LINE API（reply/push/multicast/verify/pushFlexMessage + hero image）
│   ├── push.js                    # 排程推播發送邏輯（sendScheduledPush，cron 和 admin 共用）
│   ├── keywords.js                # 關鍵字規則（先讀 DB settings，fallback 到預設值）
│   ├── users.js                   # 用戶 CRUD + 分層邏輯
│   ├── tracking.js                # 連結追蹤（wrapLink/logClick）
│   ├── config.js                  # 預設設定（說明會、歡迎訊息）
│   ├── supabase.js                # Supabase client（default export）
│   ├── ai-classifier.js           # AI 分類器（Q4 綜合回饋 + Q5 intent）
│   ├── conversation-path.js       # B 軌對話路徑（Q1-Q4 狀態機核心邏輯）
│   ├── dynamic-templates.js       # 動態模板產生器（Q4 個人化回饋）
│   ├── handoff.js                 # 專人介入（Handoff）邏輯 + 通知一休/婉馨
│   ├── official-settings.js       # DB settings 讀取（official_settings 表）
│   ├── official-settings-defaults.js # settings 預設值
│   ├── q5-state.js                # Q5 狀態 helper（updateQ5Intent/performQ5Transition）
│   ├── q5-apply-url.js            # 🆕 Phase 4.1 HMAC signed URL helper（buildQ5ApplyUrl + verifyQ5ApplySig + shape whitelist + key version rotate）
│   └── templates.js               # 訊息模板（代謝報告/地雷/菜單等）
├── app/
│   ├── apply/                     # /apply LIFF landing page（Q5 報名入口，Phase 4.1 Session 3 套 landing 五章）
│   └── api/
│       ├── health/route.js        # Health check endpoint
│       └── apply/                 # 🆕 Phase 4.1
│           ├── visit/route.js     # POST 驗 HMAC → stage 6→7 + q5_click_count + q5_clicked_at COALESCE
│           └── submit/route.js    # POST 驗 HMAC + 表單 → submit_application RPC → stage=8
└── supabase/
    ├── migration.sql              # 建表 SQL（001 基礎）
    ├── migration_002_sources.sql  # 來源管理表
    ├── migration_003_settings.sql # 設定表 + 排程欄位
    ├── migration_004_push_logs_extra.sql # push_logs 加 exclude_enrolled
    ├── migration_005_flex_message.sql    # templates + push_logs 加 buttons JSONB
    ├── migration_006_image_support.sql  # Storage bucket + 三張表加 image_url
    ├── migration_007_conversation_paths.sql      # 對話路徑表 + reply_templates
    ├── migration_008a-e                          # Phase 2b-3.2a 迭代（5 個子版本）
    ├── migration_009_phase3.2c_redesign.sql      # Phase 3.2c Q3 改選項 + Q4 DYNAMIC
    ├── migration_010_remove_q2_open_loop.sql     # Q2 末段 open loop 移除
    ├── migration_011_blocked_at.sql              # blocked_at 欄位
    ├── migration_012_q5_state_fields.sql         # Q5 狀態欄位（5 個）
    ├── migration_013_q5_applications.sql         # 🆕 Phase 4.1 applications 表 + 3 欄 + 4 indexes
    └── migration_014_submit_application_rpc.sql  # 🆕 Phase 4.1 submit_application PL/pgSQL RPC
```

## 介面契約文件

| 契約 | 版本 | 狀態 | 範圍 |
|------|------|------|------|
| `契約_對話路徑.md` | v6.1 | 定版（Phase 3.2c redesign 後） | Q1-Q4 + Handoff 狀態機 |
| `契約_Q5轉換漏斗.md` | **v2.4** | Phase 4.1 Session 1 完成（HMAC 升級），Session 2/3 待接 | Q5 方案推進 + 自建 /apply + HMAC signed URL + applications 表 + submit RPC + 追蹤「點了沒報名」 |

## 關鍵字規則

| 關鍵字 | 回覆 |
|--------|------|
| 報告、代謝報告、我的類型 | 個人化代謝報告（根據 metabolism_type） |
| 方案、價格、費用、多少錢 | 課程方案介紹 |
| 說明會、直播、講座 | 說明會資訊（從 DB settings 讀取，後台可編輯） |
| 文章、推薦、想看 | 根據代謝類型推薦文章 |
| ABC、怎麼瘦、瘦身、減肥 | ABC 簡介 + 測驗連結 |
| 不匹配任何關鍵字 | **不回覆**（一休手動處理） |

## 用戶分層

| 分層 | 條件 | 推播策略 |
|------|------|---------|
| 🆕 new | 剛加入 | 歡迎序列 |
| 🔥 active | 互動 ≥5 次 | 每次推播 |
| 🟡 warm | 互動 1-4 次 | 正常推播 |
| 🧊 silent | 30 天無互動 | 降頻或停推 |

## 連結追蹤

所有從 LINE 發出的連結都透過 `/api/track/r` 轉址，記錄誰點了什麼。
用法：`wrapLink(原始URL, linkId, userId)` → 產生追蹤連結。

## 推播 API

```bash
curl -X POST https://official-yihugh-line-bot.vercel.app/api/push \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: official-bot-2026" \
  -d '{
    "segments": ["active", "warm"],
    "message": "📢 四月說明會來囉！",
    "linkUrl": "https://abcmetabolic.com/seminar",
    "linkId": "seminar_apr",
    "linkText": "立即報名"
  }'
```

## Supabase 資料表（Schema 對齊 — 唯一真相來源）

> **改程式碼前先對這張表。欄位不在這裡 = 不存在。要加欄位先改這份再改 code。**

### official_line_users
| 欄位 | 型別 | 預設值 | 說明 |
|------|------|--------|------|
| line_user_id | TEXT PK | — | LINE userId |
| display_name | TEXT | — | LINE 顯示名稱 |
| metabolism_type | TEXT | — | highRPM/rollerCoaster/burnout/powerSave/steady |
| source | TEXT | 'direct' | quiz/direct/seminar/live/自訂 |
| segment | TEXT | 'new' | new/active/warm/silent |
| joined_at | TIMESTAMPTZ | now() | 加入時間 |
| last_interaction_at | TIMESTAMPTZ | now() | 最後互動 |
| last_push_click_at | TIMESTAMPTZ | — | 最後點擊推播 |
| interaction_count | INTEGER | 0 | 互動次數 |
| push_click_count | INTEGER | 0 | 推播點擊次數 |
| is_blocked | BOOLEAN | false | 封鎖 |
| tags | TEXT[] | ['未報名減重班'] | 標籤（管理者/已報名減重班/有興趣） |
| drip_week | INTEGER | 0 | 已推到第幾篇 |
| drip_next_at | TIMESTAMPTZ | — | 下次排程推送 |
| drip_paused | BOOLEAN | false | 排程暫停 |
| current_weight | NUMERIC | — | [對話路徑] 目前體重 |
| target_weight | NUMERIC | — | [對話路徑] 目標體重 |
| path | TEXT | — | [對話路徑] healthCheck/rebound/postpartum/eatOut/other |
| path_stage | INTEGER | 0 | [對話路徑] 0=未進/1=Q1/2=Q2/3=Q3/4=Q4 |
| last_user_reply_at | TIMESTAMPTZ | — | [對話路徑] 用戶最後主動回覆時間 |
| ai_tags | JSONB | '{}' | [對話路徑] {痛點:[], 猶豫:[], 意願, 關注:[]} + Phase 3.2c redesign 後 q3_choice/q3_condition_selected/q4_classified_at/q4_condition='ai_final_feedback' — 寫入禁 SQL jsonb_set、走 lib/users.js。ALLOWED_KEYS 已在 Phase 3.3 PR #11 補齊 |
| handoff_triggered_at | TIMESTAMPTZ | — | [對話路徑] 專人介入觸發時間 |
| handoff_reason | TEXT | — | [對話路徑] want_enroll/asked_price/asked_family/high_intent/postpartum_returned/manual |
| ai_tags_updated_at | TIMESTAMPTZ | — | [避坑補丁] ai_tags 14 天重估基準（抄阿算 insights） |
| path_stage_updated_at | TIMESTAMPTZ | — | [避坑補丁] stage timeout cron 基準（>7天 stage 2/3 無互動 reset 0） |
| enrolled_from_path | TEXT | — | [北極星量測] 成交時 snapshot 當時 path |
| enrolled_at | TIMESTAMPTZ | — | [北極星量測] 成交時間 |
| blocked_at | TIMESTAMPTZ | — | [migration_011] Unfollow 發生時間（markBlocked 寫入） |
| q5_sent_at | TIMESTAMPTZ | — | [migration_012] Q5 軟邀請推送時間（race guard） |
| q5_followup_trigger_source | TEXT | — | [migration_012] 觸發來源：passive/active |
| q5_active_invite_sent_at | TIMESTAMPTZ | — | [migration_012] 主動軌 cron 推 Q5 時間戳 |
| q5_intent | TEXT | — | [migration_012] AI 分類結果：continue/decline/ai_failed |
| q5_classified_at | TIMESTAMPTZ | — | [migration_012] q5_intent 最後寫入時間 |
| q5_click_count | INTEGER | 0 NOT NULL | [migration_013] 總計點擊 /apply（含 LINE-to-LINE 分享污染，契約 v2.4 Ch.12.1a）|
| q5_clicked_at | TIMESTAMPTZ | — | [migration_013] 首次點擊 /apply（COALESCE，北極星 unique 量測）|
| q5_visit_followup_sent_at | TIMESTAMPTZ | — | [migration_013] cron/q5-visit-followup 推送時間 |

### official_program_applications（migration_013，Phase 4.1 建立）

| 欄位 | 型別 | 預設值 | 說明 |
|------|------|--------|------|
| id | BIGSERIAL PK | — | — |
| line_user_id | TEXT | — | 允許 NULL（manual_offline 來源可無 LINE）|
| real_name | TEXT NOT NULL | — | — |
| phone | TEXT NOT NULL | — | 台灣手機 `09XXXXXXXX` |
| email | TEXT NOT NULL | — | 格式驗證 |
| address | TEXT NOT NULL | — | — |
| gender | TEXT NOT NULL | — | CHECK in (male, female, other) |
| age | INTEGER NOT NULL | — | CHECK 18-99 |
| line_id | TEXT | — | 選填（沒透過 LINE URL 報名時手填）|
| display_name | TEXT | — | LINE 顯示名 |
| program_choice | TEXT NOT NULL | — | CHECK in (12weeks, 4weeks_trial) |
| agreed_refund_policy | BOOLEAN NOT NULL | — | 必須 true |
| source | TEXT NOT NULL | — | CHECK in (bot_q5, manual_offline, seminar, referral) |
| status | TEXT NOT NULL | 'pending' | CHECK in (pending, paid, cancelled) |
| submitted_at | TIMESTAMPTZ NOT NULL | now() | — |
| paid_at | TIMESTAMPTZ | — | — |
| notify_sent_at | TIMESTAMPTZ | — | — |
| notify_status | TEXT NOT NULL | 'pending' | CHECK in (pending, sent, failed, dead_letter) |
| notes | TEXT | — | — |

Indexes（**不加 UNIQUE** — 契約 Ch.2.1 明訂，支援家庭共用 LINE + 同人多次報名）：
`idx_apps_line_user` partial WHERE NOT NULL / `idx_apps_submitted` DESC / `idx_apps_status` / `idx_apps_phone`

### submit_application RPC（migration_014，PL/pgSQL）

`submit_application(p_line_user_id, p_real_name, p_phone, ...共 12 參數)` → `submit_application_result`
- 先 SELECT path 驗用戶存在，不存在 `RAISE P0002 user_not_found`
- INSERT applications（status=pending / notify_status=pending）
- UPDATE official_line_users (path_stage=8, enrolled_at=COALESCE, enrolled_from_path=COALESCE)
- 回傳 `(application_id, enrolled_at, other_apps_count, other_phone_count)` 給 client 警示重複

### official_reply_templates（migration_007，Phase 1 建立）
| 欄位 | 型別 | 預設值 | 說明 |
|------|------|--------|------|
| id | TEXT PK | — | 模板 ID（'q1_init'/'q2_weight_small'/'path_a_blood_sugar'...） |
| path | TEXT | — | healthCheck/rebound/postpartum/eatOut/other/NULL（通用） |
| stage | INTEGER | — | 0/1/2/3/4 |
| condition | TEXT | — | weight_diff_small/blood_sugar/... |
| message_template | TEXT | — | 含 {current}{target}{diff}{user_meal} 變數 |
| buttons | JSONB | '[]' | Flex 按鈕 [{label, url_or_postback, linkId}] |
| image_url | TEXT | — | Flex hero 圖 |
| is_active | BOOLEAN | false | 04-04 Drip 事故教訓：啟用前必須 FlexPreview 確認 |
| updated_at | TIMESTAMPTZ | now() | 更新時間 |

Partial index: `(path, stage, condition) WHERE is_active = true` — webhook 每則訊息查模板只掃啟用的 row。

### official_chat_history（Phase 3 建立，尚未執行）
- 對話記錄表，含 role/message/path_at_time/stage_at_time 快照欄位
- 執行順序延後原因：`path_at_time`/`stage_at_time` 在 Phase 4 AI 上線前為 NULL，綁 webhook 邏輯一起建避免空表期

### official_push_templates
| 欄位 | 型別 | 預設值 | 說明 |
|------|------|--------|------|
| id | TEXT PK | — | 模板 ID |
| name | TEXT | — | 模板名稱 |
| icon | TEXT | '📢' | 圖示 |
| message | TEXT | — | 訊息內容 |
| link_url | TEXT | — | 連結（舊模式） |
| link_text | TEXT | — | 連結文字（舊模式） |
| buttons | JSONB | [] | Flex 按鈕 [{label, url}] |
| image_url | TEXT | — | 推播頂部圖片 URL |
| segments | TEXT[] | ['active','warm','new'] | 預設推播分群 |
| mode | TEXT | 'instant' | instant/queued/scheduled |
| sort_order | INTEGER | 0 | 排序 |
| updated_at | TIMESTAMPTZ | now() | 更新時間 |

### official_push_logs
| 欄位 | 型別 | 預設值 | 說明 |
|------|------|--------|------|
| id | BIGSERIAL PK | — | — |
| template_id | TEXT | — | 來源模板 |
| label | TEXT | — | 顯示名稱 |
| message | TEXT | — | 訊息內容 |
| link_url | TEXT | — | 連結 |
| link_id | TEXT | — | 追蹤 ID |
| buttons | JSONB | [] | Flex 按鈕 |
| image_url | TEXT | — | 推播頂部圖片 URL |
| segments | TEXT[] | — | 推播分群 |
| mode | TEXT | 'instant' | 模式 |
| target_count | INTEGER | 0 | 目標人數 |
| sent_count | INTEGER | 0 | 送達人數 |
| status | TEXT | 'completed' | completed/sending/failed/scheduled |
| exclude_enrolled | BOOLEAN | false | 排除已報名 |
| scheduled_at | TIMESTAMPTZ | — | 排程時間 |
| created_at | TIMESTAMPTZ | now() | 建立時間 |
| completed_at | TIMESTAMPTZ | — | 完成時間 |

### official_push_queue
| 欄位 | 型別 | 說明 |
|------|------|------|
| id | BIGSERIAL PK | — |
| log_id | BIGINT FK | 對應 push_logs |
| line_user_id | TEXT | 目標用戶 |
| message | TEXT | 訊息 |
| status | TEXT | pending/sent/failed |
| created_at | TIMESTAMPTZ | — |
| sent_at | TIMESTAMPTZ | — |

### official_drip_schedule
| 欄位 | 型別 | 預設值 | 說明 |
|------|------|--------|------|
| id | BIGSERIAL PK | — | — |
| step_number | INTEGER UNIQUE | — | 第幾篇 |
| title | TEXT | — | 文章標題 |
| message | TEXT | — | 推播訊息 |
| link_url | TEXT | — | 文章連結 |
| link_text | TEXT | '閱讀文章' | 連結文字 |
| image_url | TEXT | — | 排程文章圖片 URL |
| delay_days | INTEGER | 7 | 間隔天數 |
| send_hour | INTEGER | 8 | 發送時間（台灣） |
| exclude_tag | TEXT | '已報名減重班' | 排除標籤 |
| is_active | BOOLEAN | true | 啟用 |
| created_at | TIMESTAMPTZ | now() | — |

### official_drip_logs
| 欄位 | 型別 | 說明 |
|------|------|------|
| id | BIGSERIAL PK | — |
| line_user_id | TEXT | 用戶 |
| step_number | INTEGER | 第幾篇 |
| link_id | TEXT | 追蹤 ID |
| sent_at | TIMESTAMPTZ | 推送時間 |
| clicked | BOOLEAN | 是否點擊 |
| clicked_at | TIMESTAMPTZ | 點擊時間 |

### official_line_clicks
| 欄位 | 型別 | 說明 |
|------|------|------|
| id | BIGSERIAL PK | — |
| line_user_id | TEXT | 可 null |
| link_id | TEXT | 追蹤 ID |
| clicked_at | TIMESTAMPTZ | 點擊時間 |

### official_sources
| 欄位 | 型別 | 說明 |
|------|------|------|
| id | TEXT PK | 來源 ID |
| name | TEXT | 來源名稱 |
| url | TEXT | 加入網址 |
| created_at | TIMESTAMPTZ | — |

### official_settings
| 欄位 | 型別 | 說明 |
|------|------|------|
| key | TEXT PK | 設定 key |
| value | TEXT | 設定值 |
| updated_at | TIMESTAMPTZ | — |

### quiz_sessions（共用）
代謝測驗結果，含 claim_code 供代碼領取。

### Supabase Storage
- **Bucket**: `push-images`（公開讀取）— 推播 + 排程文章的圖片

## 設計決策

1. **不用 AI** — 關鍵字比對就夠，零 API 成本
2. **不回覆 = 功能** — 沒匹配關鍵字就靜默，不干擾一休的手動回覆
3. **每人獨立追蹤連結** — 推播時每人的 URL 帶各自的 userId，追蹤到個人
4. **分層存 Supabase** — 不用 Redis（量小、不需要快取、需要持久化）
5. **關鍵字回覆 DB 優先** — keywords.js 先讀 official_settings 表，fallback 到 code 裡的預設值。後台「設定」Tab 可直接編輯
6. **代碼領取繞過測試模式** — 做完測驗的用戶傳代碼就能拿報告，不受 TEST_MODE 限制
7. **推播三種模式** — instant（即時 multicast 500 人一批）/ queued（逐筆發送）/ scheduled（指定時間，cron 每 10 分鐘掃描）
8. **TEST_MODE** — webhook/route.js 第 72 行，`false`（2026-04-23 PR #29 切）= 全量開放。`true` 時只有白名單收到回覆（代碼領取除外）
9. **Flex Message** — 推播支援 1-2 個按鈕，URL 完全隱藏，每個按鈕獨立追蹤點擊（linkId_b0 / linkId_b1）
10. **管理者標籤推播** — 勾「僅管理者」只推給有「管理者」tag 的人（一休 + 婉馨），測試不影響真實用戶
11. **代碼用戶自動進 Drip** — handleCodeClaim 建檔時設 drip_next_at，隔天開始收排程文章
12. **LINE ID** — 官方帳號 `@sososo`（專屬 ID），deep link: `line.me/R/oaMessage/%40sososo/?代碼`
13. **推播 + 排程支援圖片** — hero image 顯示在 Flex Message 頂部，圖片存 Supabase Storage `push-images` bucket，後台上傳
14. **Drip 逐筆 push + 個人追蹤** — 每人獨立 push（並發 20），帶個人化追蹤 URL（wrapLink 帶 userId）。全部用 Flex Message + 按鈕（連結不外露）。DB 批量寫入。132 人無效能問題，200 人/天也撐得住
15. **Drip 啟用驗證** — is_active 預設 false。啟用前 API 驗證：訊息非空/非 placeholder/連結非 example.com。後台點啟用會彈出 FlexPreview 預覽確認。cron 也有 placeholder 防呆（二層防禦）
16. **Drip 點擊統計** — 從 official_line_clicks 表統計（link_id = drip_N），去重到個人。取代舊的 drip_logs.clicked
17. **Cron 每 10 分鐘** — `*/10 * * * *`，排程推播最多延遲 10 分鐘（原本每小時最多延遲 59 分鐘）
18. **時間一律帶時區 +08:00** — Vercel serverless 跑 UTC，前端傳時間到 server 必須帶 `+08:00`。`datetime-local` 不帶時區會被 Supabase TIMESTAMPTZ 當 UTC 存，排程差 8 小時。用 DateTimePicker24 元件統一處理
19. **推播紀錄可編輯/刪除** — 僅限 `scheduled` 狀態的紀錄可編輯訊息和時間、可刪除（有二次確認）。已完成的紀錄不可改不可刪
20. **B 軌對話路徑** — Q1→Q4 狀態機，非 TEST_MODE 控制的用戶在特定觸發後進入。五條 path（healthCheck/rebound/postpartum/eatOut/other）
21. **Handoff 方案 C** — AI 二次判斷 + 關鍵字雙層攔截。觸發後 push 通知一休+婉馨（寫死 userId），不中斷用戶體驗
22. **Q4 DYNAMIC 綜合回饋** — ai-classifier.js 產生個人化回饋，取代固定模板。禁客服腔、必有 conviction
23. **A 軌關鍵字繞過 TEST_MODE** — 代碼領取 + 地雷/菜單/報告等 A 軌功能全量開放，不受 TEST_MODE 限制
24. **LIFF 簡化版** — /apply 只做 LIFF init，不驗 userId（LINE 2024 policy 做不到 server-side 驗證）
25. **Q5 前置基建** — blocked_at + q5_* 5 欄位先建，performQ5Transition 尚未 wire（Phase 4.2）
26. **postback 支援** — webhook 加 case 'postback'，Q5 按鈕用 postback 而非 URL，可追蹤+觸發 handoff
27. **HMAC signed URL（Phase 4.1 Session 1）** — 取代 LIFF userId 驗證（LINE 2024 policy 做不到）。lib/q5-apply-url.js 是 URL 產+驗唯一入口。canonical payload 字母序固定、shape whitelist 擋 payload injection（`trigger=passive&userid=U_victim`）、timingSafeEqual 防 timing attack、clock skew 5min、key version rotate（雙驗期 ≥ 25h）。不擋 LINE-to-LINE 分享污染（一休決策 Phase 4.5 觀察期再評估）
28. **HMAC Secret 走 Vercel env 不走 DB（Phase 4.1 Session 1）** — `Q5_APPLY_SIGNING_SECRET_V{n}` / `KEY_VERSION` / `SIG_MAX_AGE_SEC` 三個 env。理由：secret 不適合放 DB；max_age 走 env 避免 verify 熱路徑打 Supabase 50-200ms
29. **/api/apply/* body 不走 query（Phase 4.1 Session 1）** — POST body 每欄 primitive check 擋 array injection（`body={userid:['A','B']}`），query 在不同 parser 行為不一致
30. **錯誤 response 泛化（Phase 4.1 Session 1）** — HMAC 失敗所有 reason 統一回 `{error: 'invalid_signature'}` + 400，避免攻擊者 enum secret version / payload 結構；內部 console.warn 記錄真實 reason 供 debug
31. **Applications 不加 UNIQUE（Phase 4.1 Session 1）** — 支援家庭共用 LINE（老公+老婆共一個 userId 分別報名）+ 同 phone 二人各報一方案。Phase 4.5 觀察重複率嚴重再加手機驗證碼
32. **submit_application 原子 RPC（Phase 4.1 Session 1）** — PL/pgSQL 一次 transaction 做 INSERT applications + UPDATE users stage=8 + COALESCE 保護 enrolled_at/enrolled_from_path。含 `IF NOT FOUND RAISE P0002` 擋 UPDATE 0 rows 靜默成功

## 漏斗流程

```
代謝測驗（abc-website）
  ↓ 結果頁 open loop + 「加 LINE 領報告」
加入官方 LINE（帶 ref=quiz_類型）
  ↓ 歡迎訊息 + 代謝報告
用戶打關鍵字 → 自動回覆
  ↓
推播說明會（分層，帶追蹤連結）
  ↓ 點連結 → 記錄
報名頁（未來：自建 + 金流）
```

## 部署

- **Vercel**: push main = 自動部署（已接 GitHub Integration）
- **Vercel Project ID**: prj_EUcS8nb3GTcsgiYgQjdStILTrK9N
- **Vercel Team**: hughs-projects-1e597e4f (team_TjsHfN2RqcvIwZVqD3gBDHyu)
- **部署指令（手動）**: `vercel --prod --yes --token <token>`（token 見 memory/deployment-tokens.md）
- **Cron Job**: 每 10 分鐘（`*/10 * * * *`）執行 `/api/cron/drip`（Drip 排程 + 到期 scheduled push）

## 協作規則

### 誰做什麼
- **一休 + AI**：功能開發、架構決策、程式碼 review
- **婉馨**：內容設定（後台操作）、測試回報、簡單程式修改（透過 Claude Code + PR）

### Branch 規則
- `main` = 正式版，push = 自動部署。**不要直接在 main 上改東西**
- 改東西開 branch：`fix/描述` 或 `feature/描述`
- 改完開 PR → 一休 review → merge → 自動部署

### 改內容 vs 改程式碼
- 推播模板、排程文章、說明會資訊 → **後台改**（`/admin`），不需要動程式碼
- 關鍵字規則、回覆邏輯、新功能 → **改程式碼**，走 branch + PR

### 環境變數（在 Vercel 設定）
- `LINE_CHANNEL_SECRET` — LINE Messaging API
- `LINE_CHANNEL_ACCESS_TOKEN` — LINE Messaging API
- `SUPABASE_URL` — 與阿算共用
- `SUPABASE_KEY` — 與阿算共用
- `ADMIN_SECRET` — 後台密碼（official-bot-2026）
- `NEXT_PUBLIC_LIFF_ID` — LIFF app ID（2009872928-plrAZYbN）
- `Q5_APPLY_SIGNING_SECRET_V1` — 🆕 Phase 4.1 HMAC secret（openssl rand -base64 48 生）
- `Q5_APPLY_SIGNING_KEY_VERSION` — 🆕 Phase 4.1 當前 signing key version（`1`）
- `Q5_APPLY_SIG_MAX_AGE_SEC` — 🆕 Phase 4.1 URL 過期秒數（`86400`）
- 測試→正式切換：只要換 LINE 的兩個環境變數 + 更新 webhook URL

## 待做（依優先順序）

1. ~~TEST_MODE 改 false~~ ✅ 2026-04-23 PR #29 完成
2. ~~**Phase 4.1 Session 1**：migration_013/014 + SETTING_SCHEMA 三處同步 + HMAC helper + /api/apply/*~~ ✅ 2026-04-23 PR #32 完成
3. **Phase 4.1 Session 2**：`scripts/gen-q5-url.js`（dev-only 手動產 signed URL 測 happy path）+ `__tests__/q5-state.test.js` stateful mock（yi-challenge #6）
4. **Phase 4.1 Session 3**：/apply landing 五章 copy（先 `/yi-voice` 審 → SSR 套進 app/apply/page.js）
5. **Phase 4.2**：Q5 classifier wire — `lib/q5-classifier.js` + `lib/q5-message.js`（用 buildQ5ApplyUrl）+ webhook stage=4 分支 + performQ5Transition + 3 handler state 簽名
6. 婉馨填入排程文章內容和連結（後台操作）
7. 舊模板升級 Flex 按鈕（後台編輯）
8. 追蹤漏斗優化後轉換率（對比 19% baseline，見 `ABC瘦身業務/代謝測驗漏斗追蹤.md`）
9. 未來：TEST_MODE 改到 official_settings 表，後台可開關
