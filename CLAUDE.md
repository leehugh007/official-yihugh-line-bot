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
│   └── api/
│       ├── webhook/route.js       # LINE Webhook（follow/unfollow/message）
│       ├── push/route.js          # 推播 API（管理用）
│       ├── track/r/route.js       # 連結追蹤轉址
│       └── stats/route.js         # 統計 API
├── lib/
│   ├── line.js                    # LINE API 工具（reply/push/multicast/verify）
│   ├── keywords.js                # 關鍵字規則 + 代謝報告模板
│   ├── users.js                   # 用戶 CRUD + 分層邏輯
│   ├── tracking.js                # 連結追蹤（wrapLink/logClick）
│   ├── config.js                  # 可編輯設定（說明會、歡迎訊息）
│   └── supabase.js                # Supabase client
└── supabase/
    └── migration.sql              # 建表 SQL
```

## 關鍵字規則

| 關鍵字 | 回覆 |
|--------|------|
| 報告、代謝報告、我的類型 | 個人化代謝報告（根據 metabolism_type） |
| 方案、價格、費用、多少錢 | 課程方案介紹 |
| 說明會、直播、講座 | 說明會資訊（從 config.js 讀取） |
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

## Supabase 資料表

- `official_line_users` — 用戶（line_user_id, metabolism_type, segment, interaction_count...）
- `official_line_clicks` — 點擊紀錄（line_user_id, link_id, clicked_at）

## 設計決策

1. **不用 AI** — 關鍵字比對就夠，零 API 成本
2. **不回覆 = 功能** — 沒匹配關鍵字就靜默，不干擾一休的手動回覆
3. **每人獨立追蹤連結** — 推播時每人的 URL 帶各自的 userId，追蹤到個人
4. **分層存 Supabase** — 不用 Redis（量小、不需要快取、需要持久化）
5. **config.js 集中管理** — 說明會資訊、歡迎訊息等一休常改的東西，都在一個檔案

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

## 待做（依優先順序）

1. 一休開通 Messaging API，拿到 credentials
2. 部署到 Vercel
3. 在 Supabase 跑 migration.sql
4. 設定 LINE webhook URL
5. 改測驗結果頁的 CTA（帶 ref 參數）
6. 測試完整流程
7. 未來：自建報名頁 + 金流串接
