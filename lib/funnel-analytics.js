// Q5 漏斗分析 — 拉資料 + 聚合
//
// 兩個入口：
//   getFunnelStats({ rangeDays })   → 上半部總覽（漏斗 / 分組 / Path×階段交叉表）
//   getFunnelUsers(filters)         → 下半部分群分析（階段分佈摘要 + 名單）
//
// 時間 anchor 使用 joined_at（cohort 視角 — 看「這段時間加入的用戶」後續轉換）

import supabase from './supabase.js';

export const PATHS = ['healthCheck', 'rebound', 'postpartum', 'eatOut', 'other'];
export const METABOLISM_TYPES = ['highRPM', 'rollerCoaster', 'burnout', 'powerSave', 'steady'];

export const PATH_LABELS = {
  healthCheck: '健檢紅字',
  rebound: '復胖',
  postpartum: '產後',
  eatOut: '外食',
  other: '其他',
};

export const METABOLISM_LABELS = {
  highRPM: '高轉速',
  rollerCoaster: '溜溜球',
  burnout: '倦怠',
  powerSave: '省電',
  steady: '穩定',
};

// 階段 key → 顯示文字
export const STAGE_LABELS = {
  stuck_msg1: '卡在 msg1（沒回應）',
  stuck_msg2: '卡在 msg2（沒回應）',
  stuck_msg3: '卡在 msg3（沒點 /apply）',
  stuck_msg4: '卡在 msg4（沒點 /apply）',
  clicked_no_submit: '點了 /apply 但沒送單',
  submitted_pending: '送單未付款',
  paid: '已付款',
};

const STAGE_KEYS = Object.keys(STAGE_LABELS);

// 用戶選擇欄位（funnel 計算需要的所有欄位）
const USER_COLUMNS = [
  'line_user_id',
  'display_name',
  'metabolism_type',
  'source',
  'path',
  'path_stage',
  'tags',
  'joined_at',
  'last_interaction_at',
  'q5_click_count',
  'q5_clicked_at',
  'q5_apply_from_msg',
  'enrolled_at',
  // msg1
  'q5_msg1_sent_at', 'q5_msg1_replied_at', 'q5_msg1_maybe_at', 'q5_msg1_question_at',
  // msg2
  'q5_msg2_sent_at', 'q5_msg2_replied_at', 'q5_msg2_maybe_at', 'q5_msg2_question_at',
  // msg3（無 _replied_at，「往下」= 點 /apply 且 q5_apply_from_msg='msg3'）
  'q5_msg3_sent_at', 'q5_msg3_maybe_at', 'q5_msg3_question_at',
  // msg4
  'q5_msg4_sent_at', 'q5_msg4_maybe_at', 'q5_msg4_question_at',
].join(', ');

// 拉用戶 + 報名資料
async function fetchData({ rangeDays } = {}) {
  // Supabase 預設 1000 row 上限 — 分頁拉到拉完為止（用戶量目前 ~1000，後續成長也撐得住）
  const pageSize = 1000;
  let users = [];
  for (let offset = 0; ; offset += pageSize) {
    let q = supabase
      .from('official_line_users')
      .select(USER_COLUMNS)
      .eq('is_blocked', false)
      .order('joined_at', { ascending: true })
      .order('line_user_id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (rangeDays && rangeDays > 0) {
      const cutoff = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString();
      q = q.gte('joined_at', cutoff);
    }
    const { data, error } = await q;
    if (error) throw new Error(`fetch_users_failed: ${error.message}`);
    if (!data || data.length === 0) break;
    users = users.concat(data);
    if (data.length < pageSize) break;
    if (offset > 50000) break; // 安全閥
  }

  // 報名資料 — 只抓有 line_user_id 的（manual_offline source 可能 null），同樣分頁避免 1000 row 截斷
  let apps = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error: appErr } = await supabase
      .from('official_program_applications')
      .select('line_user_id, status, submitted_at')
      .not('line_user_id', 'is', null)
      .order('submitted_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (appErr) throw new Error(`fetch_apps_failed: ${appErr.message}`);
    if (!data || data.length === 0) break;
    apps = apps.concat(data);
    if (data.length < pageSize) break;
    if (offset > 50000) break; // 安全閥
  }

  // 建立 userId → 最佳狀態 map（paid > pending > cancelled）
  const statusRank = { paid: 3, pending: 2, cancelled: 1 };
  const appByUser = new Map();
  apps.forEach((a) => {
    const prev = appByUser.get(a.line_user_id);
    if (!prev || (statusRank[a.status] || 0) > (statusRank[prev.status] || 0)) {
      appByUser.set(a.line_user_id, a);
    }
  });

  return { users: users || [], appByUser };
}

// 判斷單一用戶當前漏斗位置 → 回傳 stage key（最進階的那一個）或 null
// 順序：paid > submitted_pending > clicked_no_submit > stuck_msg4 > stuck_msg3 > stuck_msg2 > stuck_msg1
export function getUserStage(user, app) {
  if (app?.status === 'paid') return 'paid';
  if (app?.status === 'pending') return 'submitted_pending';
  if (user.q5_clicked_at && !app) return 'clicked_no_submit';
  if (user.q5_msg4_sent_at && !user.q5_clicked_at) return 'stuck_msg4';
  if (user.q5_msg3_sent_at && !user.q5_msg4_sent_at && !user.q5_clicked_at) return 'stuck_msg3';
  if (user.q5_msg2_sent_at && !user.q5_msg3_sent_at) return 'stuck_msg2';
  if (user.q5_msg1_sent_at && !user.q5_msg2_sent_at) return 'stuck_msg1';
  return null;
}

// 空的漏斗物件（含 Q1-Q4 + Q5 全段）
function emptyFunnel() {
  return {
    in_q1: 0,         // path_stage >= 1（被推 Q1 問體重）
    in_q2: 0,         // path_stage >= 2（答了體重）
    in_q3: 0,         // path_stage >= 3（選了主因 / path）
    in_q4: 0,         // path_stage >= 4（回了 Q3 選項，進入 Q4 AI 回饋）
    finished_q4: 0,   // path_stage >= 4（Q4 AI 回饋完成；stage=5 已是 Q5 之後）
    in_q5: 0,         // 收到 msg1
    msg1_sent: 0,
    msg2_sent: 0,
    msg3_sent: 0,
    msg4_sent: 0,
    clicked_apply: 0,
    submitted: 0,
    paid: 0,
  };
}

// 把單一用戶累加到一個漏斗物件
function accumulate(funnel, user, app) {
  const stage = user.path_stage || 0;
  if (stage >= 1) funnel.in_q1++;
  if (stage >= 2) funnel.in_q2++;
  if (stage >= 3) funnel.in_q3++;
  if (stage >= 4) funnel.in_q4++;
  if (stage >= 4) funnel.finished_q4++;
  if (user.q5_msg1_sent_at) {
    funnel.in_q5++;
    funnel.msg1_sent++;
  }
  if (user.q5_msg2_sent_at) funnel.msg2_sent++;
  if (user.q5_msg3_sent_at) funnel.msg3_sent++;
  if (user.q5_msg4_sent_at) funnel.msg4_sent++;
  if (user.q5_clicked_at) funnel.clicked_apply++;
  if (app) funnel.submitted++;
  if (app?.status === 'paid') funnel.paid++;
}

// 空的訊息反應物件
function emptyMsgReaction() {
  return { sent: 0, next: 0, maybe: 0, question: 0 };
}

// 主入口：上半部總覽
export async function getFunnelStats({ rangeDays } = {}) {
  const { users, appByUser } = await fetchData({ rangeDays });

  // 1. overall（整體漏斗，含 pre-Q5 階段）
  let total = 0;
  const overall = emptyFunnel();

  // 2. by_path（按 5 條 path 分組）
  const byPath = {};
  PATHS.forEach((p) => { byPath[p] = emptyFunnel(); });
  byPath.null = emptyFunnel(); // 未分 path 的 Q5 用戶（理論上很少，但保留）

  // 3. by_metabolism（按 5 種代謝類型分組）
  const byMetabolism = {};
  METABOLISM_TYPES.forEach((m) => { byMetabolism[m] = emptyFunnel(); });
  byMetabolism.null = emptyFunnel();

  // 4. by_path_metabolism（drill-down：path × 代謝類型）
  const byPathMetabolism = {};
  PATHS.forEach((p) => {
    byPathMetabolism[p] = {};
    METABOLISM_TYPES.forEach((m) => { byPathMetabolism[p][m] = emptyFunnel(); });
    byPathMetabolism[p].null = emptyFunnel();
  });

  // 5. msg_reactions（每段訊息互動反應分佈）
  //    next     = 按「想知道更多/想看 12 週/想看完整介紹」往下走（msg3/4 = 點 /apply 且 from=msgN）
  //    maybe    = 按「我再想想」
  //    question = 按「我有問題想問」
  //    no_response = sent - next - maybe - question（前端算）
  const msgReactions = {
    msg1: emptyMsgReaction(),
    msg2: emptyMsgReaction(),
    msg3: emptyMsgReaction(),
    msg4: emptyMsgReaction(),
  };

  users.forEach((u) => {
    total++;

    const app = appByUser.get(u.line_user_id);

    accumulate(overall, u, app);

    const pKey = PATHS.includes(u.path) ? u.path : 'null';
    accumulate(byPath[pKey], u, app);

    const mKey = METABOLISM_TYPES.includes(u.metabolism_type) ? u.metabolism_type : 'null';
    accumulate(byMetabolism[mKey], u, app);

    if (pKey !== 'null') {
      accumulate(byPathMetabolism[pKey][mKey], u, app);
    }

    // 每段訊息反應
    if (u.q5_msg1_sent_at) msgReactions.msg1.sent++;
    if (u.q5_msg1_replied_at) msgReactions.msg1.next++;
    if (u.q5_msg1_maybe_at) msgReactions.msg1.maybe++;
    if (u.q5_msg1_question_at) msgReactions.msg1.question++;

    if (u.q5_msg2_sent_at) msgReactions.msg2.sent++;
    if (u.q5_msg2_replied_at) msgReactions.msg2.next++;
    if (u.q5_msg2_maybe_at) msgReactions.msg2.maybe++;
    if (u.q5_msg2_question_at) msgReactions.msg2.question++;

    // msg3/4 沒有 _replied_at — 「往下」= 點 /apply 且歸因到該 msg
    if (u.q5_msg3_sent_at) msgReactions.msg3.sent++;
    if (u.q5_apply_from_msg === 'msg3') msgReactions.msg3.next++;
    if (u.q5_msg3_maybe_at) msgReactions.msg3.maybe++;
    if (u.q5_msg3_question_at) msgReactions.msg3.question++;

    if (u.q5_msg4_sent_at) msgReactions.msg4.sent++;
    if (u.q5_apply_from_msg === 'msg4') msgReactions.msg4.next++;
    if (u.q5_msg4_maybe_at) msgReactions.msg4.maybe++;
    if (u.q5_msg4_question_at) msgReactions.msg4.question++;
  });

  return {
    range: { days: rangeDays || null },
    overall: { total, ...overall },
    by_path: byPath,
    by_metabolism: byMetabolism,
    by_path_metabolism: byPathMetabolism,
    msg_reactions: msgReactions,
  };
}

// 主入口：下半部分群分析（依條件 filter → 階段分佈摘要 + 各段名單）
export async function getFunnelUsers({
  paths = [],
  metabolismTypes = [],
  daysStuck = 0,
  enrolled = null, // null=全部、true=已報名、false=未報名
  rangeDays,
} = {}) {
  const { users, appByUser } = await fetchData({ rangeDays });

  const pathFilter = new Set(paths.filter((p) => PATHS.includes(p)));
  const mFilter = new Set(metabolismTypes.filter((m) => METABOLISM_TYPES.includes(m)));

  const stuckCutoff = daysStuck > 0
    ? Date.now() - daysStuck * 24 * 60 * 60 * 1000
    : null;

  // 初始化各階段桶
  const byStage = {};
  STAGE_KEYS.forEach((k) => { byStage[k] = { count: 0, users: [] }; });

  let total = 0;

  users.forEach((u) => {
    // 必須進過 Q5
    if (!u.q5_msg1_sent_at) return;

    // path filter
    if (pathFilter.size && !pathFilter.has(u.path)) return;
    // metabolism filter
    if (mFilter.size && !mFilter.has(u.metabolism_type)) return;

    const app = appByUser.get(u.line_user_id);

    // enrolled filter
    if (enrolled === true && app?.status !== 'paid') return;
    if (enrolled === false && app?.status === 'paid') return;

    const stage = getUserStage(u, app);
    if (!stage) return; // 沒落到任何卡點桶（理論上 q5_msg1_sent 的都會落到某段）

    // days_stuck filter — 用 last_interaction_at 當「沒動」的依據
    if (stuckCutoff !== null && stage !== 'paid' && stage !== 'submitted_pending') {
      const lastActive = u.last_interaction_at ? new Date(u.last_interaction_at).getTime() : 0;
      if (lastActive > stuckCutoff) return; // 還在活躍，不算卡
    }

    byStage[stage].count++;
    byStage[stage].users.push({
      line_user_id: u.line_user_id,
      display_name: u.display_name,
      metabolism_type: u.metabolism_type,
      path: u.path,
      source: u.source,
      last_interaction_at: u.last_interaction_at,
      joined_at: u.joined_at,
      q5_msg1_sent_at: u.q5_msg1_sent_at,
      q5_msg2_sent_at: u.q5_msg2_sent_at,
      q5_msg3_sent_at: u.q5_msg3_sent_at,
      q5_msg4_sent_at: u.q5_msg4_sent_at,
      q5_clicked_at: u.q5_clicked_at,
    });
    total++;
  });

  // 各段名單按最後互動排序（新→舊）
  STAGE_KEYS.forEach((k) => {
    byStage[k].users.sort((a, b) => {
      const ta = a.last_interaction_at ? new Date(a.last_interaction_at).getTime() : 0;
      const tb = b.last_interaction_at ? new Date(b.last_interaction_at).getTime() : 0;
      return tb - ta;
    });
  });

  return {
    filters: { paths: [...pathFilter], metabolismTypes: [...mFilter], daysStuck, enrolled, rangeDays: rangeDays || null },
    total,
    by_stage: byStage,
  };
}
