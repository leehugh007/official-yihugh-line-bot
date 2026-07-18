// 3天看餐體驗自動邀請 cron — 每天 11:00 台灣（UTC 3:00）
// Vercel Cron: 0 3 * * *
// 手動觸發: GET /api/cron/trial-invite?secret=xxx
// 預覽（不發送）: GET /api/cron/trial-invite?secret=xxx&dryRun=1
//
// 邏輯全部在 lib/trial-invite.js（受眾/文案/開關），這裡只做 auth + 呼叫。
// 開關 trial_invite_enabled 預設 false：部署後這條 cron 是空轉的，
// 要在 official_settings 寫 trial_invite_enabled=true 才會真的發送。

import { NextResponse } from 'next/server';
import { runTrialInvite } from '../../../../lib/trial-invite.js';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  const isAuthorized =
    secret === process.env.ADMIN_SECRET ||
    request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runTrialInvite({ dryRun: searchParams.get('dryRun') === '1' });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[trial-invite cron] failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
