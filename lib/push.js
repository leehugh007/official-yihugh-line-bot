// 排程推播發送邏輯（共用：cron 和 admin route 都用）
import supabase from './supabase.js';
import { multicastMessage, textMessage, pushFlexMessage } from './line.js';
import { getUsersBySegment, getAllActiveUsers } from './users.js';
import { wrapLink } from './tracking.js';

// 取得推播目標用戶
async function getUsersForPush({ segments, allUsers, excludeEnrolled, adminOnly }) {
  if (adminOnly) {
    const { data: admins } = await supabase
      .from('official_line_users')
      .select('line_user_id')
      .contains('tags', ['管理者'])
      .eq('is_blocked', false);
    return (admins || []).map((u) => u.line_user_id);
  }

  let userIds = allUsers ? await getAllActiveUsers() : await getUsersBySegment(segments);

  if (excludeEnrolled && userIds.length > 0) {
    const { data: enrolled } = await supabase
      .from('official_line_users')
      .select('line_user_id')
      .contains('tags', ['已報名減重班']);
    const enrolledSet = new Set((enrolled || []).map((u) => u.line_user_id));
    userIds = userIds.filter((id) => !enrolledSet.has(id));
  }

  return userIds;
}

// 發送排程推播（回傳 { sent, total } 或 null 表示找不到）
export async function sendScheduledPush(logId) {
  const { data: log, error: logError } = await supabase
    .from('official_push_logs')
    .select('*')
    .eq('id', logId)
    .eq('status', 'scheduled')
    .single();

  if (logError || !log) return null;

  const isAdminOnly = log.segments?.includes('admin') && log.segments.length === 1;
  const isAllUsers = !isAdminOnly && log.segments?.length >= 4;
  const userIds = await getUsersForPush({
    segments: log.segments,
    adminOnly: isAdminOnly,
    allUsers: isAllUsers,
    excludeEnrolled: log.exclude_enrolled || false,
  });

  if (userIds.length === 0) {
    await supabase
      .from('official_push_logs')
      .update({ status: 'completed', sent_count: 0, completed_at: new Date().toISOString() })
      .eq('id', logId);
    return { sent: 0, total: 0 };
  }

  // 組合訊息
  const useFlexMsg = (Array.isArray(log.buttons) && log.buttons.length > 0) || !!log.image_url;
  let lineMsg;

  if (useFlexMsg) {
    const cleanButtons = (log.buttons || []).filter((b) => b.label && b.url);
    const trackedButtons = cleanButtons.map((btn, i) => ({
      ...btn,
      url: wrapLink(btn.url, `${log.link_id}_b${i}`),
    }));
    const lines = log.message.split('\n').filter((l) => l.trim());
    const title = lines[0] || log.message;
    const body = lines.slice(1).join('\n').trim();
    lineMsg = pushFlexMessage({ title, body, buttons: trackedButtons, imageUrl: log.image_url || undefined });
  } else {
    let finalMessage = log.message;
    if (log.link_url && log.link_id) {
      const trackedUrl = wrapLink(log.link_url, log.link_id);
      finalMessage += `\n\n👉 點這裡\n${trackedUrl}`;
    }
    lineMsg = textMessage(finalMessage);
  }

  // 發送
  let sent = 0;
  for (let i = 0; i < userIds.length; i += 500) {
    const batch = userIds.slice(i, i + 500);
    const ok = await multicastMessage(batch, lineMsg);
    if (ok) sent += batch.length;
  }

  // 更新紀錄
  await supabase
    .from('official_push_logs')
    .update({ sent_count: sent, status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', logId);

  return { sent, total: userIds.length };
}
