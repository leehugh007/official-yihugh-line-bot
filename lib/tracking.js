// 連結追蹤系統
// 所有從 LINE 發出去的連結都包一層追蹤 URL

import { BOT_BASE_URL } from './config.js';
import supabase from './supabase.js';

// 產生追蹤連結
// 用法：wrapLink('https://abcmetabolic.com/seminar', 'seminar_apr', userId)
// 結果：https://official-yihugh-line-bot.vercel.app/api/track/r?id=xxx&u=userId&url=encoded
export function wrapLink(originalUrl, linkId, userId = '') {
  const params = new URLSearchParams({
    id: linkId,
    url: originalUrl,
  });
  if (userId) params.set('u', userId);
  return `${BOT_BASE_URL}/api/track/r?${params.toString()}`;
}

// 記錄點擊（在 /api/track/r handler 裡呼叫）
export async function logClick(linkId, userId) {
  if (!userId) return;

  await supabase.from('official_line_clicks').insert({
    line_user_id: userId,
    link_id: linkId,
    clicked_at: new Date().toISOString(),
  });
}

// 查詢點擊統計
export async function getClickStats(linkId) {
  const { count } = await supabase
    .from('official_line_clicks')
    .select('*', { count: 'exact', head: true })
    .eq('link_id', linkId);
  return count || 0;
}
