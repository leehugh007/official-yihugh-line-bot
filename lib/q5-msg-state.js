// v3.2 自動推進漏斗 helper — 契約_自動推進漏斗v32.md Ch.2.5
//
// 7 個 helper（Phase 2B Session 1 建）：
//   pushMsg1 / pushMsg2 / pushMsg3 / pushMsg4   — race guard 推 4 段訊息
//   markMsgN                                    — 標 maybe / question / replied
//   clearV32Tracking                            — stage=3 reset 用（Ch.5.11）
//   detectWillingnessKeywords                   — Ch.6.3 意願詞偵測 + negation
//   buildQuickReplyForStage                     — 4 段共用 Quick Reply builder
//
// race guard 設計（Ch.2.5）：
//   conditional UPDATE q5_msg{N}_sent_at = NOW() WHERE q5_msg{N}_sent_at IS NULL
//   無 row 受影響 = race lost → return false → 呼叫方 swallow（不重試、不 reply 用戶）
//
// 訊息 3 升 stage=6（Ch.5.8）：
//   pushMsg3 同次 UPDATE 帶 path_stage=6，guard `path_stage <= 4`
//   避免覆蓋 stage=5 handoff / stage=7 已點 apply
//
// 文案：v3.3 範本（草稿_2026-05-03_訊息範本v3.3.md），yi-voice 兩輪 + 一休 review 拍板，禁止改字

import supabase from './supabase.js';
import { replyMessage, pushMessage } from './line.js';
import { buildQ5ApplyUrl } from './q5-apply-url.js';

// ============================================================
// 文案常量
// ============================================================

const MSG1_BY_PATH = {
  healthCheck:
    '沛蓁那種「身體被認錯」的崩潰，\n跟你看到健檢紅字的不安，\n其實是同一件事——\n身體已經在喊救命了，\n只是你還沒搞懂是哪裡出問題。\n\n沛蓁瘦下來不靠節食、不靠藥，靠的是吃對。\nABC 在做的，就是先讓你看懂身體在說什麼。',
  rebound:
    '俐臻 127 → 65 那個數字當然驚人，\n但讓我真的記住她的，是她說的那句：\n「原來胖是給我改變的機會。」\n\n復胖過幾次的人都知道，\n「我又要再來一次嗎」那種累——\n身體累、心更累。\n\nABC 在做的，就是讓你這次是最後一次。',
  postpartum:
    '溫溫產後 3 個月減 10 公斤——\n但讓我印象最深的，是她說的那句\n「第一次發現瘦身可以吃飽、不挨餓」。\n\n產後媽媽最深的傷其實不在身材。\n是那種「我以前可以、現在怎麼努力都失敗」的失控感。\n你不是不夠努力，是身體已經跟以前不一樣了。\n\nABC 給產後媽媽的版本，就是針對這個重新設計的。',
  eatOut:
    '美美姐姐做切胃、她準備去抽脂——\n最後她說「我不要再走我姐那條路」。\n\n外食族最怕被當成「沒救了，靠手術吧」。\n但 ABC 從第一天就在做相反的事——\n你還是這樣吃，我們教你怎麼在這樣吃的前提下瘦下來。\n\n全外食、應酬多，學員一堆都這樣。',
};

const MSG2_TEXT = `ABC 不靠少吃，也不用靠多動，更不用靠意志力。
我們先把「為什麼瘦不下來」這件事解開，
其他的自然會跟上。

A — 加營養（Add）：把好的補回來
B — 調體質（Behavior）：用行為調整，讓代謝系統回到正常運作
C — 輕負擔（Clear）：減輕身體和心理的負擔

過去這幾年我用這套方法帶過 3,000 多個學員。
身體真的回到該有的樣子，減完不會胖回來。

想看看我們怎麼把這套方法做成「ABC 12 週的代謝重建瘦身課程」？`;

const MSG3_TEXT = `「ABC 12 週的代謝重建瘦身課程」做的就是這三件事：

📌 教你看懂自己身體的代謝訊號
📌 排出符合你生活的吃法（外食、忙碌、產後都有對應版本）
📌 12 週直播課 + 群組陪伴 + 個別調整

6 月班報名分三段價：
‧ 24h 超早鳥 $10,400
‧ 7 天內常規早鳥 $11,400
‧ 之後 $12,600

6/1 開學。

要看完整介紹，從下面進去 →`;

const MSG4_TEXT = `前面聊到的 12 週課程，
看完還在想嗎？

如果還在猶豫——
我聽過太多人說「萬一我做不到怎麼辦」。
所以這次我們做了過去從沒做過的事：

關於「結果保證」這件事——
你跟著課程走，但身體真的沒感受到變化的話，
我們有完整的退費機制陪你處理，你不用擔心。

講白的，這套方法我自己最敢給保證。
你只要願意走，剩下的我們會陪你想辦法。

24h 早鳥已過，目前是常規早鳥 $11,400（省 $1,200）。
6 月班 6/1 開學，5 月底前都還趕得上。`;

// ============================================================
// Quick Reply builder
// ============================================================

const _qr = (items) => ({ items });
const _postbackAction = (label, data) => ({
  type: 'action',
  action: { type: 'postback', label, data },
});
const _uriAction = (label, uri) => ({
  type: 'action',
  action: { type: 'uri', label, uri },
});

/**
 * 產出當前段（msg1/2/3/4）的 Quick Reply object
 *
 * n=1/2 不需要 url（純 postback）
 * n=3/4 需要 userId + triggerSource → 內部呼叫 buildQ5ApplyUrl + 後綴 ?from=msg{n}
 *
 * 契約 Ch.5.6：q5_apply_from_msg 不進 HMAC canonical（from 是量測 metadata，不影響 auth）
 *
 * @param {1|2|3|4} n
 * @param {object} [opts]
 * @param {string} [opts.userId] — n=3/4 必傳
 * @param {'passive'|'active'} [opts.triggerSource='active'] — n=3/4 用
 */
export async function buildQuickReplyForStage(n, { userId, triggerSource = 'active' } = {}) {
  if (n === 1) {
    return _qr([
      _postbackAction('想知道 ABC 怎麼運作', 'action=intro_next'),
      _postbackAction('我有問題想問', 'action=intro_question'),
      _postbackAction('我再想想', 'action=intro_maybe'),
    ]);
  }
  if (n === 2) {
    return _qr([
      _postbackAction('想看 12 週怎麼安排', 'action=method_next'),
      _postbackAction('我有問題想問', 'action=method_question'),
      _postbackAction('我再想想', 'action=method_maybe'),
    ]);
  }
  if (n === 3 || n === 4) {
    if (!userId) {
      throw new Error(`buildQuickReplyForStage: n=${n} requires userId`);
    }
    const baseUrl = await buildQ5ApplyUrl({ userId, triggerSource });
    const fromMsg = n === 3 ? 'msg3' : 'msg4';
    const url = `${baseUrl}&from=${fromMsg}`;
    if (n === 3) {
      return _qr([
        _uriAction('想看完整介紹', url),
        _postbackAction('我有問題想問', 'action=offer_question'),
        _postbackAction('我再想想', 'action=offer_maybe'),
      ]);
    }
    return _qr([
      _uriAction('想看完整介紹', url),
      _postbackAction('我有問題想問', 'action=final_question'),
      _postbackAction('我再想想', 'action=final_maybe'),
    ]);
  }
  throw new Error(`buildQuickReplyForStage: invalid n=${n}`);
}

// ============================================================
// race guard helper（共用）
// ============================================================

/**
 * conditional UPDATE：q5_msg{N}_sent_at IS NULL 才寫 NOW() + q5_last_pushed_at
 * 適用 pushMsg1/2/4。pushMsg3 因需同次升 path_stage=6，自己寫 inline UPDATE。
 *
 * @returns {Promise<boolean>} true = 我贏 race，false = race lost / DB error
 */
async function _claimMsgSendSlot(userId, n) {
  const sentField = `q5_msg${n}_sent_at`;
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('official_line_users')
    .update({ [sentField]: now, q5_last_pushed_at: now })
    .eq('line_user_id', userId)
    .is(sentField, null)
    .select(sentField);
  if (error) {
    console.error(`[Q5MsgState] claim msg${n} slot error:`, error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

// ============================================================
// pushMsg1（reply only）— 承接故事 + 鋪陳 ABC
// ============================================================

/**
 * 推訊息 1：reply 4 path 對應的承接故事 + Quick Reply
 *
 * @param {string} userId
 * @param {string} replyToken
 * @param {'healthCheck'|'rebound'|'postpartum'|'eatOut'} path
 * @returns {Promise<boolean>}
 */
export async function pushMsg1(userId, replyToken, path) {
  const text = MSG1_BY_PATH[path];
  if (!text) {
    console.warn(`[Q5MsgState] pushMsg1: unsupported path "${path}", skip`);
    return false;
  }
  const claimed = await _claimMsgSendSlot(userId, 1);
  if (!claimed) return false;
  const quickReply = await buildQuickReplyForStage(1);
  await replyMessage(replyToken, [{ type: 'text', text, quickReply }]);
  return true;
}

// ============================================================
// pushMsg2（reply or push）— 純介紹 ABC
// ============================================================

/**
 * 推訊息 2：reply 或 push 純介紹 ABC + Quick Reply
 *
 * @param {string} userId
 * @param {string|null} replyToken — null 走 push（cron），非 null 走 reply（webhook）
 * @returns {Promise<boolean>}
 */
export async function pushMsg2(userId, replyToken) {
  const claimed = await _claimMsgSendSlot(userId, 2);
  if (!claimed) return false;
  const quickReply = await buildQuickReplyForStage(2);
  const msg = { type: 'text', text: MSG2_TEXT, quickReply };
  if (replyToken) {
    await replyMessage(replyToken, [msg]);
  } else {
    await pushMessage(userId, [msg]);
  }
  return true;
}

// ============================================================
// pushMsg3（reply or push）— 12 週課程 + 三段價
// ============================================================

/**
 * 推訊息 3：reply 或 push 12 週課程 + 三段價 + URI（?from=msg3）+ 同次升 path_stage=6
 *
 * race guard SQL：
 *   q5_msg3_sent_at IS NULL  AND  path_stage <= 4
 *   - sent_at IS NULL：基本 race guard
 *   - path_stage <= 4：避免覆蓋 stage=5 handoff / stage=7 已點 apply（Ch.5.8）
 *
 * @param {string} userId
 * @param {string|null} replyToken
 * @param {'passive'|'active'} [triggerSource='active'] — 用戶按 method_next 推 = active；cron 推 = passive
 * @returns {Promise<boolean>}
 */
export async function pushMsg3(userId, replyToken, triggerSource = 'active') {
  // 先 build URL（失敗就放棄，避免 race claim 後沒回覆給用戶）
  let quickReply;
  try {
    quickReply = await buildQuickReplyForStage(3, { userId, triggerSource });
  } catch (err) {
    console.error('[Q5MsgState] pushMsg3 buildQuickReply failed:', err.message);
    return false;
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('official_line_users')
    .update({
      q5_msg3_sent_at: now,
      q5_last_pushed_at: now,
      path_stage: 6,
    })
    .eq('line_user_id', userId)
    .is('q5_msg3_sent_at', null)
    .lte('path_stage', 4)
    .select('q5_msg3_sent_at');
  if (error) {
    console.error('[Q5MsgState] pushMsg3 update error:', error.message);
    return false;
  }
  if (!Array.isArray(data) || data.length === 0) return false;

  const msg = { type: 'text', text: MSG3_TEXT, quickReply };
  if (replyToken) {
    await replyMessage(replyToken, [msg]);
  } else {
    await pushMessage(userId, [msg]);
  }
  return true;
}

// ============================================================
// pushMsg4（push only — cron）— 最後提醒
// ============================================================

/**
 * 推訊息 4：cron only push（Phase 2C wire 上線）
 *
 * @param {string} userId
 * @param {'passive'|'active'} [triggerSource='passive'] — 預設 cron 推 = passive
 * @returns {Promise<boolean>}
 */
export async function pushMsg4(userId, triggerSource = 'passive') {
  let quickReply;
  try {
    quickReply = await buildQuickReplyForStage(4, { userId, triggerSource });
  } catch (err) {
    console.error('[Q5MsgState] pushMsg4 buildQuickReply failed:', err.message);
    return false;
  }
  const claimed = await _claimMsgSendSlot(userId, 4);
  if (!claimed) return false;
  await pushMessage(userId, [{ type: 'text', text: MSG4_TEXT, quickReply }]);
  return true;
}

// ============================================================
// markMsgN — 標 maybe / question / replied
// ============================================================

const _ACTION_FIELD = {
  replied: 'replied_at',
  maybe: 'maybe_at',
  question: 'question_at',
};

/**
 * 標訊息 N 的用戶回應（不寫 sent_at）
 *
 * schema 限制：訊息 3/4 沒有 replied_at（決策見 schema 對齊段，msg3/4 後直接 URI 不算 replied）
 *
 * @param {string} userId
 * @param {1|2|3|4} n
 * @param {'replied'|'maybe'|'question'} action
 * @returns {Promise<boolean>}
 */
export async function markMsgN(userId, n, action) {
  const suffix = _ACTION_FIELD[action];
  if (!suffix) {
    console.warn(`[Q5MsgState] markMsgN: unknown action "${action}"`);
    return false;
  }
  if ((n === 3 || n === 4) && action === 'replied') {
    console.warn(`[Q5MsgState] markMsgN: msg${n} has no replied_at`);
    return false;
  }
  if (![1, 2, 3, 4].includes(n)) {
    console.warn(`[Q5MsgState] markMsgN: invalid n=${n}`);
    return false;
  }
  const field = `q5_msg${n}_${suffix}`;
  const { error } = await supabase
    .from('official_line_users')
    .update({ [field]: new Date().toISOString() })
    .eq('line_user_id', userId);
  if (error) {
    console.error(`[Q5MsgState] markMsgN(${n}, ${action}) error:`, error.message);
    return false;
  }
  return true;
}

// ============================================================
// clearV32Tracking — stage=3 reset 用（Ch.5.11）
// ============================================================

/**
 * 清空 v3.2 漏斗追蹤欄位 — stage=3 reset 回 Q1 時呼叫
 *
 * 清的欄位（Ch.5.11）：
 *   - 16 個 q5_msg* 時間戳（4 段 × {sent/replied/maybe/question}_at，msg3/4 沒 replied_at 共 14 個 + 全清成 NULL 的 16 欄）
 *   - q5_last_pushed_at（節流戳）
 *   - q5_apply_from_msg（點擊歸因）
 *   - handoff_triggered_at + handoff_reason（v3 必修 致命 3 解死鎖）
 *
 * 不清：path_stage（reset 本身就是 set path_stage=1）/ ai_tags（既有清 q4_classified_at 已涵蓋）
 *
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function clearV32Tracking(userId) {
  const { error } = await supabase
    .from('official_line_users')
    .update({
      q5_msg1_sent_at: null,
      q5_msg1_replied_at: null,
      q5_msg1_maybe_at: null,
      q5_msg1_question_at: null,
      q5_msg2_sent_at: null,
      q5_msg2_replied_at: null,
      q5_msg2_maybe_at: null,
      q5_msg2_question_at: null,
      q5_msg3_sent_at: null,
      q5_msg3_maybe_at: null,
      q5_msg3_question_at: null,
      q5_msg4_sent_at: null,
      q5_msg4_maybe_at: null,
      q5_msg4_question_at: null,
      q5_last_pushed_at: null,
      q5_apply_from_msg: null,
      handoff_triggered_at: null,
      handoff_reason: null,
    })
    .eq('line_user_id', userId);
  if (error) {
    console.error('[Q5MsgState] clearV32Tracking error:', error.message);
    return false;
  }
  return true;
}

// ============================================================
// detectWillingnessKeywords — 意願詞 + negation pre-filter（Ch.6.3）
// ============================================================

// negation pre-filter — 必須 short-circuit（先擋「不想了解」「沒興趣」這類）
const _NEGATION_RE = /不[想了解OK好]|沒[興趣意願]/;

// 意願詞（命中任一即觸發 reply + 重發 Quick Reply）
const _WILLINGNESS = ['想', '了解', 'OK', 'ok', '好', '再聊', '報名', '價格', '課程'];

/**
 * 偵測意願詞 + negation pre-filter
 *
 * 流程：
 *   1. 先跑 negation regex → 命中「不想/沒興趣」直接 return false
 *   2. 沒 negation 才掃意願詞清單
 *
 * 用途：handleV32FreeText（Ch.6.3，Phase 2B Session 3 wire）
 *
 * @param {string} text
 * @returns {boolean}
 */
export function detectWillingnessKeywords(text) {
  if (!text || typeof text !== 'string') return false;
  if (_NEGATION_RE.test(text)) return false;
  return _WILLINGNESS.some((kw) => text.includes(kw));
}
