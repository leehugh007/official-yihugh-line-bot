// 統計 API — 查看用戶分層和推播數據
// GET /api/stats?secret=xxx

import { NextResponse } from 'next/server';
import supabase from '../../../lib/supabase.js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 各分層人數
  const { data: segments } = await supabase
    .from('official_line_users')
    .select('segment')
    .eq('is_blocked', false);

  const segmentCounts = { new: 0, active: 0, warm: 0, silent: 0 };
  segments?.forEach((u) => {
    segmentCounts[u.segment] = (segmentCounts[u.segment] || 0) + 1;
  });

  // 來源分佈
  const { data: sources } = await supabase
    .from('official_line_users')
    .select('source')
    .eq('is_blocked', false);

  const sourceCounts = {};
  sources?.forEach((u) => {
    sourceCounts[u.source] = (sourceCounts[u.source] || 0) + 1;
  });

  // 代謝類型分佈
  const { data: types } = await supabase
    .from('official_line_users')
    .select('metabolism_type')
    .eq('is_blocked', false)
    .not('metabolism_type', 'is', null);

  const typeCounts = {};
  types?.forEach((u) => {
    typeCounts[u.metabolism_type] = (typeCounts[u.metabolism_type] || 0) + 1;
  });

  // 封鎖數
  const { count: blockedCount } = await supabase
    .from('official_line_users')
    .select('*', { count: 'exact', head: true })
    .eq('is_blocked', true);

  // 最近 7 天點擊數
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const { count: recentClicks } = await supabase
    .from('official_line_clicks')
    .select('*', { count: 'exact', head: true })
    .gte('clicked_at', sevenDaysAgo.toISOString());

  return NextResponse.json({
    total: segments?.length || 0,
    blocked: blockedCount || 0,
    segments: segmentCounts,
    sources: sourceCounts,
    metabolismTypes: typeCounts,
    recentClicks7d: recentClicks || 0,
  });
}
