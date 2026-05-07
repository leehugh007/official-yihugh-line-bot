# 契約：/apply 廣播入口（雙模式設計）

> **建立**：2026-05-06（一休 + Claude yi-challenge 雙 agent 挑戰後定版）
> **死線**：5/14 上線 / 5/19 第一波群發
> **Owner**：婉馨（開發）+ Claude（review）+ 一休（merge）
> **基於**：婉馨原 PR #66 草案（已 merge 的是 sheet-sync 那部分） → 新提案 /apply-public → yi-challenge 抓 8 個致命洞 → 一休澄清商業流程 + 取捨 → 此契約定版

---

## 摘要（一句話）

把 `/apply` 改成雙模式分流（HMAC 沿用 OR 純信任 query userid 新加），不開 `/apply-public` 新路由，避免 Pattern 9 雙路徑必漏；用 `path='broadcast_imported'` 標明跳過漏斗的用戶；接受「冒名報名」攻擊面 ≈ 0 impact 的有意識取捨換低摩擦。

---

## 商業 context（為什麼做）

LINE 好友 5,000、DB 1,000（走漏斗的人），剩 4,000 老好友（拿過代謝報告但沒走 v3.2）完全進不了現有 `/apply`（HMAC sig 簽名卡死）。

業務需求：

| 場景 | 數量 | 死線 |
|------|------|------|
| 5/19 說明會後群發報名 | 5,000 人 | **5/14 上線** |
| 6/1 開課前釋出優惠群發 | 5,000 人 | 6/1 |
| 漏斗中斷後重新報名 | 偶發 | 持續 |
| 客服 1-on-1 轉介 | 偶發 | 持續 |

商業流程（一休 5/6 澄清 — Claude 之前誤解）：

```
全量 5,000 人群發（含說明會 / 報名連結）
  ↓ 既有 wrapLink + /api/track/r 追蹤點擊
打包「有點擊」名單
  ↓ 第二波針對點擊者發「額外名額」優惠
高意願用戶報名
```

群發本身 = H0 驗證 + 第一波收網合一，不需要 manual 試水溫（4,000 老好友沒分層資料無法 manual 抓）。

---

## 7 個設計決策（拍板紀錄，不變）

### 決策 1：不開新路由 `/apply-public`，把 `/apply` 改雙模式

**理由**：避免 Pattern 9（雙路徑必漏 — 未來改 form schema 兩處要改，必漏一處 = className 事故等級）

**對照踩過的雷洞 37（coach-line-bot className vs class_name）**：4/19 玉玲事件後止血沒根治、3 天後怡靜事件同一根因換面貌。兩個 endpoint 做同件事就是這個 pattern 的開端。

### 決策 2：純信任 client query userid，不驗 LIFF ID Token（一休 5/6 拍板）

**取捨**：

| 比較項 | 純信任 | 驗 ID Token |
|-------|--------|------------|
| 攻擊面 | 可 curl 冒名報名 | 堵住 |
| 摩擦 | 0（直接 vercel URL）| 真實流失（LIFF init 1-2s + LINE Login OAuth 跳轉 + 桌機登入問題）|
| 工程量 | ~10 行 shape check | ~150 行 + 申請 LINE Login channel + JWKS / verify endpoint |
| 死線可達 | ✅ 5/14 沒問題 | ⚠️ 申請 channel 1-2 工作日壓死線 |

**判斷理由（一休 5/6 原話）**：

- 「不太會有人分享給陌生人後對方來報名」（陌生人沒 context 不會寫表單）
- 「就算他真的報名了，他留下的資料我們也找得到」（phone/email 真實能 trace）
- LIFF Token = 增加摩擦 = 真實轉換流失，攻擊面 ≈ 0 impact

**保護**：partial unique index `(line_user_id) WHERE status='pending'` 防同人多筆 pending（攻擊只能佔一筆 row 不會擴散）。

**這個取捨是有意識的設計、不是漏洞** — 寫進 commit message + 本契約留紀錄，未來看到 code 的人知道這是設計取捨。

### 決策 3：跳過漏斗的用戶用 `path='broadcast_imported'` 標明

**對照踩過的雷 Pattern 4（命題框錯）**：直接 `stage=8 + path=NULL` 會破壞既有狀態機語意（cron / handler 看 path 邏輯會錯）。

**修法**：upsert RPC 創 user 時：

```sql
INSERT INTO official_line_users (
  line_user_id, path, path_stage, source, segment, joined_at,
  path_stage_updated_at, last_interaction_at
) VALUES (
  p_line_user_id,
  'broadcast_imported',  -- 明確標跳過漏斗
  8, 'broadcast', 'active', NOW(), NOW(), NOW()
)
ON CONFLICT (line_user_id) DO UPDATE SET
  path_stage = GREATEST(official_line_users.path_stage, 8),  -- 不 regress
  enrolled_at = COALESCE(official_line_users.enrolled_at, NOW()),
  enrolled_from_path = COALESCE(official_line_users.enrolled_from_path, 'broadcast_imported');
```

**`path='broadcast_imported'` 跟既有 4 種 path（healthCheck/rebound/postpartum/eatOut）區分**，cron / handler 看到這個值就知道「這人沒走 Q1-Q4，不要當漏斗用戶處理」。

### 決策 4：`source` enum 加 `'broadcast'`（不細分到活動）

**Phase 1 用單一 `'broadcast'`**，避免每辦一次活動都要 ALTER constraint + redeploy（Pattern 6 enum 漏判風險）。

**Phase 2 才細分**到活動級別（broadcast_0519_seminar / broadcast_0601_offer），用 server-side allowlist enum，不用 DB constraint（DB 仍維持單一 `'broadcast'`，metric 細分用 application notes 或新欄位）。

### 決策 5：`?source` server-side allowlist 防污染

```js
const SOURCE_ALLOWED = new Set(['bot_q5', 'broadcast']);
const sourceParam = params.get('source');
const source = SOURCE_ALLOWED.has(sourceParam) ? sourceParam : 'broadcast';
```

防 `?source=competitor_xxx` 之類 free-form 污染 statistics。

### 決策 6：applications 加 partial unique index 防重複 pending

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_apps_pending_per_user
  ON official_program_applications (line_user_id)
  WHERE status = 'pending';
```

**保留同人多筆已 paid / cancelled 的歷史紀錄**（家庭共用 LINE / 真重新報名），但**同時間只能有一筆 pending**。

冒名攻擊 / 重複 submit 都被擋住（會 race lost）。

### 決策 7：群發 URL 直接用 vercel URL，不用 LIFF URL

**Claude 5/6 之前建議用 LIFF URL（`liff.line.me/<id>?mode=public`）**，一休 5/6 反駁：

- LIFF init 慢 + LINE Login OAuth 跳轉 = 摩擦
- 桌機 LINE Web / 一般瀏覽器 / 用戶分享 — 直接 vercel URL 哪都能開

**最終決定**：群發訊息 multicast push，每人收到的訊息含個人化 URL：

```
https://official-yihugh-line-bot.vercel.app/apply?userid=Uxxx&source=broadcast
```

既有 `wrapLink` + `/api/track/r` 機制可重用（外層先記點擊 → 重定向到 /apply）。

---

## 路由設計

### `/apply` 雙模式分流邏輯

```
GET /apply 進來時，extractParams 判斷：

if (URL 含 sig 完整 6 欄 HMAC params) {
  // 漏斗模式（既有不動）
  走 verifyQ5ApplySig() 完整驗證
  渲染表單，submit 時 POST /api/apply/submit body 帶完整 HMAC params
}
else if (URL 含 userid + source='broadcast') {
  // 廣播模式（新加）
  shape check userid: /^U[0-9a-f]{32}$/
  shape check source: in ['broadcast']
  渲染表單，submit 時 POST /api/apply/submit body 帶 { userid, source: 'broadcast', mode: 'public' }
  // 不簽 HMAC，server 端純信任 query userid
}
else {
  顯示錯誤頁「連結無效」
}
```

### `/api/apply/submit` 雙模式分流邏輯

```
POST 進來時：

if (body 含 sig + 完整 HMAC 6 欄) {
  // 漏斗模式（既有不動）
  verifyQ5ApplySig(body)
  失敗 → 400 invalid_signature
}
else if (body.mode === 'public' && body.source === 'broadcast') {
  // 廣播模式（新加）
  shape check body.userid: /^U[0-9a-f]{32}$/
  失敗 → 400 invalid_userid
  // 不驗 sig
}
else {
  400 invalid_mode
}

// 後續流程共用（不分 mode）
- shape check 表單 11 欄
- 呼叫 submit_application RPC（含 upsert，p_mode 參數帶進去）
- await pushMessage notify 一休 + 婉馨
- 若 isSheetSyncEnabled → appendApplicationRow
```

---

## DB 改動（migration_020）

```sql
-- ============================================================
-- migration_020: /apply 廣播入口配套
-- 1. ALTER source CHECK 加 'broadcast'
-- 2. 加 partial unique index 防同人重複 pending
-- 3. submit_application RPC 加 upsert 分支（p_mode 參數）
-- ============================================================

BEGIN;

-- 1. ALTER source CHECK 加 broadcast
ALTER TABLE official_program_applications
  DROP CONSTRAINT IF EXISTS official_program_applications_source_check;
ALTER TABLE official_program_applications
  ADD CONSTRAINT official_program_applications_source_check
  CHECK (source IN ('bot_q5', 'manual_offline', 'seminar', 'referral', 'broadcast'));

-- 2. 加 partial unique 防同人重複 pending
CREATE UNIQUE INDEX IF NOT EXISTS idx_apps_pending_per_user
  ON official_program_applications (line_user_id)
  WHERE status = 'pending';

-- 3. submit_application RPC 加 upsert 分支
DROP FUNCTION IF EXISTS submit_application(...);  -- migration_018 的 14 參數版（簽名照搬）
CREATE OR REPLACE FUNCTION submit_application(
  p_line_user_id TEXT,
  p_real_name TEXT,
  -- ... 其他 13 個參數同 migration_018，
  p_mode TEXT DEFAULT 'private'  -- 新增：'private'（HMAC 漏斗）/ 'public'（廣播）
)
RETURNS submit_application_result AS $$
DECLARE
  v_user_path TEXT;
  v_application_id INT;
BEGIN
  -- SELECT path 驗用戶存在
  SELECT path INTO v_user_path FROM official_line_users WHERE line_user_id = p_line_user_id;

  -- 用戶不存在分流（這是 upsert 分支）
  IF NOT FOUND THEN
    IF p_mode = 'public' THEN
      -- 廣播模式：自動 INSERT 用戶（path='broadcast_imported' 標明）
      INSERT INTO official_line_users (
        line_user_id, path, path_stage, source, segment, joined_at,
        path_stage_updated_at, last_interaction_at
      ) VALUES (
        p_line_user_id, 'broadcast_imported', 8, 'broadcast', 'active',
        NOW(), NOW(), NOW()
      );
      v_user_path := 'broadcast_imported';
    ELSE
      -- 漏斗模式：維持既有 raise（防漏斗用戶資料表錯誤）
      RAISE EXCEPTION 'user_not_found: %', p_line_user_id USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- INSERT applications（既有邏輯不動）
  INSERT INTO official_program_applications (...) VALUES (...) RETURNING id INTO v_application_id;

  -- UPDATE official_line_users（既有 + GREATEST 防 regress）
  UPDATE official_line_users SET
    path_stage = GREATEST(path_stage, 8),
    path_stage_updated_at = NOW(),
    enrolled_at = COALESCE(enrolled_at, NOW()),
    enrolled_from_path = COALESCE(enrolled_from_path, v_user_path)
  WHERE line_user_id = p_line_user_id;

  -- 回傳同既有 submit_application_result 結構
  RETURN ROW(v_application_id, NOW(), 0, 0)::submit_application_result;
END;
$$ LANGUAGE plpgsql;

COMMIT;
```

**Schema 可重跑性**（Pattern 5 對照）：
- DROP CONSTRAINT IF EXISTS / IF NOT EXISTS / DROP FUNCTION IF EXISTS — 全 idempotent
- BEGIN/COMMIT 包起來，失敗整段 rollback
- ⚠️ 部署時序：constraint 在 RPC 之前 alter，避免 RPC 寫入時 constraint 還沒包含 'broadcast'

---

## 7 件工程任務（總計 ~105 行 diff）

| # | 工作 | 檔案 | 行數 |
|---|------|------|------|
| 1 | `/apply` page.js 加雙模式 extractParams 分流 | app/apply/page.js | 30 |
| 2 | `/apply` page.js handleSubmit 改 body 帶 mode='public' / sig | app/apply/page.js | 10 |
| 3 | `/api/apply/submit` 加雙模式分流（mode='public' 跳過 HMAC verify）| app/api/apply/submit/route.js | 25 |
| 4 | `/api/apply/submit` ?source server-side allowlist | app/api/apply/submit/route.js | 5 |
| 5 | submit_application RPC upsert 分支 + p_mode 參數 | supabase/migration_020.sql | 25 |
| 6 | ALTER source CHECK 加 'broadcast' | supabase/migration_020.sql | 5 |
| 7 | 加 partial unique index | supabase/migration_020.sql | 5 |
| | **合計** | | **~105** |

**省下不做的**（vs 婉馨原版 ~510 行）：

- ❌ `/apply-public` 新路由（~80 行）
- ❌ ApplyForm 抽 component（~600 行重構）
- ❌ LIFF ID Token verify helper（~60 行）
- ❌ jose / Node crypto JWKS 驗（~80 行）
- ❌ LINE 外瀏覽器拒絕 / fallback UI（~50 行）
- ❌ 申請 LINE Login channel + 配 env var（1-2 工作日 + 配置時間）

---

## 已知取捨（不是漏洞，是設計）

### 攻擊面 1：可 curl 偽造 userid 製造假報名

**情境**：攻擊者直接打 `POST /api/apply/submit -d '{"userid":"U任何人","mode":"public","source":"broadcast","real_name":"假冒"...}'`

**影響**：婉馨後台多一筆假報名要處理。

**判斷（一休 5/6 原話）**：實務上不會發生 — 陌生人沒 context 不會寫完整表單；就算寫了 phone/email 真實能 trace。

**保護**：

- `?source` server allowlist 擋亂值
- partial unique index 防同人多筆 pending（單筆攻擊只佔一筆 row 不擴散）
- `p_mode='public'` 寫進 application notes（自動 audit trail）

### 攻擊面 2：用戶可分享連結給朋友，朋友打開冒用 userid 報名

**情境**：A 收到群發訊息含 `?userid=U_A&source=broadcast`，A 把連結傳給 B，B 點進去報名 → DB 寫成 A 報名。

**影響**：歸因錯誤（A 的 userId 但實際是 B 報名）；但 phone/email 是 B 真實的、課程通知能寄到 B。

**判斷**：罕見、影響小、可由婉馨手動更正（admin 改 line_user_id）。

---

## 工期 + 部署順序

| Day | 任務 |
|-----|------|
| 5/9 (Sat) | 婉馨：寫 migration_020 + 本地測試 RPC |
| 5/10 (Sun) | 婉馨：改 /apply page.js + submit/route.js 雙模式 |
| 5/11 (Mon) | 婉馨：commit + 開 PR + 自審 + Vercel preview 部署 |
| 5/12 (Tue) | 一休：review PR + merge → 自動 prod 部署 |
| 5/13 (Wed) | 一休：用測試 userId（自己 / 婉馨）測完整流程：vercel URL 直接點 → 表單 → submit → DB 看到 path='broadcast_imported' / source='broadcast' |
| 5/14 (Thu) | 婉馨：準備 5/19 群發訊息文案 + 測試 multicast push 工具帶個人化 wrapLink |
| **5/19** | **第一波群發 5,000 人（死線）** |

---

## 測試 Checklist（5/13 必驗）

### Phase 1a：既有漏斗模式不破

- [ ] 一休從 LINE 學員故事 Flex 走完整 v3.2 流程到訊息 3
- [ ] 點訊息 3 「想看完整介紹」URI（含完整 HMAC sig）→ /apply 渲染正常
- [ ] 填表 submit → DB application 正常 INSERT，source='bot_q5'，既有 GoogleSheet 同步正常
- [ ] 既有 path / stage 邏輯不動

### Phase 1b：新廣播模式

- [ ] 直接打 vercel URL `?userid=Uxxx&source=broadcast` → /apply 渲染正常
- [ ] 填表 submit → DB application INSERT，source='broadcast'，mode='public'
- [ ] 既有用戶（DB 已有 row）submit → official_line_users.path_stage 升 8（GREATEST），既有 path 不動
- [ ] 老好友模擬（清掉 DB row 後 submit）→ INSERT path='broadcast_imported' + stage=8 + tag「已報名減重班」

### Phase 1c：邊界 / 攻擊面

- [ ] 同人快速雙擊 submit → 第一筆成功，第二筆 race lost（partial unique 擋）
- [ ] 已 paid 後再 submit 一次 → INSERT 一筆新 pending（unique 只擋同 status pending，已 paid 可重新報名）
- [ ] curl 偽造 userid 打 submit → 接受但 partial unique 擋多筆，single curl 只能成功一筆
- [ ] `?source=hacker` → server allowlist 擋（fallback 到 'broadcast'）
- [ ] userid shape 不對（`?userid=Uabc`）→ 400 invalid_userid

### Phase 1d：桌機 / LINE 外瀏覽器

- [ ] 桌機 Chrome 直接點 vercel URL → 表單渲染正常 + submit 通
- [ ] 手機 Safari 直接點 → 同上
- [ ] LINE 內建瀏覽器點 → 同上（不需 LIFF init）

---

## Phase 2 backlog（5/19 後）

| 工作 | 觸發條件 |
|------|---------|
| source 細分到活動級別（broadcast_0519_seminar / broadcast_0601_offer） | 第二波群發前需要 |
| 退訂機制（LINE 關鍵字「不再收推播」→ tag unsubscribed → push 排除） | 收到第一個檢舉前 |
| admin 加 broadcast 點擊報表（group by link_id 看 conversion）| 第二波打包名單前 |
| 第二波「打包點過 link_id=X 的人」工作流（admin 按鈕 → multicast push）| 5/19 第一波後 |
| 桌機 LINE Web 體驗優化 | 觀察轉換有問題才做 |

---

## 紅線（不准動）

- ❌ 不開 `/apply-public` 新路由（避 Pattern 9）
- ❌ 不改既有漏斗模式（HMAC 簽名邏輯 0 改動）
- ❌ 不抽 ApplyForm component（既有 page 雙模式即可）
- ❌ 不申請 LINE Login channel（不驗 ID Token）
- ❌ 不細分 source 到活動級別（Phase 2 工作）
- ❌ 不破壞既有 4 種 path（healthCheck/rebound/postpartum/eatOut）的狀態機語意 — 用新值 `'broadcast_imported'` 區分

---

## yi-challenge 對照（為何此版站得住）

| Pattern | 原方案踩到？ | 此版怎麼解 |
|---------|------------|----------|
| 1 搬家幻覺 | ❌ | 不搬 — 直接改既有 /apply 雙模式 |
| 2 破壞優化 | ❌ | HMAC 流程 0 改動，既有優化全保 |
| 3 歷史重演 | ❌ | 不是 journey / 統一入口類設計 |
| 4 命題框錯 | ⚠️ | path='broadcast_imported' 標明跳過漏斗，跟既有 4 path 區分 |
| 5 順序倒置 | ✅ | 商業流程確認（群發本身 = H0），無需 manual 前置 |
| 6 NULL 邏輯 | ⚠️ | upsert 顯式給 path/source/segment 不吃 default；`?source` allowlist 擋亂值 |
| 7 跨層原子性 | ✅ | submit_application RPC 已 atomic（一個 transaction）|
| 8 痛點誇大 | ⚠️ | 取捨（攻擊面≈0 vs 摩擦真）已記錄 |
| 9 止血 vs 根治 | ✅ | 不開新路由 = 不雙路徑 = 不止血 |
| 10 目的反推 | ✅ | 從「老好友報名 + 群發收網」目的反推設計 |

---

## Owner / 聯絡

- **設計**：一休 + Claude（yi-challenge 雙 agent）
- **開發**：婉馨（artemissport）
- **Review + merge**：一休
- **問題**：Phase 1 期間有 blocker → 在此契約 issue 區留言或在 PR comment 註明

---

## 變動歷史

- 2026-05-06：定版
  - 婉馨原 PR #66 草案（/apply-public + LIFF userId）
  - Claude 補正（LIFF ID Token 驗證 + jose）
  - yi-challenge 雙 agent 抓 8 個致命洞
  - 一休 5/6 拍板取捨：純信任 client userid 換低摩擦
  - 砍 60% 工 + 避開所有致命洞 = 此版定案
