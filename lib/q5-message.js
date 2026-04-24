// Q5 軟邀請訊息 push helper（契約 v2.4 Ch.3.2）
//
// 職責：產 Quick Reply 兩按鈕訊息 + push 給用戶
//   - 文案從 official_settings 讀（被動 / 主動 兩版 B1d 定版）
//   - URL 用 buildQ5ApplyUrl 產 HMAC signed URL（契約 Ch.0.9）
//   - Quick Reply 兩按鈕：
//       「看看做法」   → URI action → /apply?...&sig=...
//       「有問題想問」 → postback action → action=handoff_from_q5
//
// 呼叫方：
//   - 被動軌 webhook stage=4 continue → 包成 pushFn 給 performQ5Transition
//   - 主動軌 cron q5-maintenance → 同上
//
// 回傳 boolean（搭配 q5-state.js performQ5Transition rollback 契約）：
//   true  = LINE 已接受（res.ok），訊息已送或即將送達
//   false = 建 URL 失敗 / setting 缺 / LINE 拒收 → 呼叫方 rollback stage

import { pushMessage } from './line.js';
import { getSettingTyped } from './official-settings.js';
import { buildQ5ApplyUrl } from './q5-apply-url.js';

/**
 * Push Q5 軟邀請（Quick Reply 兩按鈕）
 *
 * @param {string} userId — LINE userId
 * @param {'passive'|'active'} triggerSource — 觸發來源（影響文案選擇 + URL trigger param）
 * @returns {Promise<boolean>}
 */
export async function pushQ5SoftInvite(userId, triggerSource) {
  if (triggerSource !== 'passive' && triggerSource !== 'active') {
    console.error('[pushQ5SoftInvite] invalid triggerSource:', triggerSource);
    return false;
  }
  if (!userId || typeof userId !== 'string') {
    console.error('[pushQ5SoftInvite] invalid userId:', userId);
    return false;
  }

  try {
    const settingKey =
      triggerSource === 'active'
        ? 'q5_soft_invite_active_text'
        : 'q5_soft_invite_passive_text';
    const text = await getSettingTyped(settingKey);
    if (!text || typeof text !== 'string') {
      console.error('[pushQ5SoftInvite] missing setting:', settingKey);
      return false;
    }

    // buildQ5ApplyUrl 可能拋錯（secret missing / apply_url_base not set / invalid userId shape）
    // 這裡一律當 push 失敗 → 呼叫方 rollback
    const uri = await buildQ5ApplyUrl({ userId, triggerSource });

    const message = {
      type: 'text',
      text,
      quickReply: {
        items: [
          {
            type: 'action',
            action: {
              type: 'uri',
              label: '看看做法',
              uri,
            },
          },
          {
            type: 'action',
            action: {
              type: 'postback',
              label: '有問題想問',
              data: 'action=handoff_from_q5',
              displayText: '有問題想問',
            },
          },
        ],
      },
    };

    // pushMessage 回 res.ok（LINE API response 成功 = true）
    const ok = await pushMessage(userId, [message]);
    if (!ok) {
      console.error('[pushQ5SoftInvite] pushMessage returned false', {
        userId,
        triggerSource,
      });
    }
    return ok;
  } catch (err) {
    console.error('[pushQ5SoftInvite] exception:', err?.message, {
      userId,
      triggerSource,
    });
    return false;
  }
}
