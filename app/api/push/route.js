// 推播 API
// POST /api/push
// Body: { segments: ['active', 'warm'], message: '...', linkUrl?: '...', linkId?: '...' }
// Header: x-admin-secret

import { NextResponse } from 'next/server';
import { multicastMessage, pushMessage, textMessage } from '../../../lib/line.js';
import { getUsersBySegment, getAllActiveUsers } from '../../../lib/users.js';
import { wrapLink } from '../../../lib/tracking.js';

export async function POST(request) {
  // 驗證管理密鑰
  const secret = request.headers.get('x-admin-secret');
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { segments, message, linkUrl, linkId, linkText } = body;

    if (!message) {
      return NextResponse.json({ error: 'Missing message' }, { status: 400 });
    }

    // 取得目標用戶
    let userIds;
    if (segments && segments.length > 0) {
      userIds = await getUsersBySegment(segments);
    } else {
      userIds = await getAllActiveUsers();
    }

    if (userIds.length === 0) {
      return NextResponse.json({ sent: 0, message: 'No users in segments' });
    }

    // 組合訊息
    let finalMessage = message;

    // 如果有連結，附加追蹤連結
    if (linkUrl && linkId) {
      const trackedLinks = userIds.map((uid) => ({
        userId: uid,
        url: wrapLink(linkUrl, linkId, uid),
      }));

      // 每人發個人化追蹤連結（因為每人的追蹤 URL 不同）
      let sent = 0;
      for (const { userId, url } of trackedLinks) {
        const text = `${message}\n\n👉 ${linkText || '點這裡'}\n${url}`;
        const ok = await pushMessage(userId, textMessage(text));
        if (ok) sent++;
      }

      return NextResponse.json({ sent, total: userIds.length });
    }

    // 沒有連結 → 用 multicast 批次發送（省 API call）
    // LINE multicast 一次最多 500 人
    let sent = 0;
    for (let i = 0; i < userIds.length; i += 500) {
      const batch = userIds.slice(i, i + 500);
      const ok = await multicastMessage(batch, textMessage(finalMessage));
      if (ok) sent += batch.length;
    }

    return NextResponse.json({ sent, total: userIds.length });
  } catch (error) {
    console.error('[Push] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
