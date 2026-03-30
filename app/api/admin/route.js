// 管理 API — 統一入口
// GET  /api/admin?action=stats|templates|logs&secret=xxx
// POST /api/admin  { secret, action, ...data }

import { NextResponse } from 'next/server';
import supabase from '../../../lib/supabase.js';
import { multicastMessage, pushMessage, textMessage } from '../../../lib/line.js';
import { getUsersBySegment, getAllActiveUsers } from '../../../lib/users.js';
import { wrapLink } from '../../../lib/tracking.js';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

// ============================================================
// GET — 讀取資料
// ============================================================
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  const action = searchParams.get('action');

  if (secret !== process.env.ADMIN_SECRET) return unauthorized();

  switch (action) {
    case 'stats':
      return handleGetStats();
    case 'templates':
      return handleGetTemplates();
    case 'logs':
      return handleGetLogs();
    case 'drip':
      return handleGetDrip();
    case 'drip_stats':
      return handleGetDripStats();
    case 'users':
      return handleGetUsers(searchParams);
    case 'sources':
      return handleGetSources();
    case 'settings':
      return handleGetSettings();
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}

// ============================================================
// POST — 寫入 / 執行
// ============================================================
export async function POST(request) {
  const body = await request.json();
  const { secret, action, ...data } = body;

  if (secret !== process.env.ADMIN_SECRET) return unauthorized();

  switch (action) {
    case 'update_template':
      return handleUpdateTemplate(data);
    case 'push':
      return handlePush(data);
    case 'process_queue':
      return handleProcessQueue(data);
    case 'count_targets':
      return handleCountTargets(data);
    case 'update_drip':
      return handleUpdateDrip(data);
    case 'update_user_tags':
      return handleUpdateUserTags(data);
    case 'add_source':
      return handleAddSource(data);
    case 'delete_source':
      return handleDeleteSource(data);
    case 'update_setting':
      return handleUpdateSetting(data);
    case 'send_scheduled':
      return handleSendScheduled(data);
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}

// ============================================================
// 實作
// ============================================================

async function handleGetStats() {
  const { data: users } = await supabase
    .from('official_line_users')
    .select('segment, source, metabolism_type, is_blocked');

  const stats = {
    total: 0,
    blocked: 0,
    segments: { new: 0, active: 0, warm: 0, silent: 0 },
    sources: {},
    metabolismTypes: {},
  };

  users?.forEach((u) => {
    if (u.is_blocked) {
      stats.blocked++;
      return;
    }
    stats.total++;
    stats.segments[u.segment] = (stats.segments[u.segment] || 0) + 1;
    if (u.source) stats.sources[u.source] = (stats.sources[u.source] || 0) + 1;
    if (u.metabolism_type) stats.metabolismTypes[u.metabolism_type] = (stats.metabolismTypes[u.metabolism_type] || 0) + 1;
  });

  // 最近 7 天點擊
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const { count: recentClicks } = await supabase
    .from('official_line_clicks')
    .select('*', { count: 'exact', head: true })
    .gte('clicked_at', sevenDaysAgo.toISOString());

  stats.recentClicks7d = recentClicks || 0;
  return NextResponse.json(stats);
}

async function handleGetTemplates() {
  const { data } = await supabase
    .from('official_push_templates')
    .select('*')
    .order('sort_order');
  return NextResponse.json(data || []);
}

async function handleGetLogs() {
  const { data } = await supabase
    .from('official_push_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  // 為每筆 log 計算點擊數
  if (data) {
    for (const log of data) {
      if (log.link_id) {
        const { count } = await supabase
          .from('official_line_clicks')
          .select('*', { count: 'exact', head: true })
          .eq('link_id', log.link_id);
        log.click_count = count || 0;
      }
    }
  }

  return NextResponse.json(data || []);
}

async function handleGetDrip() {
  const { data } = await supabase
    .from('official_drip_schedule')
    .select('*')
    .order('step_number');
  return NextResponse.json(data || []);
}

async function handleUpdateTemplate(data) {
  const { id, ...updates } = data;
  updates.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from('official_push_templates')
    .update(updates)
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// 取得推播目標用戶（支援所有人 / 分群 / 排除已報名）
async function getUsersForPush({ segments, allUsers, excludeEnrolled }) {
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

async function handleCountTargets({ segments, allUsers, excludeEnrolled }) {
  const userIds = await getUsersForPush({ segments, allUsers, excludeEnrolled });
  return NextResponse.json({ count: userIds.length });
}

async function handlePush(data) {
  const { templateId, message, linkUrl, linkText, segments, mode, allUsers, excludeEnrolled } = data;

  // 取得目標用戶
  const userIds = await getUsersForPush({ segments, allUsers, excludeEnrolled });
  if (userIds.length === 0) {
    return NextResponse.json({ sent: 0, total: 0, message: '沒有符合條件的用戶' });
  }

  const linkId = templateId
    ? `${templateId}_${Date.now()}`
    : `custom_${Date.now()}`;

  // 建立推播紀錄
  const { data: logData, error: logError } = await supabase
    .from('official_push_logs')
    .insert({
      template_id: templateId || null,
      label: data.label || '自訂推播',
      message,
      link_url: linkUrl || null,
      link_id: linkUrl ? linkId : null,
      segments: allUsers ? ['active', 'warm', 'new', 'silent'] : segments,
      mode: mode || 'instant',
      target_count: userIds.length,
      sent_count: 0,
      status: 'sending',
      exclude_enrolled: excludeEnrolled || false,
    })
    .select()
    .single();

  if (logError) {
    return NextResponse.json({ error: logError.message }, { status: 500 });
  }

  const logId = logData.id;

  // 預約推播：如果有 scheduled_at 且在未來，存起來不發
  if (data.scheduled_at) {
    const scheduledTime = new Date(data.scheduled_at);
    if (scheduledTime > new Date()) {
      await supabase
        .from('official_push_logs')
        .update({ status: 'scheduled', scheduled_at: data.scheduled_at })
        .eq('id', logId);
      return NextResponse.json({ mode: 'scheduled', logId, scheduledAt: data.scheduled_at, total: userIds.length });
    }
  }

  if (mode === 'queued') {
    // 佇列模式：建立 queue entries，前端驅動 process
    const queueEntries = userIds.map((uid) => {
      let finalMessage = message;
      if (linkUrl) {
        const trackedUrl = wrapLink(linkUrl, linkId, uid);
        finalMessage += `\n\n👉 ${linkText || '點這裡'}\n${trackedUrl}`;
      }
      return {
        log_id: logId,
        line_user_id: uid,
        message: finalMessage,
        status: 'pending',
      };
    });

    // 分批插入（Supabase 單次最多 1000 筆）
    for (let i = 0; i < queueEntries.length; i += 500) {
      await supabase.from('official_push_queue').insert(queueEntries.slice(i, i + 500));
    }

    return NextResponse.json({
      mode: 'queued',
      logId,
      total: userIds.length,
      message: '已建立推播佇列',
    });
  }

  // 即時模式：multicast，統一追蹤連結
  let finalMessage = message;
  if (linkUrl) {
    const trackedUrl = wrapLink(linkUrl, linkId); // 不帶 userId
    finalMessage += `\n\n👉 ${linkText || '點這裡'}\n${trackedUrl}`;
  }

  let sent = 0;
  for (let i = 0; i < userIds.length; i += 500) {
    const batch = userIds.slice(i, i + 500);
    const ok = await multicastMessage(batch, textMessage(finalMessage));
    if (ok) sent += batch.length;
  }

  // 更新推播紀錄
  await supabase
    .from('official_push_logs')
    .update({ sent_count: sent, status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', logId);

  return NextResponse.json({ mode: 'instant', sent, total: userIds.length, logId });
}

async function handleProcessQueue({ logId }) {
  // 取 100 筆待處理
  const { data: entries } = await supabase
    .from('official_push_queue')
    .select('*')
    .eq('log_id', logId)
    .eq('status', 'pending')
    .limit(100);

  if (!entries || entries.length === 0) {
    // 全部處理完
    await supabase
      .from('official_push_logs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', logId);

    // 取最終送達數
    const { count: sentCount } = await supabase
      .from('official_push_queue')
      .select('*', { count: 'exact', head: true })
      .eq('log_id', logId)
      .eq('status', 'sent');

    await supabase
      .from('official_push_logs')
      .update({ sent_count: sentCount || 0 })
      .eq('id', logId);

    return NextResponse.json({ processed: 0, remaining: 0, done: true, sentCount });
  }

  // 逐筆發送
  let processed = 0;
  for (const entry of entries) {
    const ok = await pushMessage(entry.line_user_id, textMessage(entry.message));
    await supabase
      .from('official_push_queue')
      .update({
        status: ok ? 'sent' : 'failed',
        sent_at: new Date().toISOString(),
      })
      .eq('id', entry.id);
    if (ok) processed++;
  }

  // 計算剩餘
  const { count: remaining } = await supabase
    .from('official_push_queue')
    .select('*', { count: 'exact', head: true })
    .eq('log_id', logId)
    .eq('status', 'pending');

  // 更新送達數
  const { count: totalSent } = await supabase
    .from('official_push_queue')
    .select('*', { count: 'exact', head: true })
    .eq('log_id', logId)
    .eq('status', 'sent');

  await supabase
    .from('official_push_logs')
    .update({ sent_count: totalSent || 0 })
    .eq('id', logId);

  return NextResponse.json({
    processed,
    remaining: remaining || 0,
    done: (remaining || 0) === 0,
    sentCount: totalSent || 0,
  });
}

// ============================================================
// 排程管理
// ============================================================

async function handleGetDripStats() {
  // 各篇文章的推送數 + 點擊數
  const { data: schedule } = await supabase
    .from('official_drip_schedule')
    .select('*')
    .order('step_number');

  const { data: logs } = await supabase
    .from('official_drip_logs')
    .select('step_number, clicked');

  // 統計每篇
  const stepStats = {};
  logs?.forEach((log) => {
    if (!stepStats[log.step_number]) {
      stepStats[log.step_number] = { sent: 0, clicked: 0 };
    }
    stepStats[log.step_number].sent++;
    if (log.clicked) stepStats[log.step_number].clicked++;
  });

  // 排程中的用戶數
  const { count: activeCount } = await supabase
    .from('official_line_users')
    .select('*', { count: 'exact', head: true })
    .not('drip_next_at', 'is', null)
    .eq('drip_paused', false)
    .eq('is_blocked', false);

  // 已完成排程的用戶數
  const { count: completedCount } = await supabase
    .from('official_line_users')
    .select('*', { count: 'exact', head: true })
    .is('drip_next_at', null)
    .gt('drip_week', 0)
    .eq('is_blocked', false);

  // 因報名而停止的用戶數
  const { count: enrolledCount } = await supabase
    .from('official_line_users')
    .select('*', { count: 'exact', head: true })
    .eq('drip_paused', true)
    .eq('is_blocked', false);

  return NextResponse.json({
    schedule: schedule?.map((s) => ({
      ...s,
      sent_count: stepStats[s.step_number]?.sent || 0,
      click_count: stepStats[s.step_number]?.clicked || 0,
      click_rate: stepStats[s.step_number]?.sent
        ? Math.round((stepStats[s.step_number].clicked / stepStats[s.step_number].sent) * 100)
        : 0,
    })),
    activeUsers: activeCount || 0,
    completedUsers: completedCount || 0,
    enrolledUsers: enrolledCount || 0,
  });
}

async function handleUpdateDrip({ step_number, ...updates }) {
  const { error } = await supabase
    .from('official_drip_schedule')
    .update(updates)
    .eq('step_number', step_number);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// ============================================================
// 用戶管理
// ============================================================

async function handleGetUsers(searchParams) {
  const search = searchParams.get('search') || '';
  const segment = searchParams.get('segment') || '';
  const source = searchParams.get('source') || '';
  const tag = searchParams.get('tag') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = 50;

  let query = supabase
    .from('official_line_users')
    .select('line_user_id, display_name, metabolism_type, source, segment, joined_at, last_interaction_at, interaction_count, push_click_count, tags, is_blocked, drip_paused, drip_week', { count: 'exact' });

  if (search) {
    query = query.ilike('display_name', `%${search}%`);
  }
  if (segment) {
    query = query.eq('segment', segment);
  }
  if (source) {
    query = query.eq('source', source);
  }
  if (tag === 'enrolled') {
    query = query.contains('tags', ['已報名減重班']);
  } else if (tag === 'not_enrolled') {
    query = query.or('tags.is.null,not.tags.cs.{"已報名減重班"}');
  } else if (tag === 'interested') {
    query = query.contains('tags', ['有興趣']);
  }

  query = query
    .order('joined_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  const { data, count, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    users: data || [],
    total: count || 0,
    page,
    pageSize,
    totalPages: Math.ceil((count || 0) / pageSize),
  });
}

async function handleGetSources() {
  const { data, error } = await supabase
    .from('official_sources')
    .select('*')
    .order('created_at');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

async function handleAddSource({ id, name, url }) {
  if (!id || !name) {
    return NextResponse.json({ error: '來源 ID 和名稱為必填' }, { status: 400 });
  }

  const { error } = await supabase
    .from('official_sources')
    .insert({ id, name, url: url || null });

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: '此 ID 已存在' }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

const PROTECTED_SOURCES = ['quiz', 'direct', 'legacy', 'live'];

async function handleDeleteSource({ id }) {
  if (!id) {
    return NextResponse.json({ error: '缺少來源 ID' }, { status: 400 });
  }
  if (PROTECTED_SOURCES.includes(id)) {
    return NextResponse.json({ error: '系統預設來源不可刪除' }, { status: 400 });
  }

  const { error } = await supabase
    .from('official_sources')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

async function handleUpdateUserTags({ userId, tags }) {
  const updateData = { tags };

  // 如果加了「已報名減重班」，同時暫停排程（原子操作）
  if (tags.includes('已報名減重班')) {
    updateData.drip_paused = true;
  }

  const { error } = await supabase
    .from('official_line_users')
    .update(updateData)
    .eq('line_user_id', userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// ============================================================
// 設定管理
// ============================================================

async function handleGetSettings() {
  const { data } = await supabase
    .from('official_settings')
    .select('*')
    .order('key');
  return NextResponse.json(data || []);
}

async function handleUpdateSetting({ key, value }) {
  if (!key) {
    return NextResponse.json({ error: '缺少 key' }, { status: 400 });
  }
  const { error } = await supabase
    .from('official_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// ============================================================
// 預約推播：手動觸發發送
// ============================================================

async function handleSendScheduled({ logId }) {
  if (!logId) {
    return NextResponse.json({ error: '缺少 logId' }, { status: 400 });
  }

  // 取得排程紀錄
  const { data: log, error: logError } = await supabase
    .from('official_push_logs')
    .select('*')
    .eq('id', logId)
    .eq('status', 'scheduled')
    .single();

  if (logError || !log) {
    return NextResponse.json({ error: '找不到排程紀錄或已發送' }, { status: 404 });
  }

  // 重新取得目標用戶
  const userIds = await getUsersBySegment(log.segments);
  if (userIds.length === 0) {
    await supabase
      .from('official_push_logs')
      .update({ status: 'completed', sent_count: 0, completed_at: new Date().toISOString() })
      .eq('id', logId);
    return NextResponse.json({ sent: 0, total: 0, message: '沒有符合條件的用戶' });
  }

  // 組合訊息
  let finalMessage = log.message;
  if (log.link_url && log.link_id) {
    const trackedUrl = wrapLink(log.link_url, log.link_id);
    finalMessage += `\n\n👉 點這裡\n${trackedUrl}`;
  }

  // 發送
  let sent = 0;
  for (let i = 0; i < userIds.length; i += 500) {
    const batch = userIds.slice(i, i + 500);
    const ok = await multicastMessage(batch, textMessage(finalMessage));
    if (ok) sent += batch.length;
  }

  // 更新紀錄
  await supabase
    .from('official_push_logs')
    .update({ sent_count: sent, status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', logId);

  return NextResponse.json({ mode: 'sent_scheduled', sent, total: userIds.length, logId });
}
