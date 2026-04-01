// LINE Messaging API 工具函式

const LINE_API = 'https://api.line.me/v2/bot';

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
  };
}

// 回覆訊息（用於 webhook 回覆）
export async function replyMessage(replyToken, messages) {
  const body = {
    replyToken,
    messages: Array.isArray(messages) ? messages : [messages],
  };
  const res = await fetch(`${LINE_API}/message/reply`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error('[LINE] reply failed:', await res.text());
  }
}

// 推播訊息給單一用戶
export async function pushMessage(userId, messages) {
  const body = {
    to: userId,
    messages: Array.isArray(messages) ? messages : [messages],
  };
  const res = await fetch(`${LINE_API}/message/push`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error('[LINE] push failed:', await res.text());
  }
  return res.ok;
}

// 推播訊息給多人（最多 500 人）
export async function multicastMessage(userIds, messages) {
  const body = {
    to: userIds,
    messages: Array.isArray(messages) ? messages : [messages],
  };
  const res = await fetch(`${LINE_API}/message/multicast`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error('[LINE] multicast failed:', await res.text());
  }
  return res.ok;
}

// 取得用戶 profile
export async function getProfile(userId) {
  const res = await fetch(`${LINE_API}/profile/${userId}`, {
    headers: headers(),
  });
  if (!res.ok) return null;
  return res.json();
}

// 建立文字訊息
export function textMessage(text) {
  return { type: 'text', text };
}

// 建立 Flex Message（低階，直接傳 contents）
export function flexMessage(altText, contents) {
  return { type: 'flex', altText, contents };
}

// 推播用 Flex Message（支援 1-2 個按鈕 + hero image）
// buttons = [{ label, url }, ...]，url 請先用 wrapLink 包好
// imageUrl = HTTPS 公開圖片網址（選填），顯示在訊息頂部
export function pushFlexMessage({ title, body, buttons, imageUrl }) {
  const bubble = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: title, weight: 'bold', size: 'lg', wrap: true },
        ...(body
          ? [{ type: 'text', text: body, size: 'sm', color: '#666666', wrap: true, margin: 'md' }]
          : []),
      ],
    },
  };

  // footer（有按鈕才加，沒按鈕不加空 footer）
  if (buttons && buttons.length > 0) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: buttons.map((btn, i) => ({
        type: 'button',
        action: { type: 'uri', label: btn.label, uri: btn.url },
        style: i === 0 ? 'primary' : 'secondary',
        ...(i === 0 ? { color: '#2a9d6f' } : {}),
      })),
    };
  }

  // hero image（選填）
  if (imageUrl) {
    bubble.hero = {
      type: 'image',
      url: imageUrl,
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
    };
  }

  return {
    type: 'flex',
    altText: title,
    contents: bubble,
  };
}

// 驗證 LINE signature
export async function verifySignature(body, signature) {
  const crypto = await import('crypto');
  const hash = crypto
    .createHmac('sha256', process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return hash === signature;
}
