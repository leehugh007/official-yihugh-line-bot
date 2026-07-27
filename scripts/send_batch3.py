#!/usr/bin/env python3
# 批3 群發：軟文案版 A/B 測試（2026-07-27 一休核准「發」）
# 對照組：批1 強文案（同溫層 18.8% 想 / 10.4% 封鎖）→ 批3 軟文案看封鎖降多少、熱度掉多少
# 用法：cd ~/AI_asis/official-yihugh-line-bot && set -a && source .env.local && set +a && python3 scripts/send_batch3.py
import json, os, time, urllib.request

URL = os.environ['SUPABASE_URL']; KEY = os.environ['SUPABASE_KEY']
LINE_TOKEN = os.environ['LINE_CHANNEL_ACCESS_TOKEN']
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

TYPE_NAMES = {'highRPM': '高轉速型', 'rollerCoaster': '雲霄飛車型', 'burnout': '燃燒殆盡型',
              'powerSave': '省電模式型', 'steady': '穩定燃燒型'}
TPL = """{name} 你好，我是一休 😊

最近我讓我的 AI 助理「阿算」幫大家做一件小事：你吃什麼拍照傳給它，它會用你的代謝類型「{tname}」告訴你這一餐是加分還是扣分，3 天後給你一份你自己的飲食盲點報告，不用錢。

不用改變吃法，就是拍照而已。

有興趣的話，回我一個「想」就好——沒興趣也完全沒關係 😊"""

cands = json.load(open(os.path.join(os.path.dirname(__file__), 'batch3_candidates.json')))
print(f"批3 候選: {len(cands)} 人（軟文案）")

record = []; sent = fail = skipped = 0
for u in cands:
    uid = u['line_user_id']; name = u['display_name']
    tname = TYPE_NAMES.get(u['metabolism_type'], '你的代謝類型')
    # 發送前再驗標籤（名單是昨天選的，自動線可能已先邀）
    g = urllib.request.Request(f"{URL}/rest/v1/official_line_users?line_user_id=eq.{uid}&select=tags,is_blocked", headers=H)
    row = json.load(urllib.request.urlopen(g))[0]
    tags = row['tags'] or []
    if row['is_blocked'] or any('體驗邀請' in str(t) for t in tags):
        skipped += 1; record.append({"uid": uid, "name": name, "status": "SKIPPED(已邀/封鎖)"})
        print(f"  SKIP {name}")
        continue
    try:
        req = urllib.request.Request("https://api.line.me/v2/bot/message/push",
            data=json.dumps({"to": uid, "messages": [{"type": "text", "text": TPL.format(name=name, tname=tname)}]}).encode(),
            headers={"Authorization": f"Bearer {LINE_TOKEN}", "Content-Type": "application/json"})
        urllib.request.urlopen(req)
        p = urllib.request.Request(f"{URL}/rest/v1/official_line_users?line_user_id=eq.{uid}",
            data=json.dumps({"tags": tags + ['體驗邀請-pub-3']}).encode(), headers=H, method='PATCH')
        urllib.request.urlopen(p)
        sent += 1; record.append({"uid": uid, "name": name, "type": u['metabolism_type'], "status": "SENT"})
        print(f"  OK {name}")
    except Exception as e:
        fail += 1; record.append({"uid": uid, "name": name, "status": f"FAIL:{e}"})
        print(f"  FAIL {name}: {e}")
    time.sleep(0.3)

print(f"\n完成: SENT {sent} / SKIP {skipped} / FAIL {fail}")
out = {"batch": "pub-3", "date": "2026-07-27", "copy_version": "軟文案v1（無活動框架/無名額/給台階）",
       "results": record}
path = '/Users/leehugh007/Library/Mobile Documents/com~apple~CloudDocs/AI_asis/ABC瘦身業務/3天看餐體驗/批3_發送記錄_2026-07-27.json'
json.dump(out, open(path, 'w'), ensure_ascii=False, indent=1)
print("記錄已存:", path)
