// 3天看餐體驗 — 兩段式自動邀請（2026-07-18）
//
// 背景：Wave 1 手動邀 12 個冷名單只有 1 人加阿算。這裡改成兩段式：
//   第一段只要求回一個「想」（量測熱度），回「想」才給阿算連結（量測摩擦）。
//   兩個數字分開看，才能驗證「加另一個 LINE 本身是不是阻力」這個假設。
//
// 受眾（跟 Q5 自動化完全互斥）：
//   A：打了代謝代碼、看了報告就沒下文（path_stage=0 + 有 metabolism_type），加入 24h~7 天
//   B：走到 Q4 看完學員故事後卡住 48h+（path_stage=4），14 天內
//      q5-maintenance 主動軌只接「Q4 後沒回話」的人；B 受眾（回過話又卡住／意願 low）
//      是它永久跳過的漏網之魚。2026-07-18 以 215 人實際分解驗證：主動軌接手數 = 0。
//
// 為什麼不掛 retargeting 引擎（safe-change 1c 註記）：
//   引擎的受眾 primitive 讀不到 path_stage / metabolism_type、模板不支援個人化變數，
//   且系統仍在測試期（fix/retargeting-production-readiness 未合併）。本流程 = 一次性
//   邀請 + 關鍵字第二段，用不到週期狀態機。引擎轉正後可收編成一個 audience。
//
// 開關（official_settings，仿 PR #52 pattern）：
//   trial_invite_enabled    預設 false — 總開關，沒開 cron 直接 return
//   trial_invite_restricted 預設 true  — 只發 TEST_ALLOWLIST（一休+婉馨）
//   trial_invite_daily_cap  預設 30    — 每輪發送上限（控爆炸半徑）

import supabase from './supabase.js';
import { pushMessage, textMessage } from './line.js';
import { getSettingTyped } from './official-settings.js';
import { TEST_ALLOWLIST } from './constants.js';

const ASUAN_LINK = 'https://lin.ee/7lFRdXS';

export const TAG_INVITED_A = '體驗邀請-auto-A';
export const TAG_INVITED_B = '體驗邀請-auto-B';
export const TAG_WANT = '邀請-想';

// 對齊 metabolism_type 實際值域（兩個 bot 相同：ai-classifier.js / 阿算 handleSetType）
// 2026-07-20 修正：原寫成 rollercoaster/stableBurn，導致 steady(417人)/rollerCoaster(79人)
// 的邀請顯示 fallback「你的代謝類型」
const TYPE_NAMES = {
  highRPM: '高轉速型',
  rollerCoaster: '雲霄飛車型',
  burnout: '燃燒殆盡型',
  powerSave: '省電模式型',
  steady: '穩定燃燒型',
};

// 第二段：回「想」之後的回覆（webhook route.js 引用）
export const TRIAL_WANT_REPLY = `太好了 😊

這是阿算的 LINE，點進去加好友，跟它選一下你的代謝類型（30 秒），接下來 3 天你只要吃飯前拍張照傳給它就好：

${ASUAN_LINK}

3 天後它會給你一份你的飲食盲點報告，我也會看。過程中有任何問題，都可以直接在這裡問我。`;

function greet(displayName) {
  const name = String(displayName || '').trim();
  return name ? `${name}，我是一休 😊` : '我是一休 😊';
}

// 受眾 A：看了代謝報告就沒下文
function buildInviteA(user) {
  const typeName = TYPE_NAMES[user.metabolism_type] || '你的代謝類型';
  return `${greet(user.display_name)}

你之前做了代謝測驗，結果是「${typeName}」。

說真的，光知道類型還不夠——真正決定你瘦不瘦得下來的，是你每天實際吃進去的東西。同一碗滷肉飯，對不同類型的人，加分扣分完全不一樣。

所以這個月我開了一輪「3天幫你看體驗」：你每餐拍照傳過來，我用我帶學員的方法幫你看——阿算是我的 AI 助理，幫我把每一餐記下來、對照你的代謝類型。3 天後你會拿到一份自己的飲食盲點報告，不需要費用。

你不用特別改變吃法，因為我會透過阿算協助你找到自己飲食為什麼一直瘦不下來的盲點，每天只需要拍照上傳就好。

去年我們做過七天的版本，很多人是在那幾天第一次搞懂自己為什麼一直瘦不下來。

這輪我只收 20 個，想參加的話，回我一個「想」就好。`;
}

// 受眾 B：看完學員故事後卡在「要不要進班」
// 文案原則（user-eye 審查修正）：不點名她的行為軌跡（監視感），用「很多人」讓她自己對號入座
function buildInviteB(user) {
  return `${greet(user.display_name)}

很多人看完學員的故事，心裡其實有點想，但一想到要不要進班，就覺得需要再想一下——不是不想瘦，是怕自己做不到。

沒關係，班的事真的不用急著決定。

所以這個月我開了一輪「3天幫你看體驗」：你吃什麼拍照傳過來，我用帶學員的方法幫你看——阿算是我的 AI 助理，幫我把每一餐記下來，告訴你這餐對你的代謝是加分還是扣分。3 天後你會拿到一份自己的飲食盲點報告，不需要費用。

去年我們做過七天的版本，很多人是在那幾天第一次搞懂自己為什麼一直瘦不下來。

先看清楚自己每天吃的卡在哪，再決定需不需要人帶，這個順序比較穩。

這輪我只收 20 個，想參加的話，回我一個「想」就好。`;
}

const iso = (d) => d.toISOString();
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000);

// 共通排除：已邀過（auto-A/B 或 wave1 手動）、48h 內有回話（可能正在跟人對話）
function isEligible(u) {
  const tags = u.tags || [];
  if (tags.some((t) => String(t).includes('體驗邀請'))) return false;
  if (u.last_user_reply_at && new Date(u.last_user_reply_at) > hoursAgo(48)) return false;
  return true;
}

// 受眾 A：stage=0 + 有類型 + 未報名，加入 24h~7 天（Wave 1 教訓：冷名單無效，只邀溫的）
async function selectAudienceA() {
  const { data, error } = await supabase
    .from('official_line_users')
    .select('line_user_id, display_name, metabolism_type, tags, last_user_reply_at')
    .eq('path_stage', 0)
    .eq('is_blocked', false)
    .is('enrolled_at', null)
    .not('metabolism_type', 'is', null)
    .gte('joined_at', iso(hoursAgo(7 * 24)))
    .lt('joined_at', iso(hoursAgo(24)))
    .limit(200);
  if (error) throw error;
  return (data || []).filter(isEligible);
}

// 受眾 B：stage=4 卡 48h~14 天 + 未報名
async function selectAudienceB() {
  const { data, error } = await supabase
    .from('official_line_users')
    .select('line_user_id, display_name, metabolism_type, tags, last_user_reply_at')
    .eq('path_stage', 4)
    .eq('is_blocked', false)
    .is('enrolled_at', null)
    .gte('path_stage_updated_at', iso(hoursAgo(14 * 24)))
    .lt('path_stage_updated_at', iso(hoursAgo(48)))
    .limit(200);
  if (error) throw error;
  return (data || []).filter(isEligible);
}

async function sendInvite(user, variant) {
  const text = variant === 'A' ? buildInviteA(user) : buildInviteB(user);
  const tag = variant === 'A' ? TAG_INVITED_A : TAG_INVITED_B;
  await pushMessage(user.line_user_id, [textMessage(text)]);
  // push 成功才上標籤；標籤沒寫進去 = 下輪會重發，所以失敗要 throw 讓外層計入 failed
  const { error } = await supabase
    .from('official_line_users')
    .update({ tags: [...(user.tags || []), tag] })
    .eq('line_user_id', user.line_user_id);
  if (error) {
    console.error('[TrialInvite] tag update failed:', user.line_user_id, error.message);
    throw error;
  }
}

export async function runTrialInvite({ dryRun = false } = {}) {
  const enabled = await getSettingTyped('trial_invite_enabled');
  if (!enabled && !dryRun) return { skipped: 'trial_invite_enabled=false' };

  const restricted = await getSettingTyped('trial_invite_restricted');
  const cap = (await getSettingTyped('trial_invite_daily_cap')) ?? 30;

  const [rawA, rawB] = await Promise.all([selectAudienceA(), selectAudienceB()]);
  const gate = (list) =>
    restricted ? list.filter((u) => TEST_ALLOWLIST.includes(u.line_user_id)) : list;
  const listA = gate(rawA);
  const listB = gate(rawB);

  const result = {
    dryRun,
    restricted,
    a: { candidates: rawA.length, eligible: listA.length, sent: 0, failed: 0 },
    b: { candidates: rawB.length, eligible: listB.length, sent: 0, failed: 0 },
  };

  if (dryRun) {
    result.a.preview = listA.map((u) => u.display_name);
    result.b.preview = listB.map((u) => u.display_name);
    return result;
  }

  let budget = cap;
  for (const [variant, list, stats] of [
    ['A', listA, result.a],
    ['B', listB, result.b],
  ]) {
    for (const user of list) {
      if (budget <= 0) break;
      try {
        await sendInvite(user, variant);
        stats.sent += 1;
        budget -= 1;
      } catch (err) {
        stats.failed += 1;
        console.error('[TrialInvite] send failed:', user.line_user_id, err?.message);
      }
    }
  }
  console.log('[TrialInvite] done:', JSON.stringify(result));
  return result;
}
