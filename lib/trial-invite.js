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
export const TAG_INVITED_A2 = '體驗邀請-auto-A2'; // stage 1-3 卡點（2026-07-23 一休核准）
export const TAG_INVITED_B = '體驗邀請-auto-B';
export const TAG_INVITED_N = '體驗邀請-auto-N'; // 無類型版（沒做測驗，2026-07-23 一休核准）
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
// v3 共鳴版（2026-07-30 一休定稿）：說中復胖經驗 → 明確結果語言（瘦一輩子/不再胖回去）→ 出路
function buildInviteA(user) {
  const typeName = TYPE_NAMES[user.metabolism_type] || '你的代謝類型';
  return `${greet(user.display_name)}

想問你一個問題：你是不是也瘦下來過，然後又胖回去了？

大部分人不是不會瘦，是瘦下來之後守不住——因為用的方法本來就撐不了一輩子，餓出來的體重，身體遲早討回去。

所以我最近讓我的 AI 助理「阿算」做一件事：用你的代謝類型「${typeName}」，看你 3 天實際吃的餐，找出你一直胖回去的原因。因為我要的不是幫你再瘦一次——是瘦下來之後，再也不胖回去。

3 天，不用改變吃法，拍照就好，不用錢。

想終結復胖的話，回我一個「想」——沒興趣也完全沒關係 😊`;
}

// 受眾 B：看完學員故事後卡在「要不要進班」
// v3 共鳴版（2026-07-30 一休定稿）：復胖共鳴 + 班的事不急（保留卸壓）
function buildInviteB(user) {
  return `${greet(user.display_name)}

想問你一個問題：你是不是也瘦下來過，然後又胖回去了？

大部分人不是不會瘦，是瘦下來之後守不住——因為用的方法本來就撐不了一輩子，餓出來的體重，身體遲早討回去。

班的事不用急著決定。我最近讓我的 AI 助理「阿算」做一件事：看你 3 天實際吃的餐，找出你一直胖回去的原因。因為我要的不是幫你再瘦一次——是瘦下來之後，再也不胖回去。

3 天，不用改變吃法，拍照就好，不用錢。

想終結復胖的話，回我一個「想」——沒興趣也完全沒關係 😊`;
}

// 無類型版（沒做測驗的新人）：v3 共鳴版去類型句；測驗由阿算入門流程自然補
function buildInviteN(user) {
  return `${greet(user.display_name)}

想問你一個問題：你是不是也瘦下來過，然後又胖回去了？

大部分人不是不會瘦，是瘦下來之後守不住——因為用的方法本來就撐不了一輩子，餓出來的體重，身體遲早討回去。

所以我最近讓我的 AI 助理「阿算」做一件事：看你 3 天實際吃的餐，找出你一直胖回去的原因。因為我要的不是幫你再瘦一次——是瘦下來之後，再也不胖回去。

3 天，不用改變吃法，拍照就好，不用錢。

想終結復胖的話，回我一個「想」——沒興趣也完全沒關係 😊`;
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

// 受眾 A2：stage 1-3 卡 48h~14 天 + 有類型（回了體重/走了幾步就停住的人；A 版文案通用）
// 與 q5-maintenance 互斥：Q5 自動化只碰 stage>=4，這裡只碰 1-3
async function selectAudienceA2() {
  const { data, error } = await supabase
    .from('official_line_users')
    .select('line_user_id, display_name, metabolism_type, tags, last_user_reply_at')
    .in('path_stage', [1, 2, 3])
    .eq('is_blocked', false)
    .is('enrolled_at', null)
    .not('metabolism_type', 'is', null)
    .gte('path_stage_updated_at', iso(hoursAgo(14 * 24)))
    .lt('path_stage_updated_at', iso(hoursAgo(48)))
    .limit(200);
  if (error) throw error;
  return (data || []).filter(isEligible);
}

// 受眾 N：沒做測驗（無類型）的新人，加入 24h~7 天、還沒走進 Q5 深水區（stage<=3）
async function selectAudienceN() {
  const { data, error } = await supabase
    .from('official_line_users')
    .select('line_user_id, display_name, metabolism_type, tags, last_user_reply_at')
    .lte('path_stage', 3)
    .eq('is_blocked', false)
    .is('enrolled_at', null)
    .is('metabolism_type', null)
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

const VARIANTS = {
  A: { build: buildInviteA, tag: TAG_INVITED_A },
  A2: { build: buildInviteA, tag: TAG_INVITED_A2 }, // stage 1-3 用 A 版文案（類型段仍成立）
  B: { build: buildInviteB, tag: TAG_INVITED_B },
  N: { build: buildInviteN, tag: TAG_INVITED_N },
};

async function sendInvite(user, variant) {
  const v = VARIANTS[variant] || VARIANTS.A;
  const text = v.build(user);
  const tag = v.tag;
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

  const [rawA, rawA2, rawB, rawN] = await Promise.all([
    selectAudienceA(),
    selectAudienceA2(),
    selectAudienceB(),
    selectAudienceN(),
  ]);
  const gate = (list) =>
    restricted ? list.filter((u) => TEST_ALLOWLIST.includes(u.line_user_id)) : list;
  const listA = gate(rawA);
  const listA2 = gate(rawA2);
  const listB = gate(rawB);
  const listN = gate(rawN);

  const result = {
    dryRun,
    restricted,
    a: { candidates: rawA.length, eligible: listA.length, sent: 0, failed: 0 },
    a2: { candidates: rawA2.length, eligible: listA2.length, sent: 0, failed: 0 },
    b: { candidates: rawB.length, eligible: listB.length, sent: 0, failed: 0 },
    n: { candidates: rawN.length, eligible: listN.length, sent: 0, failed: 0 },
  };

  if (dryRun) {
    result.a.preview = listA.map((u) => u.display_name);
    result.a2.preview = listA2.map((u) => u.display_name);
    result.b.preview = listB.map((u) => u.display_name);
    result.n.preview = listN.map((u) => u.display_name);
    return result;
  }

  let budget = cap;
  for (const [variant, list, stats] of [
    ['A', listA, result.a],
    ['A2', listA2, result.a2],
    ['B', listB, result.b],
    ['N', listN, result.n],
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
