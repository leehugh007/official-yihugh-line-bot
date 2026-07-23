#!/usr/bin/env python3
# 批1 群發：3天幫你看體驗 公開招募（2026-07-20 一休核准「發」）
# 對象：最溫 50 人扣除 沛蓁(#50 同名疑慮)、Alice Chen(#47 疑似舊生) = 48 人
# 用法：cd ~/AI_asis/official-yihugh-line-bot && set -a && source .env.local && set +a && python3 scripts/send_batch1.py
import json, os, time, urllib.request

URL = os.environ['SUPABASE_URL']; KEY = os.environ['SUPABASE_KEY']
LINE_TOKEN = os.environ['LINE_CHANNEL_ACCESS_TOKEN']
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

TYPE_NAMES = {'highRPM': '高轉速型', 'rollerCoaster': '雲霄飛車型', 'burnout': '燃燒殆盡型',
              'powerSave': '省電模式型', 'steady': '穩定燃燒型'}
TPL = """{name} 你好，我是一休 😊

九月開班前，我想先做一件事：無償開放一輪「3天幫你看體驗」。

你之前測過，你是「{tname}」——報告能告訴你體質，但報告看不到你每天實際怎麼吃。這 3 天，你吃什麼就拍照傳過來，我用帶學員的方法，搭配我的 AI 助理阿算，幫你看每一餐對你的代謝是加分還是扣分。3 天結束，你會拿到一份自己的飲食盲點報告。

不用改變吃法、不用算熱量，就是拍照而已。

去年我們做過七天的版本，那次讓我確定一件事：大部分人不是不努力，是看不到自己的盲點。

這輪我只收 20 個名額，想參加的，回我一個「想」就好。"""

CANDS = os.path.join(os.path.dirname(__file__), 'batch2_candidates.json')
cands = json.load(open(CANDS))
SKIP = set()  # 批2 選名單時已排除
targets = [u for u in cands if u['display_name'] not in SKIP]
print(f"發送對象: {len(targets)} 人（跳過 {SKIP}）")

record = []; sent = fail = 0
for u in targets:
    uid = u['line_user_id']; name = u['display_name']
    tname = TYPE_NAMES.get(u['metabolism_type'], '你的代謝類型')
    try:
        req = urllib.request.Request("https://api.line.me/v2/bot/message/push",
            data=json.dumps({"to": uid, "messages": [{"type": "text", "text": TPL.format(name=name, tname=tname)}]}).encode(),
            headers={"Authorization": f"Bearer {LINE_TOKEN}", "Content-Type": "application/json"})
        urllib.request.urlopen(req)
        g = urllib.request.Request(f"{URL}/rest/v1/official_line_users?line_user_id=eq.{uid}&select=tags", headers=H)
        tags = json.load(urllib.request.urlopen(g))[0]['tags'] or []
        if '體驗邀請-pub-2' not in tags:
            p = urllib.request.Request(f"{URL}/rest/v1/official_line_users?line_user_id=eq.{uid}",
                data=json.dumps({"tags": tags + ['體驗邀請-pub-2']}).encode(), headers=H, method='PATCH')
            urllib.request.urlopen(p)
        sent += 1; record.append({"uid": uid, "name": name, "type": u['metabolism_type'], "status": "SENT"})
        print(f"  ✅ {name}")
    except Exception as e:
        fail += 1; record.append({"uid": uid, "name": name, "status": f"FAIL:{e}"})
        print(f"  ❌ {name}: {e}")
    time.sleep(0.3)

print(f"\n完成: SENT {sent} / FAIL {fail}")
out = {"batch": "pub-2", "date": "2026-07-23", "copy_version": "公開招募v1(個人化name+type)",
       "skipped": list(SKIP), "results": record}
path = '/Users/leehugh007/Library/Mobile Documents/com~apple~CloudDocs/AI_asis/ABC瘦身業務/3天看餐體驗/批2_發送記錄_2026-07-23.json'
json.dump(out, open(path, 'w'), ensure_ascii=False, indent=1)
print("記錄已存:", path)
