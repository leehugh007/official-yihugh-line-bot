// 用戶管理（Supabase）
// 表：official_line_users

import supabase from './supabase.js';

// 取得用戶
export async function getUser(userId) {
  const { data } = await supabase
    .from('official_line_users')
    .select('*')
    .eq('line_user_id', userId)
    .single();
  return data;
}

// 建立或更新用戶（follow 事件時呼叫）
export async function upsertUser(userId, data = {}) {
  const now = new Date().toISOString();
  const row = {
    line_user_id: userId,
    display_name: data.displayName || null,
    metabolism_type: data.metabolismType || null,
    source: data.source || 'direct',
    joined_at: now,
    last_interaction_at: now,
    interaction_count: 0,
    push_click_count: 0,
    segment: 'new',
    is_blocked: false,
  };
  // 只傳 snake_case 且確實存在的欄位
  if (data.drip_next_at) row.drip_next_at = data.drip_next_at;
  if (data.tags) row.tags = data.tags;

  const { error } = await supabase.from('official_line_users').upsert(
    row,
    { onConflict: 'line_user_id', ignoreDuplicates: false }
  );
  if (error) console.error('[Users] upsert error:', error);
}

// 記錄互動（任何訊息或點擊）
export async function recordInteraction(userId) {
  const { data: user } = await supabase
    .from('official_line_users')
    .select('interaction_count')
    .eq('line_user_id', userId)
    .single();

  const count = (user?.interaction_count || 0) + 1;
  const segment = calculateSegment(count);

  await supabase
    .from('official_line_users')
    .update({
      last_interaction_at: new Date().toISOString(),
      interaction_count: count,
      segment,
    })
    .eq('line_user_id', userId);
}

// 記錄推播點擊
export async function recordPushClick(userId, linkId) {
  const { data: user } = await supabase
    .from('official_line_users')
    .select('push_click_count, tags')
    .eq('line_user_id', userId)
    .single();

  const clickCount = (user?.push_click_count || 0) + 1;

  const updateData = {
    push_click_count: clickCount,
    last_push_click_at: new Date().toISOString(),
    segment: clickCount >= 2 ? 'active' : 'warm',
  };

  // 點擊報名相關連結 → 自動加標籤「有興趣」
  const SIGNUP_KEYWORDS = ['signup', 'register', '報名'];
  const isSignupLink = linkId && SIGNUP_KEYWORDS.some((kw) => linkId.toLowerCase().includes(kw));
  if (isSignupLink) {
    const currentTags = user?.tags || [];
    if (!currentTags.includes('有興趣')) {
      updateData.tags = [...currentTags, '有興趣'];
    }
  }

  await supabase
    .from('official_line_users')
    .update(updateData)
    .eq('line_user_id', userId);

  // 記錄點擊明細
  await supabase.from('official_line_clicks').insert({
    line_user_id: userId,
    link_id: linkId,
    clicked_at: new Date().toISOString(),
  });
}

// 標記封鎖（unfollow）
// Q5 契約 v2.3 Ch.0.6：blocked_at 寫時間戳，之後可排除長期未回應用戶、分析流失
export async function markBlocked(userId) {
  await supabase
    .from('official_line_users')
    .update({
      is_blocked: true,
      blocked_at: new Date().toISOString(),
    })
    .eq('line_user_id', userId);
}

// 取得特定分層的用戶（推播用）
export async function getUsersBySegment(segments) {
  const { data } = await supabase
    .from('official_line_users')
    .select('line_user_id')
    .in('segment', segments)
    .eq('is_blocked', false);
  return data?.map((u) => u.line_user_id) || [];
}

// 取得所有未封鎖用戶（全推播用）
export async function getAllActiveUsers() {
  const { data } = await supabase
    .from('official_line_users')
    .select('line_user_id')
    .eq('is_blocked', false);
  return data?.map((u) => u.line_user_id) || [];
}

// 計算分層
function calculateSegment(interactionCount) {
  if (interactionCount >= 5) return 'active';
  if (interactionCount >= 1) return 'warm';
  return 'new';
}

// 批次更新沉默用戶（定期跑，例如每週）
export async function updateSilentUsers(daysSinceLastInteraction = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysSinceLastInteraction);

  await supabase
    .from('official_line_users')
    .update({ segment: 'silent' })
    .lt('last_interaction_at', cutoff.toISOString())
    .neq('segment', 'silent')
    .eq('is_blocked', false);
}

// ============================================================
// 對話路徑 helpers（契約 v6 第 9 章，Phase 2b 新增）
// Phase 3 webhook 才會呼叫；Phase 2b 不接 webhook
// ============================================================

const EN_TO_ZH = {
  pain_points: '痛點',
  hesitations: '猶豫',
  intent: '意願',
  attentions: '關注',
};

const ARRAY_FIELDS = ['痛點', '猶豫', '關注'];

// 白名單 gate，擋 AI 幻覺傳多餘 key 污染 ai_tags
const ALLOWED_KEYS = new Set([
  ...ARRAY_FIELDS,
  '意願',
  'guide_miss_count',
  'retry_count_q1',
  'retry_count_q3',
  'retry_count_q4',
  '_stale',
  // Phase 3.2a 新增：AI 分類防重入 flag
  'q4_classified_at', // ISO timestamp，1h 內不重打 Gemini
  'q4_condition', // 最近一次 AI 分出的 condition enum，debug / notify 用
  // Phase 3.2c redesign：Q3 改選項（1/2/3/4），Phase 3.3 follow-up 推播/分層會用到
  'q3_choice', // 用戶在 Q3 選的數字（1/2/3/4）
  'q3_condition_selected', // Q3 選項對應的 condition enum（blood_sugar / cholesterol / ...）
  // 2026-04-30 Q4 AI retry hotfix：retry 3 次仍失敗時記下最後一次的 caller/reason，事後 SQL 統計
  '_last_ai_failure', // { caller, reason, at }
]);

/**
 * 合併 current ai_tags 和 patch
 * - ARRAY_FIELDS（痛點/猶豫/關注）：_op='append' 去重（by value）；_op='overwrite' 替換
 * - 其他白名單 key（意願/counter/_stale）：永遠覆蓋
 * - 不在白名單的 key：靜默忽略
 */
export function mergeByOp(current = {}, patch) {
  const { _op = 'append', _from_ai, ...data } = patch;
  const next = { ...current };

  for (const [k, v] of Object.entries(data)) {
    if (!ALLOWED_KEYS.has(k)) continue;

    if (ARRAY_FIELDS.includes(k)) {
      const items = Array.isArray(v)
        ? v
            .map((item) => {
              if (typeof item === 'string') {
                return { value: item, recorded_at: new Date().toISOString() };
              }
              if (item?.value) {
                return {
                  value: item.value,
                  recorded_at: item.recorded_at || new Date().toISOString(),
                };
              }
              return null;
            })
            .filter(Boolean)
        : [];

      if (_op === 'overwrite') {
        next[k] = items;
      } else {
        const existing = Array.isArray(next[k]) ? next[k] : [];
        const existingValues = new Set(existing.map((x) => x.value));
        const newItems = items.filter((x) => !existingValues.has(x.value));
        next[k] = [...existing, ...newItems];
      }
    } else {
      next[k] = v;
    }
  }

  return next;
}

/**
 * 寫 ai_tags（read-modify-write，半 atomic）
 * Race window 存在但可接受，下一則訊息 self-heal
 */
export async function updateAiTags(userId, patch) {
  const { _from_ai, _op = 'append', ...rawData } = patch;
  let mapped = rawData;
  if (_from_ai) {
    mapped = Object.fromEntries(
      Object.entries(rawData).map(([k, v]) => [EN_TO_ZH[k] || k, v])
    );
  }

  const { data: user, error: readErr } = await supabase
    .from('official_line_users')
    .select('ai_tags')
    .eq('line_user_id', userId)
    .single();
  if (readErr) return { ok: false, error: readErr.message };

  const merged = mergeByOp(user?.ai_tags || {}, { ...mapped, _op });

  const { error: writeErr } = await supabase
    .from('official_line_users')
    .update({
      ai_tags: merged,
      ai_tags_updated_at: new Date().toISOString(),
    })
    .eq('line_user_id', userId);

  if (writeErr) return { ok: false, error: writeErr.message };
  return { ok: true, data: merged };
}

/**
 * 更新 path_stage（含 retry_count reset + handoff 資料）
 * 合併成單次 UPDATE，stage 變動和 ai_tags reset 同時寫
 */
export async function updatePathStage(userId, newStage, meta = {}) {
  const { path, handoff_reason } = meta;
  const now = new Date().toISOString();

  const { data: user, error: readErr } = await supabase
    .from('official_line_users')
    .select('ai_tags, handoff_triggered_at')
    .eq('line_user_id', userId)
    .single();
  if (readErr) return { ok: false, error: readErr.message };

  // 新 stage 對應的 retry counter 要 reset 為 0
  const resetMap = {
    1: { retry_count_q1: 0 },
    2: { retry_count_q1: 0 },
    3: { retry_count_q3: 0 },
    4: { retry_count_q4: 0 },
  };
  const aiTagsPatch = resetMap[newStage] || {};
  const newAiTags =
    Object.keys(aiTagsPatch).length > 0
      ? mergeByOp(user?.ai_tags || {}, { ...aiTagsPatch, _op: 'overwrite' })
      : user?.ai_tags || {};

  const update = {
    path_stage: newStage,
    path_stage_updated_at: now,
    ai_tags: newAiTags,
    ai_tags_updated_at: now,
  };
  if (path !== undefined) update.path = path;
  if (newStage === 5) {
    update.handoff_triggered_at = now;
    update.handoff_reason = handoff_reason;
    update.handoff_rescue_notified = false;
  }

  const { error: writeErr } = await supabase
    .from('official_line_users')
    .update(update)
    .eq('line_user_id', userId);

  if (writeErr) return { ok: false, error: writeErr.message };
  return { ok: true, data: update };
}

/**
 * 讀對話路徑狀態（webhook 每則訊息開頭呼叫）
 * 搭配 60s in-memory cache（限單 Vercel instance）
 */
export async function getUserPathState(userId) {
  const { data } = await supabase
    .from('official_line_users')
    .select(
      // Phase 4.2：補 q5_sent_at + q5_intent 讓 stage=4 handler 不需再讀一次 DB
      // 也修掉 L220 非文字 pre-check 讀 state.q5_sent_at 永遠 undefined 的幽靈 guard
      'path, path_stage, current_weight, target_weight, ai_tags, ai_tags_updated_at, last_user_reply_at, last_stage5_reply_at, path_stage_updated_at, handoff_triggered_at, handoff_reason, handoff_rescue_notified, is_blocked, metabolism_type, q5_sent_at, q5_intent'
    )
    .eq('line_user_id', userId)
    .single();
  return data || {};
}
