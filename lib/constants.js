// lib/constants.js
// 共用常數 — 避免散在 handoff.js / cron/q5-maintenance.js / submit/route.js 各定義一份
//
// yi-challenge 2026-04-25 點名：NOTIFY_USER_IDS 已重複定義 2 次，加 submit
// 即時通知時要用，抽出來避免變第 3 處。

/**
 * 通知收件者：handoff / application notify / 即時通知三處共用
 * Setting `handoff_notify_to` 用 keys ['yixiu', 'wanxin']，map 到 userId
 */
export const NOTIFY_USER_IDS = {
  yixiu: 'U51808e2cc195967eba53701518e6f547',
  wanxin: 'U3edf3d2114ee03ad81cff1fd35c04600',
};

/**
 * 測試白名單：Q5 restricted mode（PR #52）+ 主動軌 cron test mode 用
 * 等於 NOTIFY_USER_IDS 的 values（一休 + 婉馨 dev 帳號）
 */
export const TEST_ALLOWLIST = Object.values(NOTIFY_USER_IDS);
