// 管理 API — 統一入口
// GET  /api/admin?action=stats|templates|logs&secret=xxx
// POST /api/admin  { secret, action, ...data }

import { NextResponse } from 'next/server';
import supabase from '../../../lib/supabase.js';
import { multicastMessage, pushMessage, textMessage, pushFlexMessage } from '../../../lib/line.js';
import { getUsersBySegment, getAllActiveUsers } from '../../../lib/users.js';
import { wrapLink } from '../../../lib/tracking.js';
import { sendScheduledPush } from '../../../lib/push.js';
import { normalizePublicUrl, isPublicHttpsUrl } from '../../../lib/config.js';
import {
  listApplications,
  getApplicationFull,
  markApplicationPaid,
  markApplicationCancelled,
  updatePaymentInfo,
} from '../../../lib/applications.js';
import { getFunnelStats, getFunnelUsers } from '../../../lib/funnel-analytics.js';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

const ADMIN_STATS_PAGE_SIZE = 1000;
const ADMIN_STATS_MAX_ROWS = 100000;
const DRIP_ARTICLE_TYPES = new Set(['student_story', 'health_article', 'intro', 'method', 'apply', 'other']);

async function fetchAllUsersForStats() {
  const rows = [];

  for (let offset = 0; ; offset += ADMIN_STATS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('official_line_users')
      .select('line_user_id, segment, source, metabolism_type, is_blocked')
      .order('joined_at', { ascending: true })
      .order('line_user_id', { ascending: true })
      .range(offset, offset + ADMIN_STATS_PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < ADMIN_STATS_PAGE_SIZE) break;

    if (rows.length >= ADMIN_STATS_MAX_ROWS) {
      console.warn(`[Admin stats] stopped at safety limit ${ADMIN_STATS_MAX_ROWS}`);
      break;
    }
  }

  return rows;
}

async function fetchAllAdminRows(buildQuery, label, maxRows = ADMIN_STATS_MAX_ROWS) {
  const rows = [];

  for (let offset = 0; ; offset += ADMIN_STATS_PAGE_SIZE) {
    const { data, error } = await buildQuery()
      .range(offset, offset + ADMIN_STATS_PAGE_SIZE - 1);

    if (error) {
      console.error(`[Admin] ${label} paged fetch failed:`, error);
      throw error;
    }

    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < ADMIN_STATS_PAGE_SIZE) break;

    if (rows.length >= maxRows) {
      console.warn(`[Admin] ${label} stopped at safety limit ${maxRows}`);
      break;
    }
  }

  return rows;
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
    case 'applications':
      return handleGetApplications(searchParams);
    case 'application':
      return handleGetApplicationFull(searchParams);
    case 'export_applications':
      return handleExportApplications(searchParams);
    case 'user_detail':
      return handleGetUserDetail(searchParams);
    case 'funnel_stats':
      return handleGetFunnelStats(searchParams);
    case 'funnel_users':
      return handleGetFunnelUsers(searchParams);
    case 'retargeting_dashboard':
      return handleGetRetargetingDashboard();
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

  const isResetV32TestUser = action === 'reset_v32_test_user';
  if (!isResetV32TestUser && secret !== process.env.ADMIN_SECRET) return unauthorized();

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
    case 'toggle_drip_active':
      return handleToggleDripActive(data);
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
    case 'upload_image':
      return handleUploadImage(data);
    case 'update_log':
      return handleUpdateLog(data);
    case 'delete_log':
      return handleDeleteLog(data);
    case 'toggle_drip_test_mode':
      return handleToggleDripTestMode(data);
    case 'reset_admin_drip':
      return handleResetAdminDrip();
    case 'save_retargeting_admin_config':
      return handleSaveRetargetingAdminConfig(data);
    case 'save_retargeting_library':
      return handleSaveRetargetingLibrary(data);
    case 'disable_retargeting_activity':
      return handleDisableRetargetingActivity(data);
    case 'delete_retargeting_activity':
      return handleDeleteRetargetingActivity(data);
    case 'add_drip_step':
      return handleAddDripStep(data);
    case 'delete_drip_step':
      return handleDeleteDripStep(data);
    case 'mark_application_paid':
      return handleMarkApplicationPaid(data);
    case 'cancel_application':
      return handleCancelApplication(data);
    case 'update_application_payment':
      return handleUpdateApplicationPayment(data);
    case 'reset_v32_test_user':
      return handleResetV32TestUser(data);
    case 'set_super_early_bird_cutoff':
      return handleSetPricingCutoff({ ...data, key: 'super_early_bird_cutoff_at' });
    case 'set_regular_early_bird_cutoff':
      return handleSetPricingCutoff({ ...data, key: 'regular_early_bird_cutoff_at' });
    case 'set_pricing_cutoff':
      return handleSetPricingCutoff(data);
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}

// ============================================================
// set_pricing_cutoff — V3.2 三段價任一截止日設定（migration_019 後支援 regular）
// ============================================================
// 後台兩個 cutoff 共用同一 handler：
//   - super_early_bird_cutoff_at  超早鳥截止
//   - regular_early_bird_cutoff_at 一般早鳥截止
//
// 三段價邏輯（lib/pricing.js）：
//   NOW < super_cutoff               → super ($10,400)
//   super_cutoff <= NOW < regular_cutoff → regular ($11,400)
//   NOW >= regular_cutoff            → anchor ($12,600 真實成交)
//
// 操作：立刻關 = cutoff = NOW；延長 = cutoff = 未來日；過去 = 立即生效
const ALLOWED_PRICING_KEYS = new Set([
  'super_early_bird_cutoff_at',
  'regular_early_bird_cutoff_at',
]);

async function handleSetPricingCutoff({ key, cutoff_at }) {
  if (!ALLOWED_PRICING_KEYS.has(key)) {
    return NextResponse.json({ error: `invalid key: ${key}` }, { status: 400 });
  }
  if (typeof cutoff_at !== 'string' || cutoff_at.length === 0) {
    return NextResponse.json({ error: 'cutoff_at required (ISO timestamp)' }, { status: 400 });
  }
  const parsed = new Date(cutoff_at);
  if (isNaN(parsed.getTime())) {
    return NextResponse.json({ error: 'cutoff_at not a valid ISO timestamp' }, { status: 400 });
  }
  const isoNormalized = parsed.toISOString();

  const { error } = await supabase
    .from('official_settings')
    .upsert({ key, value: isoNormalized }, { onConflict: 'key' });

  if (error) {
    console.error('[set_pricing_cutoff] error:', key, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = new Date();
  return NextResponse.json({
    ok: true,
    key,
    cutoff_at: isoNormalized,
    is_future: now < parsed,
    diff_ms: parsed.getTime() - now.getTime(),
  });
}

// ============================================================
// reset_v32_test_user — V3.2 試行測試專用，清 ALLOWLIST 用戶到 stage=0
// ============================================================
// 兩層保護：
//   1. ADMIN_SECRET（POST 入口已驗）
//   2. userId 必須在 hardcoded ALLOWLIST（一休 + 婉馨），不可清他人
// 不清：enrolled_at / enrolled_from_path（保留報名歷史）/ display_name / segment / source / interaction_count
const V32_RESET_ALLOWLIST = [
  'U51808e2cc195967eba53701518e6f547', // 一休
  'U3edf3d2114ee03ad81cff1fd35c04600', // 婉馨
];

async function handleResetV32TestUser({ userId }) {
  if (!userId || !V32_RESET_ALLOWLIST.includes(userId)) {
    return NextResponse.json(
      { error: 'userId not in V32 reset allowlist (僅一休/婉馨可清)' },
      { status: 403 }
    );
  }

  const { data, error } = await supabase
    .from('official_line_users')
    .update({
      path_stage: 0,
      path: null,
      current_weight: null,
      target_weight: null,
      last_user_reply_at: null,
      path_stage_updated_at: new Date().toISOString(),
      ai_tags: {},
      handoff_triggered_at: null,
      handoff_reason: null,
      // Q5 軟邀請軌
      q5_sent_at: null,
      q5_followup_trigger_source: null,
      q5_active_invite_sent_at: null,
      q5_intent: null,
      q5_classified_at: null,
      q5_click_count: 0,
      q5_clicked_at: null,
      q5_visit_followup_sent_at: null,
      // V3.2 自動推進漏斗 16 欄
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
    })
    .eq('line_user_id', userId)
    .select('line_user_id, display_name, path_stage, path, ai_tags, handoff_triggered_at')
    .single();

  if (error) {
    console.error('[reset_v32_test_user] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, cleared: data });
}

// ============================================================
// 實作
// ============================================================

async function handleGetStats() {
  let users;
  try {
    users = await fetchAllUsersForStats();
  } catch (error) {
    console.error('[handleGetStats] fetch users error:', error);
    return NextResponse.json({ error: 'stats_fetch_users_failed' }, { status: 500 });
  }

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

  // 為每筆 log 計算點擊數（用 prefix match 支援 Flex 多按鈕）
  if (data) {
    for (const log of data) {
      if (log.link_id) {
        const { count } = await supabase
          .from('official_line_clicks')
          .select('*', { count: 'exact', head: true })
          .like('link_id', `${log.link_id}%`);
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

  // 只更新資料庫欄位，過濾掉前端狀態（allUsers, adminOnly, excludeEnrolled）
  const validColumns = { message: 1, link_url: 1, link_text: 1, buttons: 1, image_url: 1, segments: 1, mode: 1, updated_at: 1 };
  const dbUpdates = {};
  Object.keys(updates).forEach((key) => {
    if (validColumns[key]) dbUpdates[key] = updates[key];
  });

  const { error } = await supabase
    .from('official_push_templates')
    .update(dbUpdates)
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// 取得推播目標用戶（支援所有人 / 分群 / 排除已報名 / 僅管理者）
async function getUsersForPush({ segments, allUsers, excludeEnrolled, adminOnly }) {
  // 僅管理者：只推給有「管理者」tag 的人
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

async function handleCountTargets({ segments, allUsers, excludeEnrolled, adminOnly }) {
  const userIds = await getUsersForPush({ segments, allUsers, excludeEnrolled, adminOnly });
  return NextResponse.json({ count: userIds.length });
}

function isUsableFlexButton(button = {}) {
  if (!button.label) return false;
  if (button.actionType === 'message' || (!button.url && (button.replyText || button.messageText))) {
    return !!(button.replyText || button.messageText || button.label);
  }
  return !!button.url;
}

function withTrackedButtonUrl(button, linkId, index, userId) {
  if (button.actionType === 'message' || (!button.url && (button.replyText || button.messageText))) {
    return {
      ...button,
      actionType: 'message',
      messageText: button.messageText || button.label,
    };
  }

  return {
    ...button,
    url: wrapLink(button.url, `${linkId}_b${index}`, userId),
  };
}

async function handlePush(data) {
  const { templateId, message, linkUrl, linkText, buttons, segments, mode, allUsers, excludeEnrolled, adminOnly, imageUrl } = data;

  // 取得目標用戶
  const userIds = await getUsersForPush({ segments, allUsers, excludeEnrolled, adminOnly });
  if (userIds.length === 0) {
    return NextResponse.json({ sent: 0, total: 0, message: '沒有符合條件的用戶' });
  }

  const linkId = templateId
    ? `${templateId}_${Date.now()}`
    : `custom_${Date.now()}`;

  const useFlexMsg = (Array.isArray(buttons) && buttons.length > 0) || !!imageUrl;

  // 建立推播紀錄
  const { data: logData, error: logError } = await supabase
    .from('official_push_logs')
    .insert({
      template_id: templateId || null,
      label: data.label || '自訂推播',
      message,
      link_url: useFlexMsg ? null : (linkUrl || null),
      link_id: (useFlexMsg || linkUrl) ? linkId : null,
      buttons: useFlexMsg ? buttons : [],
      image_url: imageUrl || null,
      segments: adminOnly ? ['admin'] : allUsers ? ['active', 'warm', 'new', 'silent'] : segments,
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

  // Flex Message 固定使用 multicast（不支援佇列模式的個人化追蹤連結）
  if (useFlexMsg) {
    const cleanButtons = (buttons || []).filter(isUsableFlexButton);
    const lines = message.split('\n').filter((l) => l.trim());
    const title = lines[0] || message;
    const body = lines.slice(1).join('\n').trim();

    let sent = 0;

    if (adminOnly) {
      for (const userId of userIds) {
        const trackedButtons = cleanButtons.map((btn, i) => withTrackedButtonUrl(btn, linkId, i, userId));
        const lineMsg = pushFlexMessage({ title, body, buttons: trackedButtons, imageUrl: imageUrl || undefined });
        const ok = await pushMessage(userId, lineMsg);
        if (ok) sent++;
      }
    } else {
      const trackedButtons = cleanButtons.map((btn, i) => withTrackedButtonUrl(btn, linkId, i));
      const lineMsg = pushFlexMessage({ title, body, buttons: trackedButtons, imageUrl: imageUrl || undefined });

      for (let i = 0; i < userIds.length; i += 500) {
        const batch = userIds.slice(i, i + 500);
        const ok = await multicastMessage(batch, lineMsg);
        if (ok) sent += batch.length;
      }
    }

    await supabase
      .from('official_push_logs')
      .update({ sent_count: sent, status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', logId);

    return NextResponse.json({ mode: 'instant', sent, total: userIds.length, logId });
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
  // 各篇文章的推送數 + 點擊數（從 clicks 表統計，支援個人化追蹤）
  const { data: schedule } = await supabase
    .from('official_drip_schedule')
    .select('*')
    .order('step_number');

  // 發送數：從 drip_logs 統計
  const { data: logs } = await supabase
    .from('official_drip_logs')
    .select('step_number, line_user_id, sent_at');

  // 點擊數：從 official_line_clicks 統計（link_id = drip_N）
  const { data: clicks } = await supabase
    .from('official_line_clicks')
    .select('link_id, line_user_id')
    .like('link_id', 'drip_%');

  // 統計每篇
  const stepStats = {};
  logs?.forEach((log) => {
    if (!stepStats[log.step_number]) {
      stepStats[log.step_number] = { sent: 0, clickedUsers: new Set() };
    }
    stepStats[log.step_number].sent++;
  });

  // 點擊去重（同一用戶多次點擊只算一次）
  clicks?.forEach((click) => {
    const match = click.link_id.match(/^drip_(\d+)/);
    if (match) {
      const step = parseInt(match[1], 10);
      if (!stepStats[step]) stepStats[step] = { sent: 0, clickedUsers: new Set() };
      if (click.line_user_id) stepStats[step].clickedUsers.add(click.line_user_id);
    }
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

  // 測試模式狀態
  const { data: testModeSetting } = await supabase
    .from('official_settings')
    .select('value')
    .eq('key', 'drip_test_mode')
    .single();
  const dripTestMode = testModeSetting?.value === 'true';

  return NextResponse.json({
    dripTestMode,
    schedule: schedule?.map((s) => {
      const stats = stepStats[s.step_number];
      const sentCount = stats?.sent || 0;
      const clickCount = stats?.clickedUsers?.size || 0;
      return {
        ...s,
        sent_count: sentCount,
        click_count: clickCount,
        click_rate: sentCount > 0 ? Math.round((clickCount / sentCount) * 100) : 0,
      };
    }),
    activeUsers: activeCount || 0,
    completedUsers: completedCount || 0,
    enrolledUsers: enrolledCount || 0,
  });
}

async function handleUpdateDrip({ step_number, ...updates }) {
  const validColumns = {
    title: 1,
    message: 1,
    link_url: 1,
    link_text: 1,
    image_url: 1,
    delay_days: 1,
    send_hour: 1,
    exclude_tag: 1,
    article_type: 1,
  };
  const dbUpdates = {};
  Object.keys(updates || {}).forEach((key) => {
    if (!validColumns[key]) return;
    dbUpdates[key] = key === 'article_type' && !DRIP_ARTICLE_TYPES.has(updates[key])
      ? 'other'
      : updates[key];
  });
  if (Object.keys(dbUpdates).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabase
    .from('official_drip_schedule')
    .update(dbUpdates)
    .eq('step_number', step_number);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// 啟用/停用排程文章（啟用前驗證內容）
async function handleToggleDripActive({ step_number, active }) {
  // 啟用時驗證內容
  if (active) {
    const { data: article } = await supabase
      .from('official_drip_schedule')
      .select('message, link_url')
      .eq('step_number', step_number)
      .single();

    if (!article) {
      return NextResponse.json({ error: '找不到這篇文章' }, { status: 404 });
    }

    const errors = [];
    if (!article.message || article.message.trim() === '') {
      errors.push('訊息內容不能為空');
    }
    if (article.message?.includes('待填入')) {
      errors.push('訊息內容還是 placeholder');
    }
    if (article.link_url?.includes('example.com')) {
      errors.push('文章連結還是 example.com');
    }
    if (!article.link_url || article.link_url.trim() === '') {
      errors.push('文章連結不能為空');
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join('、'), validationErrors: errors }, { status: 400 });
    }
  }

  const { error } = await supabase
    .from('official_drip_schedule')
    .update({ is_active: active })
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

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function summarizeRetargetingState(state = {}, activityId = null) {
  const rows = Object.values(state || {}).filter((row) => !activityId || row?.activityId === activityId);
  const stageCounts = { 1: { pending: 0, sent: 0, observing: 0, failed: 0 }, 2: { pending: 0, sent: 0, observing: 0, failed: 0 }, 3: { pending: 0, sent: 0, observing: 0, failed: 0 } };
  const cycleStageCounts = {};
  const now = new Date();
  const ensureCycleStage = (cycle, stage) => {
    const cycleKey = String(Number(cycle) || 1);
    const stageKey = String(Number(stage) || 1);
    if (!cycleStageCounts[cycleKey]) cycleStageCounts[cycleKey] = {};
    if (!cycleStageCounts[cycleKey][stageKey]) {
      cycleStageCounts[cycleKey][stageKey] = { pending: 0, sent: 0, observing: 0, failed: 0 };
    }
    return cycleStageCounts[cycleKey][stageKey];
  };
  for (const row of rows) {
    const pendingStage = Number(row?.pending?.stage || 0);
    const pendingCycle = Number(row?.pending?.cycle || 1);
    if (stageCounts[pendingStage]) stageCounts[pendingStage].pending += 1;
    if (pendingStage) ensureCycleStage(pendingCycle, pendingStage).pending += 1;
    const lastStage = Number(row?.lastStage || 0);
    const lastCycle = Number(row?.lastCycle || row?.currentCycle || 1);
    if (stageCounts[lastStage]) {
      if (row?.lastSentAt) stageCounts[lastStage].sent += 1;
      if (row?.observingUntil && new Date(row.observingUntil) > now) stageCounts[lastStage].observing += 1;
      if (row?.lastError) stageCounts[lastStage].failed += 1;
    }
    if (lastStage) {
      const nested = ensureCycleStage(lastCycle, lastStage);
      if (row?.lastSentAt) nested.sent += 1;
      if (row?.observingUntil && new Date(row.observingUntil) > now) nested.observing += 1;
      if (row?.lastError) nested.failed += 1;
    }
  }
  return {
    users: rows.length,
    sent: rows.filter((row) => row?.lastSentAt).length,
    pending: rows.filter((row) => row?.pending?.scheduledAt).length,
    failed: rows.filter((row) => row?.lastError).length,
    observing: rows.filter((row) => row?.observingUntil && new Date(row.observingUntil) > new Date()).length,
    observed: rows.filter((row) => row?.observedAt).length,
    lastAttemptAt: rows
      .map((row) => row?.lastAttemptAt)
      .filter(Boolean)
      .sort()
      .at(-1) || null,
    lastError: rows
      .filter((row) => row?.lastError)
      .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')))
      .at(-1)?.lastError || null,
    lastUpdatedAt: rows
      .map((row) => row?.updatedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || null,
    lastSkipAt: rows
      .map((row) => row?.lastSkipAt)
      .filter(Boolean)
      .sort()
      .at(-1) || null,
    lastSkipReason: rows
      .filter((row) => row?.lastSkipReason)
      .sort((a, b) => String(a.lastSkipAt || a.updatedAt || '').localeCompare(String(b.lastSkipAt || b.updatedAt || '')))
      .at(-1)?.lastSkipReason || null,
    nextCheckAfter: rows
      .map((row) => row?.nextCheckAfter)
      .filter(Boolean)
      .filter((value) => new Date(value) > now)
      .sort()
      .at(0) || null,
    lastWindowKey: rows
      .filter((row) => row?.lastWindowKey || row?.windowKey)
      .sort((a, b) => String(a.updatedAt || a.lastSkipAt || '').localeCompare(String(b.updatedAt || b.lastSkipAt || '')))
      .map((row) => row.lastWindowKey || row.windowKey)
      .at(-1) || null,
    stageCounts,
    cycleStageCounts,
    nextScheduledAt: rows
      .map((row) => row?.pending?.scheduledAt)
      .filter(Boolean)
      .filter((value) => new Date(value) > now)
      .sort()
      .at(0) || null,
    observingUntil: rows
      .map((row) => row?.observingUntil)
      .filter(Boolean)
      .filter((value) => new Date(value) > now)
      .sort()
      .at(0) || null,
  };
}

function summarizeRetargetingStatesByActivity(state = {}, activities = []) {
  const activityIds = new Set(
    (activities || [])
      .map((activity) => activity?.activityId || activity?.id)
      .filter(Boolean)
  );
  for (const row of Object.values(state || {})) {
    if (row?.activityId) activityIds.add(row.activityId);
  }
  return Object.fromEntries(
    [...activityIds].map((activityId) => [activityId, summarizeRetargetingState(state, activityId)])
  );
}

function getRetargetingActivityIdFromTemplateId(templateId = '') {
  const match = String(templateId || '').match(/^retargeting_auto_(.+?)_c\d+_s\d+(?:_|$)/);
  return match ? match[1] : null;
}

function getRetargetingUserIdFromLog(log = {}) {
  const segment = (log.segments || []).find((item) => String(item || '').startsWith('user:'));
  return segment ? String(segment).slice(5) : null;
}

function normalizeRetargetingActivityLibrary(items = [], config = null) {
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  const map = new Map();
  for (const item of rows) {
    const id = item.activityId || item.id;
    if (!id) continue;
    map.set(id, {
      ...item,
      activityId: id,
      id,
      enabled: !!item.enabled,
      priority: Math.max(1, Number(item.priority || map.size + 1)),
      updatedAt: item.updatedAt || item.updated_at || null,
    });
  }
  if (config?.activityId && !config.deletedAt) {
    map.set(config.activityId, {
      ...(map.get(config.activityId) || {}),
      ...config,
      id: config.activityId,
      activityId: config.activityId,
      priority: Math.max(1, Number(config.priority || 1)),
      isCurrentConfig: true,
    });
  }
  return [...map.values()].sort((a, b) => (
    Number(a.priority || 999) - Number(b.priority || 999)
    || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  ));
}

function createRetargetingOutcomeSummary(logs = [], clicks = [], users = [], applications = []) {
  const byActivity = {};
  const ensure = (activityId) => {
    if (!byActivity[activityId]) {
      byActivity[activityId] = {
        logs: 0,
        targetCount: 0,
        sentCount: 0,
        failedCount: 0,
        observedCount: 0,
        clickCount: 0,
        clickedUsers: 0,
        repliedUsers: 0,
        applyClickUsers: 0,
        submittedUsers: 0,
        paidUsers: 0,
        blockedUsers: 0,
        trackedUsers: 0,
        firstLogAt: null,
        lastLogAt: null,
      };
    }
    return byActivity[activityId];
  };

  const clickCountsByLink = {};
  const clickedUsersByActivity = {};
  const linkPrefixesByActivity = {};
  for (const click of clicks || []) {
    const linkId = String(click.link_id || '');
    clickCountsByLink[linkId] = (clickCountsByLink[linkId] || 0) + 1;
  }

  const userIdsByActivity = {};
  for (const log of logs || []) {
    const activityId = getRetargetingActivityIdFromTemplateId(log.template_id);
    if (!activityId) continue;
    const summary = ensure(activityId);
    summary.logs += 1;
    summary.targetCount += Number(log.target_count || 0);
    summary.sentCount += Number(log.sent_count || 0);
    if (log.status === 'failed') summary.failedCount += 1;
    if (log.status === 'observed') summary.observedCount += 1;
    summary.clickCount += log.link_id
      ? Object.entries(clickCountsByLink)
        .filter(([linkId]) => String(linkId || '').startsWith(log.link_id))
        .reduce((sum, [, count]) => sum + count, 0)
      : 0;
    if (log.link_id) {
      if (!linkPrefixesByActivity[activityId]) linkPrefixesByActivity[activityId] = new Set();
      linkPrefixesByActivity[activityId].add(log.link_id);
    }
    const userId = getRetargetingUserIdFromLog(log);
    if (userId) {
      if (!userIdsByActivity[activityId]) userIdsByActivity[activityId] = new Set();
      userIdsByActivity[activityId].add(userId);
    }
    const createdAt = log.completed_at || log.created_at;
    if (createdAt && (!summary.firstLogAt || createdAt < summary.firstLogAt)) summary.firstLogAt = createdAt;
    if (createdAt && (!summary.lastLogAt || createdAt > summary.lastLogAt)) summary.lastLogAt = createdAt;
  }

  for (const click of clicks || []) {
    const activityId = getRetargetingActivityIdFromTemplateId(click.link_id);
    if (!activityId || !click.line_user_id) continue;
    const linkPrefixes = [...(linkPrefixesByActivity[activityId] || [])];
    if (linkPrefixes.length > 0 && !linkPrefixes.some((prefix) => String(click.link_id || '').startsWith(prefix))) continue;
    if (!clickedUsersByActivity[activityId]) clickedUsersByActivity[activityId] = new Set();
    clickedUsersByActivity[activityId].add(click.line_user_id);
  }

  const userMap = new Map((users || []).map((user) => [user.line_user_id, user]));
  const appsByUser = new Map();
  for (const app of applications || []) {
    if (!app.line_user_id) continue;
    const existing = appsByUser.get(app.line_user_id);
    if (existing?.status === 'paid') continue;
    appsByUser.set(app.line_user_id, app);
  }

  for (const [activityId, userIds] of Object.entries(userIdsByActivity)) {
    const summary = ensure(activityId);
    const startedAt = summary.firstLogAt ? new Date(summary.firstLogAt) : null;
    const afterActivityStart = (iso) => {
      if (!iso) return false;
      if (!startedAt || Number.isNaN(startedAt.getTime())) return true;
      return new Date(iso) >= startedAt;
    };
    summary.trackedUsers = userIds.size;
    summary.clickedUsers = clickedUsersByActivity[activityId]?.size || 0;
    for (const userId of userIds) {
      const user = userMap.get(userId);
      const app = appsByUser.get(userId);
      if (
        afterActivityStart(user?.last_user_reply_at)
        || afterActivityStart(user?.last_interaction_at)
      ) summary.repliedUsers += 1;
      if (afterActivityStart(user?.q5_clicked_at)) summary.applyClickUsers += 1;
      if (app?.status && afterActivityStart(app.submitted_at)) summary.submittedUsers += 1;
      if (app?.status === 'paid' && afterActivityStart(app.paid_at || app.submitted_at)) summary.paidUsers += 1;
      if (user?.is_blocked && (!user.blocked_at || afterActivityStart(user.blocked_at))) summary.blockedUsers += 1;
    }
  }

  return byActivity;
}

async function fetchRetargetingRowsByUsers(userIds = [], buildQuery) {
  const ids = [...new Set(userIds.filter(Boolean))];
  const rows = [];
  const chunkSize = 300;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await buildQuery(chunk);
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

async function handleGetRetargetingDashboard() {
  const settingKeys = [
    'drip_test_mode',
    'retargeting_admin_auto_config',
    'retargeting_admin_auto_state',
    'retargeting_auto_state',
    'retargeting_audience_library',
    'retargeting_template_library',
    'retargeting_activity_library',
  ];
  const { data: settings, error: settingsError } = await supabase
    .from('official_settings')
    .select('key, value, updated_at')
    .in('key', settingKeys);

  if (settingsError) {
    return NextResponse.json({ error: settingsError.message }, { status: 500 });
  }

  const map = Object.fromEntries((settings || []).map((row) => [row.key, row]));
  const parsedConfig = safeJsonParse(map.retargeting_admin_auto_config?.value, null);
  const config = parsedConfig?.deletedAt ? null : parsedConfig;
  const adminState = safeJsonParse(map.retargeting_admin_auto_state?.value, {});
  const memberState = safeJsonParse(map.retargeting_auto_state?.value, {});

  let logs = [];
  try {
    logs = await fetchAllAdminRows(
      () => supabase
        .from('official_push_logs')
        .select('*')
        .like('template_id', 'retargeting_auto_%')
        .order('created_at', { ascending: false }),
      'retargeting push logs'
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let clicks = [];
  try {
    clicks = await fetchAllAdminRows(
      () => supabase
        .from('official_line_clicks')
        .select('line_user_id, link_id, clicked_at')
        .like('link_id', 'retargeting_auto_%')
        .order('clicked_at', { ascending: true }),
      'retargeting click stats'
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const clickIds = (clicks || []).map((row) => row.link_id);
  const realLogs = (logs || []).map((log) => ({
    ...log,
    click_count: log.link_id
      ? clickIds.filter((linkId) => String(linkId || '').startsWith(log.link_id)).length
      : 0,
  }));

  const trackedUserIds = [...new Set((realLogs || []).map(getRetargetingUserIdFromLog).filter(Boolean))];
  let trackedUsers = [];
  let trackedApplications = [];
  try {
    if (trackedUserIds.length > 0) {
      trackedUsers = await fetchRetargetingRowsByUsers(
        trackedUserIds,
        (ids) => supabase
          .from('official_line_users')
          .select('line_user_id, last_user_reply_at, last_interaction_at, q5_clicked_at, q5_click_count, is_blocked, blocked_at')
          .in('line_user_id', ids)
      );
      trackedApplications = await fetchRetargetingRowsByUsers(
        trackedUserIds,
        (ids) => supabase
          .from('official_program_applications')
          .select('line_user_id, status, submitted_at, paid_at')
          .in('line_user_id', ids)
          .order('submitted_at', { ascending: false })
      );
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const activityLibrary = normalizeRetargetingActivityLibrary(
    safeJsonParse(map.retargeting_activity_library?.value, []),
    config
  );
  const outcomeContext = map.drip_test_mode?.value === 'true' ? 'admin' : 'member';
  const outcomeLogs = (realLogs || []).filter((log) => (
    Array.isArray(log.segments) && log.segments.includes(outcomeContext)
  ));
  const activityOutcomes = createRetargetingOutcomeSummary(outcomeLogs, clicks, trackedUsers, trackedApplications);

  const { count: managerCount } = await supabase
    .from('official_line_users')
    .select('*', { count: 'exact', head: true })
    .contains('tags', ['管理者'])
    .eq('is_blocked', false);

  return NextResponse.json({
    ok: true,
    testMode: map.drip_test_mode?.value === 'true',
    config,
    configUpdatedAt: map.retargeting_admin_auto_config?.updated_at || null,
    adminState: summarizeRetargetingState(adminState, config?.activityId),
    memberState: summarizeRetargetingState(memberState, config?.activityId),
    adminActivityStates: summarizeRetargetingStatesByActivity(adminState, activityLibrary),
    memberActivityStates: summarizeRetargetingStatesByActivity(memberState, activityLibrary),
    audienceLibrary: safeJsonParse(map.retargeting_audience_library?.value, []),
    templateLibrary: safeJsonParse(map.retargeting_template_library?.value, []),
    activityLibrary,
    activityOutcomes,
    logs: realLogs,
    managerCount: managerCount || 0,
  });
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

// ============================================================
// 圖片上傳（Base64 → Supabase Storage）
// ============================================================
async function handleUploadImage({ fileName, fileBase64, contentType }) {
  if (!fileBase64 || !fileName) {
    return NextResponse.json({ error: '缺少檔案' }, { status: 400 });
  }

  // 驗證格式
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(contentType)) {
    return NextResponse.json({ error: '只支援 JPG / PNG / WebP' }, { status: 400 });
  }

  // 驗證大小（Base64 約為原檔 1.37 倍，2MB 原檔 ≈ 2.74MB Base64）
  if (fileBase64.length > 3 * 1024 * 1024) {
    return NextResponse.json({ error: '檔案不可超過 2MB' }, { status: 400 });
  }

  const buffer = Buffer.from(fileBase64, 'base64');
  const ext = contentType.split('/')[1] === 'jpeg' ? 'jpg' : contentType.split('/')[1];
  const storagePath = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '')}.${ext}`;

  let uploadResult;
  try {
    uploadResult = await supabase.storage
      .from('push-images')
      .upload(storagePath, buffer, { contentType, upsert: false });
  } catch (err) {
    return NextResponse.json({
      error: `圖片上傳服務連線失敗：${err?.message || 'fetch failed'}`,
    }, { status: 500 });
  }

  const { error } = uploadResult;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: urlData } = supabase.storage
    .from('push-images')
    .getPublicUrl(storagePath);

  return NextResponse.json({ url: urlData.publicUrl });
}

// ============================================================
// 預約推播：手動觸發發送（委託 lib/push.js 共用邏輯）
// ============================================================
async function handleSendScheduled({ logId }) {
  if (!logId) {
    return NextResponse.json({ error: '缺少 logId' }, { status: 400 });
  }

  const result = await sendScheduledPush(logId);

  if (!result) {
    return NextResponse.json({ error: '找不到排程紀錄或已發送' }, { status: 404 });
  }

  return NextResponse.json({ mode: 'sent_scheduled', sent: result.sent, total: result.total, logId });
}

// ============================================================
// 編輯排程紀錄（僅限 scheduled 狀態）
// ============================================================
async function handleUpdateLog(data) {
  const { id, ...updates } = data;
  if (!id) return NextResponse.json({ error: 'Missing log id' }, { status: 400 });

  // 確認是 scheduled 狀態才允許編輯
  const { data: log } = await supabase.from('official_push_logs').select('status').eq('id', id).single();
  if (!log) return NextResponse.json({ error: 'Log not found' }, { status: 404 });
  if (log.status !== 'scheduled') return NextResponse.json({ error: '只能編輯待發送的紀錄' }, { status: 400 });

  const validColumns = { message: 1, scheduled_at: 1, segments: 1, exclude_enrolled: 1, image_url: 1 };
  const dbUpdates = {};
  Object.keys(updates).forEach((key) => {
    if (validColumns[key]) dbUpdates[key] = updates[key];
  });

  const { error } = await supabase.from('official_push_logs').update(dbUpdates).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// ============================================================
// 刪除排程紀錄（僅限 scheduled 狀態）
// ============================================================
async function handleDeleteLog(data) {
  const { id } = data;
  if (!id) return NextResponse.json({ error: 'Missing log id' }, { status: 400 });

  // 確認是 scheduled 狀態才允許刪除
  const { data: log } = await supabase.from('official_push_logs').select('status').eq('id', id).single();
  if (!log) return NextResponse.json({ error: 'Log not found' }, { status: 404 });
  if (log.status !== 'scheduled') return NextResponse.json({ error: '只能刪除待發送的紀錄' }, { status: 400 });

  const { error } = await supabase.from('official_push_logs').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// ============================================================
// Drip 測試模式開關（存 official_settings）
// ============================================================
async function handleToggleDripTestMode({ enabled }) {
  if (!enabled) {
    const { data: settings, error: settingsError } = await supabase
      .from('official_settings')
      .select('key,value')
      .in('key', ['retargeting_admin_auto_config', 'retargeting_activity_library']);
    if (settingsError) return NextResponse.json({ error: settingsError.message }, { status: 500 });
    const map = Object.fromEntries((settings || []).map((row) => [row.key, row.value]));
    const config = safeJsonParse(map.retargeting_admin_auto_config, null);
    const activityLibrary = safeJsonParse(map.retargeting_activity_library, []);
    const readinessError = validateRetargetingFormalReadinessForActivities(config, activityLibrary);
    if (readinessError) {
      return NextResponse.json({
        error: `正式會員啟用前請先修正再行銷設定：${readinessError}`,
      }, { status: 400 });
    }
  }

  const { error } = await supabase
    .from('official_settings')
    .upsert({ key: 'drip_test_mode', value: String(enabled), updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, dripTestMode: enabled });
}

function clampConfigNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const normalized = Math.max(number, min);
  return Number.isFinite(max) ? Math.min(normalized, max) : normalized;
}

function cleanConfigText(value, fallback = '') {
  return String(value || fallback).slice(0, 120);
}

function defaultRetargetingEnabledConditions(ruleId = 'dropoff') {
  const base = {
    receivedMin: false,
    clickedMin: false,
    inactiveSteps: false,
    recentDays: false,
    joinedDays: false,
    applyDelayDays: false,
    applyClicks: false,
    paymentDelayDays: false,
    customArticleType: false,
    excludeApplyClickers: false,
    customExcludeSubmitted: false,
    customExcludePaid: false,
  };
  if (ruleId === 'dropoff') return { ...base, receivedMin: true, clickedMin: true, inactiveSteps: true };
  if (ruleId === 'warm') return { ...base, clickedMin: true, recentDays: true, excludeApplyClickers: true, customArticleType: true };
  if (ruleId === 'apply_no_submit') return { ...base, applyClicks: true, applyDelayDays: true, customExcludeSubmitted: true, customExcludePaid: true };
  if (ruleId === 'pending_payment') return { ...base, paymentDelayDays: true };
  if (ruleId === 'cold') return { ...base, receivedMin: true, joinedDays: true, clickedMin: true };
  return { ...base, clickedMin: true, customExcludeSubmitted: true, customExcludePaid: true, customArticleType: true };
}

function textHasTestMarker(value) {
  return /測試|test/i.test(String(value || ''));
}

function sanitizeRetargetingButton(button = {}) {
  const actionType = button.actionType === 'message' ? 'message' : 'url';
  const label = cleanConfigText(button.label || '');
  if (actionType === 'message') {
    return {
      label,
      actionType,
      url: '',
      messageText: cleanConfigText(button.messageText || label),
      replyText: String(button.replyText || '').slice(0, 2000),
    };
  }
  return {
    label,
    actionType,
    url: String(button.url || '').slice(0, 1000),
    messageText: cleanConfigText(button.messageText || label),
    replyText: '',
  };
}

function sanitizeRetargetingStageTemplate(template = {}, stage = 1) {
  return {
    stage,
    templateId: cleanConfigText(template.templateId || template.id || `stage_${stage}`),
    title: cleanConfigText(template.title || `第 ${stage} 階段模板`),
    category: cleanConfigText(template.category || '自動再行銷'),
    message: String(template.message || template.body || '').slice(0, 10000),
    imageUrl: normalizePublicUrl(template.imageUrl || template.image_url || ''),
    observeDays: template.observeDays == null
      ? null
      : clampConfigNumber(template.observeDays, 1, 1, 365),
    buttons: Array.isArray(template.buttons)
      ? template.buttons.slice(0, 3).map(sanitizeRetargetingButton)
      : [],
  };
}

function sanitizeRetargetingCycleFlow(flow = {}, cycle = 1, legacyTemplates = [], fallbackObserveDays = 1) {
  const stages = Array.isArray(flow.stages) ? flow.stages : [];
  return {
    cycle,
    enabled: cycle === 1 ? flow.enabled !== false : !!flow.enabled,
    finalAction: ['cooldown', 'manual', 'stop'].includes(flow.finalAction) ? flow.finalAction : 'cooldown',
    stages: [1, 2, 3].map((stageNumber) => {
      const stage = stages.find((item) => Number(item?.stage) === stageNumber) || legacyTemplates[stageNumber - 1] || {};
      const sanitized = sanitizeRetargetingStageTemplate(stage, stageNumber);
      return {
        ...sanitized,
        cycle,
        observeDays: clampConfigNumber(
          stage.observeDays ?? sanitized.observeDays ?? flow.observeDays,
          fallbackObserveDays,
          1,
          365
        ),
        enabled: stageNumber === 1
          ? (cycle === 1 ? flow.enabled !== false : !!flow.enabled)
          : !!stage.enabled,
      };
    }),
  };
}

function buildRetargetingCycleFlows(config = {}, legacyTemplates = []) {
  const rawFlows = Array.isArray(config.cycleFlows) ? config.cycleFlows.slice(0, 3) : [];
  const fallbackObserveDays = clampConfigNumber(config.observeDays, 1, 1, 365);
  if (rawFlows.length > 0) {
    return [1, 2, 3].map((cycle) => sanitizeRetargetingCycleFlow(
      rawFlows[cycle - 1] || { cycle, enabled: cycle === 1 },
      cycle,
      [],
      fallbackObserveDays
    ));
  }
  return [sanitizeRetargetingCycleFlow({
    cycle: 1,
    enabled: true,
    finalAction: config.thirdStageAction || 'cooldown',
    stages: legacyTemplates.map((template, index) => ({
      ...template,
      enabled: index === 0
        ? true
        : index === 1
          ? config.stage2Enabled !== false
          : config.stage2Enabled !== false && !!config.stage3Enabled,
    })),
  }, 1, legacyTemplates, fallbackObserveDays)];
}

function getActiveRetargetingStageTemplates(config = {}) {
  if (Array.isArray(config.cycleFlows) && config.cycleFlows.length > 0) {
    if (config.repeatStrategy !== 'staged') {
      return (config.cycleFlows[0]?.stages || []).filter((stage) => Number(stage.stage) === 1 && stage.enabled !== false);
    }
    return config.cycleFlows
      .filter((flow) => flow.enabled !== false)
      .flatMap((flow) => (flow.stages || []).filter((stage) => stage.enabled !== false && stage.message));
  }
  const templates = Array.isArray(config.stageTemplates) ? config.stageTemplates : [];
  if (config.repeatStrategy !== 'staged') return templates.slice(0, 1);
  const active = templates.slice(0, 1);
  if (config.stage2Enabled !== false && templates[1]) active.push(templates[1]);
  if (config.stage2Enabled !== false && config.stage3Enabled && templates[2]) active.push(templates[2]);
  return active;
}

function validateRetargetingAudienceReadiness(config = {}) {
  const conditions = config.audienceConditions && typeof config.audienceConditions === 'object'
    ? config.audienceConditions
    : {};
  const ruleId = conditions.presetId || config.ruleId || 'dropoff';
  const defaults = defaultRetargetingEnabledConditions(ruleId);
  const enabled = { ...defaults, ...(conditions.enabledConditions || {}) };
  const enabledKeys = Object.entries(enabled).filter(([, value]) => value).map(([key]) => key);
  if (enabledKeys.length === 0) return '受眾沒有啟用任何判斷條件';
  if (enabled.receivedMin && Number(conditions.receivedMin || config.receivedMin || 0) < 1) {
    return '受眾的「已收到至少幾篇」必須大於 0';
  }
  if (enabled.inactiveSteps && Number(conditions.inactiveSteps || config.missedSteps || 0) < 1) {
    return '受眾的「最近連續幾篇沒有點擊」必須大於 0';
  }
  if (enabled.clickedMin && ruleId !== 'cold' && Number(conditions.clickedMin || 0) < 1) {
    return '受眾的「至少點擊幾篇」必須大於 0';
  }
  if (enabled.recentDays && Number(conditions.recentDays || 0) < 1) {
    return '受眾的「最近幾天有互動」必須大於 0';
  }
  if (enabled.joinedDays && Number(conditions.joinedDays || 0) < 0) {
    return '受眾的「加入至少幾天」不能小於 0';
  }
  if (enabled.applyDelayDays && Number(conditions.applyDelayDays || 0) < 0) {
    return '受眾的「點報名頁後等待幾天」不能小於 0';
  }
  if (enabled.paymentDelayDays && Number(conditions.paymentDelayDays || 0) < 0) {
    return '受眾的「送單後等待付款幾天」不能小於 0';
  }
  if (enabled.customArticleType && !conditions.customArticleType) {
    return '受眾有啟用文章類型，但沒有選擇文章類型';
  }
  return null;
}

function validateRetargetingFormalReadiness(config = {}) {
  if (!config?.enabled) return null;
  const audienceError = validateRetargetingAudienceReadiness(config);
  if (audienceError) return audienceError;
  for (const template of getActiveRetargetingStageTemplates(config)) {
    if (!template?.message?.trim()) return `第 ${template.stage || '?'} 階段模板缺少訊息文字`;
    if (template.imageUrl && !isPublicHttpsUrl(template.imageUrl)) {
      return `「${template.title || '未命名模板'}」圖片必須是公開 HTTPS 網址`;
    }
    const textFields = [
      template.title,
      template.category,
      template.message,
      ...(template.buttons || []).flatMap((button) => [
        button.label,
        button.messageText,
        button.replyText,
      ]),
    ];
    if (textFields.some(textHasTestMarker)) {
      return `「${template.title || '未命名模板'}」仍含測試字樣，不能開放正式會員`;
    }
    for (const button of template.buttons || []) {
      if (!button?.label && !button?.url && !button?.replyText && !button?.messageText) continue;
      if (button.actionType === 'message') {
        if (!button.replyText?.trim()) return `「${template.title || '未命名模板'}」的文字回覆按鈕缺少 BOT 回覆文字`;
        continue;
      }
      if (!button.url || button.url.includes('example.com') || !isPublicHttpsUrl(button.url)) {
        return `「${template.title || '未命名模板'}」有未完成或非 HTTPS 的按鈕連結`;
      }
    }
  }
  return null;
}

function validateRetargetingFormalReadinessForActivities(config = null, activityLibrary = []) {
  const activities = normalizeRetargetingActivityLibrary(activityLibrary, config)
    .filter((activity) => activity.enabled !== false && activity.active !== false && !activity.deletedAt);

  for (const activity of activities) {
    const readinessError = validateRetargetingFormalReadiness(activity);
    if (readinessError) {
      const label = activity.activityName || activity.ruleTitle || activity.activityId || '未命名活動';
      return `${label}：${readinessError}`;
    }
  }

  return null;
}

function sanitizeRetargetingAudienceConditions(raw = {}, fallbackConfig = {}) {
  const conditions = raw && typeof raw === 'object' ? raw : {};
  const presetId = cleanConfigText(conditions.presetId || fallbackConfig.ruleId || 'dropoff');
  const defaults = defaultRetargetingEnabledConditions(presetId);
  const incomingEnabled = conditions.enabledConditions && typeof conditions.enabledConditions === 'object'
    ? conditions.enabledConditions
    : {};
  return {
    presetId,
    ruleTitle: cleanConfigText(conditions.ruleTitle || fallbackConfig.ruleTitle || '互動下降'),
    enabledConditions: Object.fromEntries(
      Object.keys(defaults).map((key) => [key, incomingEnabled[key] ?? defaults[key]])
    ),
    clickedMin: clampConfigNumber(conditions.clickedMin ?? conditions.customMinimumClicks, 2, 0),
    inactiveSteps: clampConfigNumber(conditions.inactiveSteps || fallbackConfig.missedSteps, 2, 1),
    recentDays: clampConfigNumber(conditions.recentDays, 14, 1),
    applyDelayDays: clampConfigNumber(conditions.applyDelayDays, 3, 0),
    applyClicks: clampConfigNumber(conditions.applyClicks, 1, 1),
    paymentDelayDays: clampConfigNumber(conditions.paymentDelayDays, 2, 0),
    receivedMin: clampConfigNumber(conditions.receivedMin || fallbackConfig.receivedMin, 3, 1),
    joinedDays: clampConfigNumber(conditions.joinedDays, 30, 1),
    storyOnly: !!conditions.storyOnly,
    excludeApplyClickers: conditions.excludeApplyClickers !== false,
    customAudienceName: cleanConfigText(conditions.customAudienceName || ''),
    customAudienceLogic: conditions.customAudienceLogic === 'any' ? 'any' : 'all',
    customArticleType: conditions.customArticleType === 'any' || DRIP_ARTICLE_TYPES.has(conditions.customArticleType)
      ? conditions.customArticleType
      : 'any',
    customMinimumClicks: clampConfigNumber(conditions.clickedMin ?? conditions.customMinimumClicks, 1, 1),
    customExcludeSubmitted: conditions.customExcludeSubmitted !== false,
    customExcludePaid: conditions.customExcludePaid !== false,
  };
}

async function saveRetargetingActivityLibrary(config) {
  const { data: currentSetting } = await supabase
    .from('official_settings')
    .select('value')
    .eq('key', 'retargeting_activity_library')
    .maybeSingle();
  const existing = safeJsonParse(currentSetting?.value, []);
  const now = new Date().toISOString();
  const activity = {
    ...config,
    id: config.activityId,
    activityId: config.activityId,
    active: config.enabled,
    priority: Math.max(1, Number(config.priority || 1)),
    updatedAt: now,
  };
  const merged = [
    activity,
    ...(Array.isArray(existing) ? existing : [])
      .filter((item) => (item.activityId || item.id) !== config.activityId)
      .map((item) => ({
        ...item,
        id: item.activityId || item.id,
        activityId: item.activityId || item.id,
        priority: Math.max(1, Number(item.priority || 999)),
        enabled: !!item.enabled,
        active: item.active !== false,
      })),
  ].slice(0, 50);

  const { error } = await supabase
    .from('official_settings')
    .upsert({
      key: 'retargeting_activity_library',
      value: JSON.stringify(merged),
      updated_at: now,
    });
  if (error) throw error;
  return merged;
}

async function handleSaveRetargetingAdminConfig({ config }) {
  if (!config || typeof config !== 'object') {
    return NextResponse.json({ error: '缺少再行銷設定' }, { status: 400 });
  }

  const audienceConditions = sanitizeRetargetingAudienceConditions(config.audienceConditions, config);
  const rawStageTemplates = Array.isArray(config.stageTemplates) ? config.stageTemplates.slice(0, 3) : [];
  const stageTemplates = rawStageTemplates.map((template, index) => sanitizeRetargetingStageTemplate(template, index + 1));
  const cycleFlows = buildRetargetingCycleFlows(config, stageTemplates);
  const cleanConfig = {
    activityId: cleanConfigText(config.activityId || `retargeting_${Date.now()}`),
    activityName: cleanConfigText(config.activityName || config.ruleTitle || '自動再行銷活動'),
    audienceId: cleanConfigText(config.audienceId || config.ruleId || 'dropoff'),
    firstTemplateId: cleanConfigText(config.firstTemplateId || config.stageTemplates?.[0]?.templateId || ''),
    priority: Math.max(1, Number(config.priority || 1)),
    enabled: !!config.enabled,
    observeOnly: !!config.observeOnly,
    ruleId: String(config.ruleId || 'dropoff'),
    ruleTitle: String(config.ruleTitle || '互動下降'),
    audienceRules: Array.isArray(config.audienceRules)
      ? config.audienceRules.map((rule) => cleanConfigText(rule)).filter(Boolean).slice(0, 12)
      : [],
    audienceConditions,
    receivedMin: audienceConditions.receivedMin,
    missedSteps: audienceConditions.inactiveSteps,
    checkDelayDays: Math.max(0, Number(config.checkDelayDays || 0)),
    sendMode: config.sendMode === 'instant' ? 'instant' : 'scheduled',
    sendDelayDays: Math.max(0, Number(config.sendDelayDays || 0)),
    sendAtTime: String(config.sendAtTime || '14:00'),
    observeDays: clampConfigNumber(
      cycleFlows[0]?.stages?.[0]?.observeDays,
      config.observeDays || 1,
      1,
      365
    ),
    engagementCriteria: String(config.engagementCriteria || 'any_click_or_reply'),
    repeatStrategy: String(config.repeatStrategy || 'staged'),
    stage2Enabled: cycleFlows[0]?.stages?.[1]?.enabled === true,
    stage3Enabled: cycleFlows[0]?.stages?.[2]?.enabled === true,
    thirdStageAction: String(config.thirdStageAction || 'cooldown'),
    stageTemplates: cycleFlows[0]?.stages || stageTemplates,
    cycleFlows,
    updatedAt: new Date().toISOString(),
  };

  const enabledTemplates = getActiveRetargetingStageTemplates(cleanConfig);
  if (!enabledTemplates.some((template) => Number(template.cycle || 1) === 1 && Number(template.stage || 1) === 1 && template.message)) {
    return NextResponse.json({ error: '第 1 次符合的第 1 階段模板缺少訊息文字' }, { status: 400 });
  }
  for (const template of enabledTemplates) {
    if (!template?.message?.trim()) {
      return NextResponse.json({ error: `第 ${template.cycle || 1} 次符合 / 第 ${template.stage || '?'} 階段模板缺少訊息文字` }, { status: 400 });
    }
  }
  const templateError = validateRetargetingTemplates(enabledTemplates);
  if (templateError) {
    return NextResponse.json({ error: templateError }, { status: 400 });
  }
  const { data: testModeSetting } = await supabase
    .from('official_settings')
    .select('value')
    .eq('key', 'drip_test_mode')
    .maybeSingle();
  if (testModeSetting?.value !== 'true') {
    const readinessError = validateRetargetingFormalReadiness(cleanConfig);
    if (readinessError) {
      return NextResponse.json({ error: `正式會員啟用前請先修正：${readinessError}` }, { status: 400 });
    }
  }

  const { error } = await supabase
    .from('official_settings')
    .upsert({
      key: 'retargeting_admin_auto_config',
      value: JSON.stringify(cleanConfig),
      updated_at: new Date().toISOString(),
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    const activityLibrary = await saveRetargetingActivityLibrary(cleanConfig);
    return NextResponse.json({ ok: true, config: cleanConfig, activityLibrary });
  } catch (activityError) {
    return NextResponse.json({ error: activityError.message }, { status: 500 });
  }
}

async function handleDisableRetargetingActivity({ activityId }) {
  if (!activityId) {
    return NextResponse.json({ error: '缺少 activityId' }, { status: 400 });
  }
  const now = new Date().toISOString();
  const { data: activitySetting } = await supabase
    .from('official_settings')
    .select('value')
    .eq('key', 'retargeting_activity_library')
    .maybeSingle();
  const library = safeJsonParse(activitySetting?.value, []);
  const updatedLibrary = (Array.isArray(library) ? library : []).map((item) => {
    const id = item.activityId || item.id;
    if (id !== activityId) return item;
    return { ...item, id, activityId: id, enabled: false, active: false, updatedAt: now };
  });

  const { data: configSetting } = await supabase
    .from('official_settings')
    .select('value')
    .eq('key', 'retargeting_admin_auto_config')
    .maybeSingle();
  const currentConfig = safeJsonParse(configSetting?.value, null);
  let config = currentConfig;
  if (currentConfig?.activityId === activityId) {
    config = { ...currentConfig, enabled: false, updatedAt: now };
    const { error: configError } = await supabase
      .from('official_settings')
      .upsert({
        key: 'retargeting_admin_auto_config',
        value: JSON.stringify(config),
        updated_at: now,
      });
    if (configError) return NextResponse.json({ error: configError.message }, { status: 500 });
  }

  const { error } = await supabase
    .from('official_settings')
    .upsert({
      key: 'retargeting_activity_library',
      value: JSON.stringify(updatedLibrary),
      updated_at: now,
    });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, config, activityLibrary: updatedLibrary });
}

async function handleDeleteRetargetingActivity({ activityId }) {
  if (!activityId) {
    return NextResponse.json({ error: '缺少 activityId' }, { status: 400 });
  }
  const now = new Date().toISOString();
  const { data: activitySetting } = await supabase
    .from('official_settings')
    .select('value')
    .eq('key', 'retargeting_activity_library')
    .maybeSingle();
  const library = safeJsonParse(activitySetting?.value, []);
  const updatedLibrary = (Array.isArray(library) ? library : [])
    .filter((item) => (item.activityId || item.id) !== activityId);

  const { data: configSetting } = await supabase
    .from('official_settings')
    .select('value')
    .eq('key', 'retargeting_admin_auto_config')
    .maybeSingle();
  const currentConfig = safeJsonParse(configSetting?.value, null);
  let config = currentConfig;
  if (currentConfig?.activityId === activityId) {
    config = { ...currentConfig, enabled: false, deletedAt: now, updatedAt: now };
    const { error: configError } = await supabase
      .from('official_settings')
      .upsert({
        key: 'retargeting_admin_auto_config',
        value: JSON.stringify(config),
        updated_at: now,
      });
    if (configError) return NextResponse.json({ error: configError.message }, { status: 500 });
  }

  const { error } = await supabase
    .from('official_settings')
    .upsert({
      key: 'retargeting_activity_library',
      value: JSON.stringify(updatedLibrary),
      updated_at: now,
    });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, config, activityLibrary: updatedLibrary });
}

function sanitizeRetargetingLibraryId(value, prefix) {
  const cleaned = String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80);
  return cleaned || `${prefix}_${Date.now()}`;
}

async function handleSaveRetargetingLibrary({ libraryType, items }) {
  if (!['audience', 'template'].includes(libraryType) || !Array.isArray(items)) {
    return NextResponse.json({ error: '受眾或模板資料格式錯誤' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const cleanItems = items.slice(0, 100).map((item) => {
    if (libraryType === 'audience') {
      const audienceConditions = sanitizeRetargetingAudienceConditions(item.audienceConditions, {
        ruleId: item.ruleId,
        ruleTitle: item.title,
      });
      return {
        id: sanitizeRetargetingLibraryId(item.id, 'audience'),
        title: cleanConfigText(item.title || audienceConditions.ruleTitle || '自訂受眾'),
        ruleId: cleanConfigText(item.ruleId || audienceConditions.presetId || 'custom'),
        rules: Array.isArray(item.rules)
          ? item.rules.map((rule) => cleanConfigText(rule)).filter(Boolean).slice(0, 20)
          : [],
        audienceConditions,
        active: item.active !== false,
        createdAt: item.createdAt || now,
        updatedAt: now,
      };
    }

    const buttons = Array.isArray(item.buttons)
      ? item.buttons.slice(0, 3).map(sanitizeRetargetingButton)
      : [];
    return {
      id: sanitizeRetargetingLibraryId(item.id, 'template'),
      title: cleanConfigText(item.title || '自訂模板'),
      category: cleanConfigText(item.category || '自訂'),
      image_url: normalizePublicUrl(item.image_url || '').slice(0, 2000),
      body: String(item.body || '').slice(0, 10000),
      buttons,
      active: item.active !== false,
      createdAt: item.createdAt || now,
      updatedAt: now,
    };
  });

  const key = libraryType === 'audience'
    ? 'retargeting_audience_library'
    : 'retargeting_template_library';
  const { error } = await supabase
    .from('official_settings')
    .upsert({ key, value: JSON.stringify(cleanItems), updated_at: now });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, items: cleanItems });
}

function validateRetargetingTemplates(stageTemplates) {
  for (const template of stageTemplates || []) {
    const label = template.cycle
      ? `第 ${template.cycle} 次符合 / 第 ${template.stage || '?'} 階段`
      : `第 ${template.stage || '?'} 階段`;
    if (!template?.message) continue;
    if (template.message.includes('待填入')) {
      return `${label}模板仍含待填入文字`;
    }
    if (template.imageUrl && !isPublicHttpsUrl(template.imageUrl)) {
      return `${label}模板圖片必須是公開 HTTPS 網址`;
    }
    for (const button of template.buttons || []) {
      if (!button?.label && !button?.url && !button?.replyText && !button?.messageText) continue;
      const isMessageButton = button.actionType === 'message' || (!button.url && (button.replyText || button.messageText));
      if (!button?.label) {
        return `${label}模板有按鈕缺少文字`;
      }
      if (isMessageButton) {
        if (!button.replyText) {
          return `${label}模板的文字回覆按鈕缺少 BOT 回覆內容`;
        }
        continue;
      }
      if (!button?.url) {
        return `${label}模板有連結按鈕缺少網址`;
      }
      let parsed;
      try {
        parsed = new URL(button.url);
      } catch {
        return `${label}模板按鈕網址格式不正確`;
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return `${label}模板按鈕網址必須是 http/https`;
      }
      if (parsed.hostname === 'example.com' || parsed.hostname.endsWith('.example.com')) {
        return `${label}模板仍使用 example.com 測試網址`;
      }
    }
  }
  return null;
}

async function handleResetAdminDrip() {
  const { data: admins, error: adminErr } = await supabase
    .from('official_line_users')
    .select('line_user_id')
    .contains('tags', ['管理者'])
    .eq('is_blocked', false);

  if (adminErr) return NextResponse.json({ error: adminErr.message }, { status: 500 });

  const userIds = (admins || []).map((u) => u.line_user_id).filter(Boolean);
  if (userIds.length === 0) {
    return NextResponse.json({ ok: true, reset: 0, deletedLogs: 0, deletedClicks: 0, deletedRetargetingLogs: 0 });
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('official_line_users')
    .update({
      drip_week: 0,
      drip_next_at: now,
      drip_paused: false,
    })
    .in('line_user_id', userIds);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  const { data: deletedLogs, error: logErr } = await supabase
    .from('official_drip_logs')
    .delete()
    .in('line_user_id', userIds)
    .select('line_user_id');

  if (logErr) return NextResponse.json({ error: logErr.message }, { status: 500 });

  const { data: deletedClicks, error: clickErr } = await supabase
    .from('official_line_clicks')
    .delete()
    .in('line_user_id', userIds)
    .like('link_id', 'drip_%')
    .select('line_user_id');

  if (clickErr) return NextResponse.json({ error: clickErr.message }, { status: 500 });

  const { data: deletedRetargetingLogs, error: retargetingLogErr } = await supabase
    .from('official_push_logs')
    .delete()
    .like('template_id', 'retargeting_auto_%')
    .contains('segments', ['admin'])
    .select('id');

  if (retargetingLogErr) return NextResponse.json({ error: retargetingLogErr.message }, { status: 500 });

  await supabase
    .from('official_settings')
    .upsert({
      key: 'retargeting_admin_auto_state',
      value: '{}',
      updated_at: new Date().toISOString(),
    });

  return NextResponse.json({
    ok: true,
    reset: userIds.length,
    deletedLogs: deletedLogs?.length || 0,
    deletedClicks: deletedClicks?.length || 0,
    deletedRetargetingLogs: deletedRetargetingLogs?.length || 0,
  });
}

// ============================================================
// 新增排程文章
// ============================================================
async function handleAddDripStep() {
  // 找出目前最大的 step_number
  const { data: existing } = await supabase
    .from('official_drip_schedule')
    .select('step_number')
    .order('step_number', { ascending: false })
    .limit(1);

  const nextStep = (existing?.[0]?.step_number || 0) + 1;

  const { error } = await supabase
    .from('official_drip_schedule')
    .insert({
      step_number: nextStep,
      title: `第 ${nextStep} 篇`,
      message: '',
      link_url: '',
      link_text: '閱讀文章',
      article_type: 'other',
      delay_days: 1,
      send_hour: 8,
      is_active: false,
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, step_number: nextStep });
}

// ============================================================
// 刪除排程文章（僅限未啟用的）
// ============================================================
async function handleDeleteDripStep({ step_number }) {
  if (!step_number) return NextResponse.json({ error: '缺少 step_number' }, { status: 400 });

  // 確認未啟用
  const { data: article } = await supabase
    .from('official_drip_schedule')
    .select('is_active')
    .eq('step_number', step_number)
    .single();

  if (!article) return NextResponse.json({ error: '找不到這篇文章' }, { status: 404 });
  if (article.is_active) return NextResponse.json({ error: '啟用中的文章不能刪除，請先停用' }, { status: 400 });

  // 檢查是否有人已收到這篇
  const { count } = await supabase
    .from('official_drip_logs')
    .select('*', { count: 'exact', head: true })
    .eq('step_number', step_number);

  if (count > 0) return NextResponse.json({ error: `已有 ${count} 人收到這篇，無法刪除` }, { status: 400 });

  const { error } = await supabase
    .from('official_drip_schedule')
    .delete()
    .eq('step_number', step_number);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// ============================================================
// Applications（Phase 4.5 報名管理）
// ============================================================

async function handleGetApplications(searchParams) {
  const filterRaw = (searchParams.get('filter') || 'all').toLowerCase();
  const FILTER_ALLOWED = new Set(['all', 'pending', 'paid', 'cancelled']);
  const filter = FILTER_ALLOWED.has(filterRaw) ? filterRaw : 'all';

  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200);
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

  try {
    const { rows, total } = await listApplications({ filter, limit, offset });
    return NextResponse.json({ ok: true, rows, total, filter, limit, offset });
  } catch (err) {
    console.error('[admin/applications] error:', err);
    return NextResponse.json({ error: err?.message || 'list_failed' }, { status: 500 });
  }
}

// /admin/user/[userId] 詳情頁用 — 拿單一用戶完整 row + 該用戶報名紀錄
// handoff push 通知裡的「開對話」連結點過去，婉馨 / 一休能看完整脈絡再回 LINE
async function handleGetUserDetail(searchParams) {
  const userId = searchParams.get('user_id');
  if (!userId || !/^U[0-9a-f]{32}$/.test(userId)) {
    return NextResponse.json({ error: 'invalid_user_id' }, { status: 400 });
  }

  try {
    // 1. 用戶基本 row
    const { data: user, error: userErr } = await supabase
      .from('official_line_users')
      .select('*')
      .eq('line_user_id', userId)
      .single();
    if (userErr || !user) {
      console.warn('[admin/user_detail] user not found:', userId, userErr?.message);
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
    }

    // 2. 該用戶所有報名紀錄（applications，不 mask）
    const { data: applications } = await supabase
      .from('official_program_applications')
      .select('*')
      .eq('line_user_id', userId)
      .order('submitted_at', { ascending: false });

    return NextResponse.json({
      ok: true,
      user,
      applications: applications || [],
    });
  } catch (err) {
    console.error('[admin/user_detail] error:', err);
    return NextResponse.json({ error: err?.message || 'fetch_failed' }, { status: 500 });
  }
}

// 匯出全部 applications（CSV 用）
// - 不 mask payment_last5（admin secret 已保護，匯出需要完整資料）
// - limit 5000（cover 任何合理規模，未來超過再分頁）
async function handleExportApplications(searchParams) {
  const filterRaw = (searchParams.get('filter') || 'all').toLowerCase();
  const FILTER_ALLOWED = new Set(['all', 'pending', 'paid', 'cancelled']);
  const filter = FILTER_ALLOWED.has(filterRaw) ? filterRaw : 'all';

  try {
    const { rows, total } = await listApplications({
      filter,
      limit: 5000,
      offset: 0,
      mask: false, // 匯出拿完整 payment_last5
    });
    return NextResponse.json({ ok: true, rows, total, filter });
  } catch (err) {
    console.error('[admin/export_applications] error:', err);
    return NextResponse.json({ error: err?.message || 'list_failed' }, { status: 500 });
  }
}

async function handleGetApplicationFull(searchParams) {
  const id = parseInt(searchParams.get('id') || '', 10);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }
  try {
    const app = await getApplicationFull(id);
    if (!app) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: true, application: app });
  } catch (err) {
    console.error('[admin/application] error:', err);
    return NextResponse.json({ error: err?.message || 'fetch_failed' }, { status: 500 });
  }
}

async function handleMarkApplicationPaid(data) {
  const { id, last5, amount, date, marked_by } = data || {};
  const idInt = parseInt(id, 10);
  const result = await markApplicationPaid(idInt, { last5, amount, date, marked_by });
  if (!result.ok) {
    const status =
      result.error === 'invalid_transition' || result.error === 'race_lost' ? 409 :
      result.error === 'not_found' ? 404 :
      400;
    return NextResponse.json({ error: result.error, detail: result.detail }, { status });
  }
  return NextResponse.json(result);
}

async function handleCancelApplication(data) {
  const { id, notes, marked_by } = data || {};
  const idInt = parseInt(id, 10);
  const result = await markApplicationCancelled(idInt, { notes, marked_by });
  if (!result.ok) {
    const status =
      result.error === 'invalid_transition' || result.error === 'race_lost' ? 409 :
      result.error === 'not_found' ? 404 :
      400;
    return NextResponse.json({ error: result.error, detail: result.detail }, { status });
  }
  return NextResponse.json(result);
}

async function handleUpdateApplicationPayment(data) {
  const { id, last5, amount, date, notes, marked_by } = data || {};
  const idInt = parseInt(id, 10);
  const result = await updatePaymentInfo(idInt, { last5, amount, date, notes, marked_by });
  if (!result.ok) {
    const status =
      result.error === 'race_lost' ? 409 :
      result.error === 'not_found' ? 404 :
      400;
    return NextResponse.json({ error: result.error, detail: result.detail }, { status });
  }
  return NextResponse.json(result);
}

// ============================================================
// 漏斗分析（Phase: funnel-analytics）
// ============================================================
async function handleGetFunnelStats(searchParams) {
  const rangeRaw = searchParams.get('range') || 'all';
  const rangeDays = rangeRaw === '7d' ? 7 : rangeRaw === '30d' ? 30 : 0;

  try {
    const data = await getFunnelStats({ rangeDays });
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    console.error('[admin/funnel_stats] error:', err);
    return NextResponse.json({ error: err?.message || 'funnel_stats_failed' }, { status: 500 });
  }
}

async function handleGetFunnelUsers(searchParams) {
  const rangeRaw = searchParams.get('range') || 'all';
  const rangeDays = rangeRaw === '7d' ? 7 : rangeRaw === '30d' ? 30 : 0;
  const paths = (searchParams.get('paths') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const metabolismTypes = (searchParams.get('metabolism') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const daysStuck = parseInt(searchParams.get('days_stuck') || '0', 10) || 0;
  const enrolledRaw = searchParams.get('enrolled');
  const enrolled = enrolledRaw === 'true' ? true : enrolledRaw === 'false' ? false : null;

  try {
    const data = await getFunnelUsers({ paths, metabolismTypes, daysStuck, enrolled, rangeDays });
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    console.error('[admin/funnel_users] error:', err);
    return NextResponse.json({ error: err?.message || 'funnel_users_failed' }, { status: 500 });
  }
}
