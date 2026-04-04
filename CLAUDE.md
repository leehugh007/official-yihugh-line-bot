# 一休官方 LINE Bot — 專案上下文

> 每次開新對話請先讀這份。

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
│   └── supabase.js                # Supabase client
└── supabase/
    ├── migration.sql              # 建表 SQL（001 基礎）
    ├── migration_002_sources.sql  # 來源管理表
    ├── migration_003_settings.sql # 設定表 + 排程欄位
    ├── migration_004_push_logs_extra.sql # push_logs 加 exclude_enrolled
    ├── migration_005_flex_message.sql    # templates + push_logs 加 buttons JSONB
    └── migration_006_image_support.sql  # Storage bucket + 三張表加 image_url
```

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
8. **TEST_MODE** — webhook/route.js 第 47 行，`true` = 只有白名單收到回覆（代碼領取除外），改 `false` 全開
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
- **Cron Job**: 每小時整點（`0 * * * *`）執行 `/api/cron/drip`（Drip 排程 + 到期 scheduled push）

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
- 測試→正式切換：只要換 LINE 的兩個環境變數 + 更新 webhook URL

## 待做（依優先順序）

1. TEST_MODE 改 false（測試完成後正式上線）
2. 婉馨填入排程文章內容和連結（後台操作）
3. 舊模板升級 Flex 按鈕（後台編輯）
4. 追蹤漏斗優化後轉換率（對比 19% baseline，見 `ABC瘦身業務/代謝測驗漏斗追蹤.md`）
5. 未來：自建報名頁 + 金流串接
6. 未來：TEST_MODE 改到 official_settings 表，後台可開關
