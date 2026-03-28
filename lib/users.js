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
export async function markBlocked(userId) {
  await supabase
    .from('official_line_users')
    .update({ is_blocked: true })
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
