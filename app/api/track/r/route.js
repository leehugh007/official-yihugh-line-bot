// 連結追蹤轉址
// GET /api/track/r?id=linkId&u=userId&url=targetUrl
// 記錄點擊後 302 轉址到目標 URL

import { NextResponse } from 'next/server';
import { recordPushClick } from '../../../../lib/users.js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const linkId = searchParams.get('id');
  const userId = searchParams.get('u');
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  if (userId && linkId) {
    try {
      await recordPushClick(userId, linkId);
    } catch (err) {
      console.error('[Track] Error:', err);
    }
  }

  // 302 轉址
  return NextResponse.redirect(targetUrl, 302);
}
