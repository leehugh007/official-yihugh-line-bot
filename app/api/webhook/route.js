// LINE Webhook 主入口
// 處理：follow（加好友）、unfollow（封鎖）、message（文字訊息）

import { NextResponse } from 'next/server';
import {
  verifySignature,
  replyMessage,
  pushMessage,
  getProfile,
  textMessage,
} from '../../../lib/line.js';
import { matchKeyword } from '../../../lib/keywords.js';
import { getUser, upsertUser, recordInteraction, markBlocked } from '../../../lib/users.js';
import { getWelcomeMessages } from '../../../lib/config.js';
import supabase from '../../../lib/supabase.js';

export async function POST(request) {
  try {
    const body = await request.text();
    const signature = request.headers.get('x-line-signature');

    // 驗證 LINE signature
    if (!await verifySignature(body, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const { events } = JSON.parse(body);

    for (const event of events) {
      await handleEvent(event);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Webhook] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// Webhook 驗證用（LINE 設定 webhook URL 時會 GET）
export async function GET() {
  return NextResponse.json({ status: 'ok' });
}

// 測試模式：只回應白名單裡的人，其他人靜默
// 準備正式上線時，把 TEST_MODE 改成 false 就好
const TEST_MODE = true;
const TEST_ALLOWLIST = [
  'U51808e2cc195967eba53701518e6f547', // 一休
  'U3edf3d2114ee03ad81cff1fd35c04600', // 婉馨
];

async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  // 代碼領取報告：即使測試模式也開放（做完測驗的用戶需要拿報告）
  if (event.type === 'message' && event.message?.type === 'text') {
    const text = event.message.text.trim();
    if (/^[A-Z2-9]{4}$/.test(text)) {
      const claimed = await handleCodeClaim(event, userId, text);
      if (claimed) return; // 代碼有效，已回覆
    }
  }

  // 測試模式：白名單外的人靜默（代碼領取除外，上面已處理）
  if (TEST_MODE && !TEST_ALLOWLIST.includes(userId)) return;

  switch (event.type) {
    case 'follow':
      await handleFollow(event, userId);
      break;
    case 'unfollow':
      await markBlocked(userId);
      break;
    case 'message':
      if (event.message?.type === 'text') {
        await handleTextMessage(event, userId);
      }
      // 非文字訊息（圖片、貼圖等）→ 不回覆
      break;
  }
}

// ============================================================
// Follow 事件（加好友）
// ============================================================
async function handleFollow(event, userId) {
  // 取得用戶 profile
  const profile = await getProfile(userId);
  const displayName = profile?.displayName || '';

  // 解析來源參數（測驗結果頁會帶 ?type=highRPM）
  // LINE 的 follow event 如果是透過連結加入，會在 event 裡帶 follow.isUnblocked
  // 但代謝類型需要透過 accountLink 或 rich menu postback 帶入
  // 這裡先用最簡單的方式：follow 後第一則訊息如果包含類型關鍵字就記錄

  // 檢查是否有 liff 或 URL 帶來的參數
  // LINE Official Account 的加好友連結可以帶 ?ref= 參數
  // 例如：https://lin.ee/xxxxx?ref=quiz_highRPM
  const ref = event.follow?.ref || '';
  let metabolismType = null;
  let source = 'direct';
  let quizSession = null;

  if (ref.startsWith('qs_')) {
    // 從測驗帶 session ID 過來 → 查個人化資料
    const { data } = await supabase
      .from('quiz_sessions')
      .select('metabolism_type, secondary_type, q7_symptoms, body_signal')
      .eq('id', ref)
      .single();
    if (data) {
      quizSession = data;
      metabolismType = data.metabolism_type;
      source = 'quiz';
    }
  } else if (ref.startsWith('quiz_')) {
    // fallback：舊格式只帶 type
    metabolismType = ref.replace('quiz_', '');
    source = 'quiz';
  }

  // 計算排程開始時間：加入後 1 天，台灣時間 08:00
  const dripNextAt = new Date();
  dripNextAt.setDate(dripNextAt.getDate() + 1);
  dripNextAt.setUTCHours(0, 0, 0, 0); // UTC 00:00 = 台灣 08:00

  // 儲存用戶
  await upsertUser(userId, {
    displayName,
    metabolismType,
    source,
    drip_next_at: dripNextAt.toISOString(),
  });

  // 發歡迎訊息
  const welcomeMessages = getWelcomeMessages(metabolismType, displayName);
  await replyMessage(event.replyToken, welcomeMessages);

  // 推播個人化代謝報告
  if (quizSession) {
    // 有完整 session → 個人化報告（含症狀回饋）
    const report = buildPersonalizedReport(quizSession, displayName);
    await pushMessage(userId, report);
  } else if (metabolismType) {
    // 只有 type → 通用報告
    const rule = matchKeyword('報告');
    if (rule) {
      const reportMessages = await rule.handler(userId);
      await pushMessage(userId, reportMessages);
    }
  }
}

// ============================================================
// 代碼領取報告（測試模式也開放）
// ============================================================
async function handleCodeClaim(event, userId, code) {
  // 1. 先查測驗代碼
  const { data: quizSession } = await supabase
    .from('quiz_sessions')
    .select('metabolism_type, secondary_type, q7_symptoms, body_signal')
    .eq('claim_code', code)
    .single();

  if (quizSession) {
    // 測驗代碼 → 走原有的代謝報告流程
    return await handleQuizCodeClaim(event, userId, quizSession);
  }

  // 2. 再查蛋白質代碼
  const { data: proteinSession } = await supabase
    .from('protein_sessions')
    .select('*')
    .eq('claim_code', code)
    .single();

  if (proteinSession) {
    // 蛋白質代碼 → 走蛋白質策略流程
    return await handleProteinCodeClaim(event, userId, proteinSession);
  }

  return false; // 兩張表都查不到
}

// 測驗代碼領取（原有邏輯）
async function handleQuizCodeClaim(event, userId, session) {
  const existingUser = await getUser(userId);
  if (!existingUser) {
    const profile = await getProfile(userId);
    await upsertUser(userId, {
      displayName: profile?.displayName || '',
      source: 'quiz',
    });
  }

  const dripNextAt = new Date();
  dripNextAt.setDate(dripNextAt.getDate() + 1);
  dripNextAt.setUTCHours(0, 0, 0, 0);

  await supabase
    .from('official_line_users')
    .update({
      metabolism_type: session.metabolism_type,
      source: 'quiz',
      drip_next_at: existingUser?.drip_next_at || dripNextAt.toISOString(),
    })
    .eq('line_user_id', userId);

  await recordInteraction(userId);

  const profile = await getProfile(userId);
  const report = buildPersonalizedReport(session, profile?.displayName || '');
  await replyMessage(event.replyToken, report);
  return true;
}

// 蛋白質代碼領取
async function handleProteinCodeClaim(event, userId, session) {
  const existingUser = await getUser(userId);
  if (!existingUser) {
    const profile = await getProfile(userId);
    await upsertUser(userId, {
      displayName: profile?.displayName || '',
      source: 'protein',
    });
  }

  const dripNextAt = new Date();
  dripNextAt.setDate(dripNextAt.getDate() + 1);
  dripNextAt.setUTCHours(0, 0, 0, 0);

  // 更新用戶來源 + 啟動 Drip
  await supabase
    .from('official_line_users')
    .update({
      source: existingUser?.source === 'quiz' ? 'quiz' : 'protein', // quiz 優先
      drip_next_at: existingUser?.drip_next_at || dripNextAt.toISOString(),
    })
    .eq('line_user_id', userId);

  // 標記已領取
  await supabase
    .from('protein_sessions')
    .update({ claimed_by: userId, claimed_at: new Date().toISOString() })
    .eq('id', session.id);

  await recordInteraction(userId);

  const profile = await getProfile(userId);
  const strategy = buildProteinStrategy(session, profile?.displayName || '');
  await replyMessage(event.replyToken, strategy);
  return true;
}

// ============================================================
// 文字訊息處理
// ============================================================
async function handleTextMessage(event, userId) {
  const text = event.message.text;

  // 檢查用戶是否已在資料庫（處理 Bot 上線前的舊用戶）
  const existingUser = await getUser(userId);
  if (!existingUser) {
    // 舊用戶第一次傳訊息，自動建檔
    const profile = await getProfile(userId);
    await upsertUser(userId, {
      displayName: profile?.displayName || '',
      source: 'legacy',
    });
  }

  // 記錄互動（不管有沒有匹配關鍵字）
  await recordInteraction(userId);

  // 代碼領取已在 handleEvent 層處理，這裡直接走關鍵字比對

  // 關鍵字比對
  const rule = matchKeyword(text);

  if (rule) {
    // 匹配到 → 自動回覆
    const messages = await rule.handler(userId);
    await replyMessage(event.replyToken, messages);
  }
  // 沒匹配 → 不回覆（一休手動處理）
}

// ============================================================
// 個人化代謝報告（含 Q7 症狀回饋）
// ============================================================
const TYPE_DATA = {
  highRPM: {
    name: '高轉速型', tagline: '你太努力，身體在抗議了',
    description: '你的代謝像一台引擎一直催到紅線的跑車。看起來精力充沛，其實身體一直在高壓運轉，皮質醇偏高，容易累積腹部脂肪。',
    keyPoint: '你需要的不是更努力，而是讓身體學會「切換檔位」。',
    suggestions: ['每餐確保有足夠的好油（酪梨、堅果、橄欖油）', '睡前 1 小時放下手機，讓副交感神經啟動', '嘗試把高強度運動改成 2-3 次/週，其他天走路就好'],
    symptomContext: '這些都是皮質醇長期偏高的典型表現——你的身體在用這些信號告訴你：「我需要休息，不是更努力。」',
    ahaReason: '你一直逼自己更努力——少吃、多動、早起運動。但你的身體不是不配合，是已經在超載了。皮質醇長期偏高，身體會優先把脂肪堆在肚子周圍。越努力，肚子反而越難消。',
    oneStep: '這禮拜開始，把其中一天的高強度運動改成散步 30 分鐘。不是偷懶，是讓身體從紅線區退下來。',
    typeUrl: 'https://abcmetabolic.com/types/high-rpm?utm_source=line&utm_medium=bot&utm_campaign=report',
  },
  rollerCoaster: {
    name: '雲霄飛車型', tagline: '早上精神好到想跑步，下午累到想辭職',
    description: '你的血糖像坐雲霄飛車，忽高忽低。這讓你的精神狀態、食慾、專注力都跟著大起大落。',
    keyPoint: '穩定血糖 = 穩定情緒 = 穩定體重。三件事其實是同一件事。',
    suggestions: ['吃飯順序改成：菜 → 肉 → 飯', '把精緻澱粉換成原型澱粉（白飯 → 糙米、地瓜）', '下午想吃甜食時，先吃一把堅果或一顆水煮蛋'],
    symptomContext: '這些症狀跟血糖不穩直接相關——當血糖像雲霄飛車一樣大起大落，你的身體就會用這些方式求救。',
    ahaReason: '你可能試過少吃、節食、或跳過某一餐。但問題不在吃多吃少，是你吃的東西讓血糖忽高忽低。血糖一掉，你的大腦就會瘋狂叫你吃甜的。這不是意志力差，是血糖在控制你。',
    oneStep: '下一餐開始，吃飯順序改成：菜先吃 → 再吃肉 → 最後吃飯。同樣的食物，換個順序，血糖波動就能減少三成。',
    typeUrl: 'https://abcmetabolic.com/types/roller-coaster?utm_source=line&utm_medium=bot&utm_campaign=report',
  },
  burnout: {
    name: '燃燒殆盡型', tagline: '不是你偷懶，是身體已經把油燒光了還在硬撐',
    description: '你的身體長期處於能量透支的狀態。可能節食過度、壓力太大、或長期睡眠不足。代謝已經開始自我保護。',
    keyPoint: '現在最重要的不是少吃，而是「吃對」讓身體重新信任你。',
    suggestions: ['先不要減少食量，確保每餐都有蛋白質', '好油不要怕：每天至少 1-2 湯匙的好油脂', '優先處理睡眠，睡不好其他都白費'],
    symptomContext: '這些都是身體長期能量透支的警訊——不是你不夠努力，是身體已經在用最後的力氣撐了。',
    ahaReason: '你已經很努力了——吃得少、忍得住、該做的都做了。但身體被透支太久，它啟動了自我保護機制：降低代謝、囤積脂肪、讓你覺得累。你越少吃，它越省，形成惡性循環。',
    oneStep: '明天開始，每餐確保有一份蛋白質（一顆蛋、一塊豆腐、一片肉都行）。先不要減量，讓身體知道「食物會穩定供應」。',
    typeUrl: 'https://abcmetabolic.com/types/burnout?utm_source=line&utm_medium=bot&utm_campaign=report',
  },
  powerSave: {
    name: '省電模式型', tagline: '吃很少還是瘦不下來？你的身體已經自己降速了',
    description: '你的身體進入了「省電模式」。長期低熱量攝取讓甲狀腺功能下調，基礎代謝率降低。',
    keyPoint: '要讓代謝回來，第一步是「敢吃」。聽起來矛盾，但這是科學。',
    suggestions: ['循序漸進增加食量（每週多加 100-200 大卡）', '蛋白質是重建代謝的關鍵，每餐都要有', '加入阻力訓練（深蹲、硬舉），肌肉量 = 代謝的引擎'],
    symptomContext: '這些都是代謝降速的典型反應——你的身體為了省能量，把很多「非必要功能」關掉了。',
    ahaReason: '你吃得很少，但身體不會因為你少吃就乖乖瘦。它的邏輯是：「進來的不夠，那我就省著用。」代謝降速、體溫下降、容易掉髮——這些都是身體在告訴你它已經進入省電模式了。',
    oneStep: '這禮拜開始，每天多吃一份點心（一杯豆漿、一把堅果、或一顆蛋）。不用一次加很多，每週多一點，讓代謝慢慢回來。',
    typeUrl: 'https://abcmetabolic.com/types/power-save?utm_source=line&utm_medium=bot&utm_campaign=report',
  },
  steady: {
    name: '穩定燃燒型', tagline: '朋友都問你怎麼吃不胖，但你知道自己其實可以更好',
    description: '你的代謝狀態相對健康，身體的基礎運作是穩定的。但「不差」不等於「最好」。',
    keyPoint: '你的起點比多數人好，接下來要做的是精進，不是從頭來過。',
    suggestions: ['嘗試拉長空腹時間（12-14 小時）', '增加蛋白質攝取到每公斤體重 1.2-1.6g', '規律運動 + 充足睡眠，把優勢鞏固住'],
    symptomContext: '雖然你的代謝整體穩定，但這些小信號代表還有優化空間——身體在告訴你哪裡可以更好。',
    ahaReason: '你的身體底子不差，但「不差」容易讓人停在原地。很多人覺得自己還好就不調整，結果隨著年齡增長，代謝慢慢往下掉。現在是鞏固優勢最好的時機。',
    oneStep: '從這禮拜開始，注意每餐的蛋白質份量——目標是每公斤體重吃到 1.2g。大多數人以為自己吃夠了，其實差很多。',
    typeUrl: 'https://abcmetabolic.com/types/steady?utm_source=line&utm_medium=bot&utm_campaign=report',
  },
};

// ============================================================
// 蛋白質策略回覆 — 診斷→aha moment→一步就好→搭配→互動
// ============================================================

function buildProteinStrategy(session, displayName) {
  const { food_type, protein_min, protein_max } = session;
  const avgProtein = Math.round((protein_min + protein_max) / 2);
  const name = displayName ? displayName + '，' : '';

  // 判斷新版（每餐選擇）還是舊版（大分類）
  const hasPerMeal = session.breakfast_type || session.lunch_type || session.dinner_type;

  if (!hasPerMeal) {
    // 舊版 fallback（相容舊記錄）
    return buildProteinStrategyLegacy(session, displayName);
  }

  // ─── 新版：根據她自己選的每餐估算 ───
  const meals = [];
  if (session.breakfast_type && session.breakfast_type !== 'skip') {
    meals.push({ time: 'breakfast', type: session.breakfast_type });
  }
  if (session.lunch_type && session.lunch_type !== 'skip') {
    meals.push({ time: 'lunch', type: session.lunch_type });
  }
  if (session.dinner_type && session.dinner_type !== 'skip') {
    meals.push({ time: 'dinner', type: session.dinner_type });
  }

  // 計算目前攝取
  let currentTotal = 0;
  const diagnosisLines = [];
  const mealResults = []; // 用於找 quick win

  for (const meal of meals) {
    const data = MEAL_DB[meal.time]?.[meal.type];
    if (!data) continue;
    const p = data.protein[food_type] || data.protein.omnivore;
    const f = data.food[food_type] || data.food.omnivore;
    const imp = data.improved[food_type] || data.improved.omnivore;
    currentTotal += p;
    diagnosisLines.push(`${data.emoji} ${data.timeLabel}：${f} → 約 ${p}g`);
    mealResults.push({ ...meal, current: p, currentFood: f, improved: imp, data });
  }

  // 加上跳過的餐
  if (session.breakfast_type === 'skip') diagnosisLines.unshift('☀️ 早餐：不吃 → 0g');
  if (session.lunch_type === 'skip') diagnosisLines.splice(session.breakfast_type === 'skip' ? 1 : 0, 0, '🌤️ 午餐：不吃 → 0g');
  if (session.dinner_type === 'skip') diagnosisLines.push('🌙 晚餐：不吃 → 0g');

  const percentage = currentTotal > 0 ? Math.round((currentTotal / avgProtein) * 100) : 0;

  // ─── 訊息 1：診斷 + aha moment + quick win ───
  let msg1 =
    `🥚 ${name}你的蛋白質攻略來了\n\n` +
    `你的目標：每天 ${protein_min}-${protein_max}g\n\n` +
    `━━━━━━━━━━━━━━━\n\n` +
    `根據你的回答，你現在每天大概吃到：\n\n` +
    diagnosisLines.join('\n') + '\n' +
    `→ 合計約 ${currentTotal}g\n\n` +
    `你的目標是 ${avgProtein}g。\n` +
    `也就是說，你現在只吃到目標的 ${percentage}%。\n\n` +
    `━━━━━━━━━━━━━━━\n\n` +
    `這就是為什麼你可能：\n\n` +
    `・下午特別想吃甜食\n` +
    `　→ 蛋白質不夠，血糖不穩，身體在跟你要糖\n\n` +
    `・明明吃不多但不瘦\n` +
    `　→ 肌肉在流失，代謝被降速了\n\n` +
    `・常覺得沒精神、容易累\n` +
    `　→ 蛋白質是穩定能量的關鍵，缺了就像車沒油\n\n` +
    `━━━━━━━━━━━━━━━\n\n`;

  // Quick Win：找改善空間最大的那餐
  let bestWin = null;
  for (const m of mealResults) {
    const gain = m.improved.protein - m.current;
    if (!bestWin || gain > bestWin.gain) {
      bestWin = { ...m, gain };
    }
  }

  if (bestWin && bestWin.gain > 0 && currentTotal > 0) {
    msg1 +=
      `💡 不用大改，先改一步就好\n\n` +
      `${bestWin.data.timeLabel}從「${bestWin.currentFood}」\n` +
      `→ 改成「${bestWin.improved.food}」\n\n` +
      `蛋白質從 ${bestWin.current}g → ${bestWin.improved.protein}g（+${bestWin.gain}g）\n` +
      `光這一餐，一天就從 ${currentTotal}g → ${currentTotal + bestWin.gain}g\n\n` +
      `這一步做穩了，再來調整其他餐。\n\n`;
  }

  msg1 +=
    `有任何問題都可以直接問我 🙂\n` +
    `我是一休，陪你健康的瘦一輩子`;

  // ─── 訊息 2：全部改良後的一天 ───
  let improvedTotal = 0;
  const improvedLines = [];

  for (const m of mealResults) {
    improvedTotal += m.improved.protein;
    improvedLines.push(
      `${m.data.emoji} ${m.data.timeLabel}\n` +
      `・${m.improved.food}\n` +
      `　→ ${m.improved.protein}g`
    );
  }

  const gap = avgProtein - improvedTotal;

  let msg2 =
    `📋 等你準備好了，一整天可以這樣吃：\n\n` +
    improvedLines.join('\n\n') + '\n';

  if (gap > 5) {
    msg2 += `\n合計約 ${improvedTotal}g，還差 ${gap}g\n`;
    msg2 += `→ 加一份點心補上：${getSnackSuggestion(food_type, gap)}\n`;
  } else {
    msg2 += `\n合計約 ${improvedTotal}g ✅ 達標！\n`;
  }

  // ─── 訊息 3：互動引導 ───
  const msg3 =
    `對了，想問你一下——\n\n` +
    `你現在是想瘦幾公斤？還是想維持現在的體重？\n\n` +
    `回覆告訴我，我可以給你更具體的建議 😊`;

  return [textMessage(msg1), textMessage(msg2), textMessage(msg3)];
}

// 舊版 fallback（diet_type + meal_count 的記錄）
function buildProteinStrategyLegacy(session, displayName) {
  const { food_type, protein_min, protein_max } = session;
  const avgProtein = Math.round((protein_min + protein_max) / 2);
  const name = displayName ? displayName + '，' : '';

  const msg1 =
    `🥚 ${name}你的蛋白質攻略來了\n\n` +
    `你的目標：每天 ${protein_min}-${protein_max}g 蛋白質\n\n` +
    `最簡單的一步：每餐確保有一份手掌大的蛋白質。\n` +
    `早餐加 2 顆蛋，午餐挑有肉的主菜，晚餐加豆腐或魚。\n\n` +
    `有任何問題都可以直接問我 🙂\n` +
    `我是一休，陪你健康的瘦一輩子`;

  const msg2 =
    `對了，想問你一下——\n\n` +
    `你現在是想瘦幾公斤？還是想維持現在的體重？\n\n` +
    `回覆告訴我，我可以給你更具體的建議 😊`;

  return [textMessage(msg1), textMessage(msg2)];
}

// ============================================================
// MEAL_DB — 每個選項的蛋白質估算 + 改良版
// 數據來源：7-11 營養標示實測（便當 17-30g）+ 台灣常見食物營養資料
// ============================================================
const MEAL_DB = {
  breakfast: {
    convenience: {
      emoji: '☀️', timeLabel: '早餐',
      protein: { omnivore: 10, 'lacto-ovo': 8, vegan: 7 },
      food: { omnivore: '超商飯糰或三明治', 'lacto-ovo': '超商蛋三明治', vegan: '超商飯糰 + 豆漿' },
      improved: {
        omnivore: { food: '超商茶葉蛋 2 顆 + 無糖豆漿', protein: 21 },
        'lacto-ovo': { food: '超商茶葉蛋 2 顆 + 無糖豆漿', protein: 21 },
        vegan: { food: '超商豆漿 2 杯 + 堅果', protein: 20 },
      },
    },
    'breakfast-shop': {
      emoji: '☀️', timeLabel: '早餐',
      protein: { omnivore: 12, 'lacto-ovo': 10, vegan: 5 },
      food: { omnivore: '早餐店蛋餅或漢堡', 'lacto-ovo': '早餐店蛋餅', vegan: '早餐店蘿蔔糕 + 紅茶' },
      improved: {
        omnivore: { food: '蛋餅加蛋 + 無糖豆漿（不要奶茶）', protein: 21 },
        'lacto-ovo': { food: '蛋餅加蛋 + 鮮奶', protein: 22 },
        vegan: { food: '蘿蔔糕 + 豆漿 2 杯', protein: 17 },
      },
    },
    'bread-coffee': {
      emoji: '☀️', timeLabel: '早餐',
      protein: { omnivore: 5, 'lacto-ovo': 5, vegan: 3 },
      food: { omnivore: '麵包 + 咖啡或奶茶', 'lacto-ovo': '麵包 + 拿鐵', vegan: '麵包 + 黑咖啡' },
      improved: {
        omnivore: { food: '蛋吐司 + 無糖豆漿（麵包→蛋吐司，奶茶→豆漿）', protein: 19 },
        'lacto-ovo': { food: '起司蛋吐司 + 鮮奶', protein: 22 },
        vegan: { food: '全麥吐司 + 豆漿 + 堅果', protein: 15 },
      },
    },
    home: {
      emoji: '☀️', timeLabel: '早餐',
      protein: { omnivore: 18, 'lacto-ovo': 18, vegan: 12 },
      food: { omnivore: '自己做（蛋/鮮奶/豆漿）', 'lacto-ovo': '自己做（蛋/鮮奶）', vegan: '自己做（豆漿/堅果）' },
      improved: {
        omnivore: { food: '水煮蛋 2 顆 + 無糖豆漿 + 一片起司或一把堅果', protein: 27 },
        'lacto-ovo': { food: '水煮蛋 2 顆 + 鮮奶 + 希臘優格（或起司片）', protein: 29 },
        vegan: { food: '無糖豆漿 2 杯 + 豆干 2 片 + 堅果一把', protein: 24 },
      },
    },
  },
  lunch: {
    bento: {
      emoji: '🌤️', timeLabel: '午餐',
      protein: { omnivore: 20, 'lacto-ovo': 14, vegan: 10 },
      food: { omnivore: '便當店便當', 'lacto-ovo': '素食便當', vegan: '素食便當（青菜為主）' },
      improved: {
        omnivore: { food: '便當選雞腿/排骨 + 加點滷蛋或豆腐', protein: 32 },
        'lacto-ovo': { food: '便當加滷蛋 + 選豆腐主菜', protein: 24 },
        vegan: { food: '便當選豆腐/豆干主菜 + 加毛豆', protein: 20 },
      },
    },
    buffet: {
      emoji: '🌤️', timeLabel: '午餐',
      protein: { omnivore: 22, 'lacto-ovo': 18, vegan: 15 },
      food: { omnivore: '自助餐（夾一份主菜）', 'lacto-ovo': '自助餐（蛋+豆腐）', vegan: '自助餐（豆類為主）' },
      improved: {
        omnivore: { food: '自助餐：雞腿 + 滷蛋 + 豆腐（三樣蛋白質）', protein: 42 },
        'lacto-ovo': { food: '自助餐：蛋料理 + 豆腐 + 毛豆（多夾蛋白質）', protein: 32 },
        vegan: { food: '自助餐：滷豆腐 + 毛豆 + 豆干（全選蛋白質）', protein: 28 },
      },
    },
    noodle: {
      emoji: '🌤️', timeLabel: '午餐',
      protein: { omnivore: 10, 'lacto-ovo': 8, vegan: 6 },
      food: { omnivore: '麵店/小吃（乾麵、湯麵）', 'lacto-ovo': '麵店（蔬菜麵）', vegan: '麵店（陽春麵）' },
      improved: {
        omnivore: { food: '麵 + 加滷蛋 + 點一份豆干或嘴邊肉小菜', protein: 24 },
        'lacto-ovo': { food: '麵 + 加蛋 + 點一份滷豆腐', protein: 22 },
        vegan: { food: '麵 + 點豆干小菜 + 味噌豆腐湯', protein: 18 },
      },
    },
    home: {
      emoji: '🌤️', timeLabel: '午餐',
      protein: { omnivore: 20, 'lacto-ovo': 18, vegan: 14 },
      food: { omnivore: '自己煮/帶便當', 'lacto-ovo': '自己煮/帶便當', vegan: '自己煮/帶便當' },
      improved: {
        omnivore: { food: '雞胸肉 150g + 板豆腐半塊 + 飯 + 青菜', protein: 42 },
        'lacto-ovo': { food: '板豆腐整塊 + 蛋 2 顆 + 毛豆 100g + 飯', protein: 39 },
        vegan: { food: '天貝 100g + 板豆腐半塊 + 毛豆 + 飯', protein: 30 },
      },
    },
  },
  dinner: {
    'bento-buffet': {
      emoji: '🌙', timeLabel: '晚餐',
      protein: { omnivore: 20, 'lacto-ovo': 16, vegan: 12 },
      food: { omnivore: '便當或自助餐', 'lacto-ovo': '便當或自助餐', vegan: '素食便當/自助餐' },
      improved: {
        omnivore: { food: '自助餐：主菜選肉 + 加滷蛋 + 豆腐', protein: 38 },
        'lacto-ovo': { food: '自助餐：蛋料理 + 豆腐 + 毛豆', protein: 30 },
        vegan: { food: '自助餐：豆腐 + 毛豆 + 豆干', protein: 25 },
      },
    },
    'noodle-hotpot': {
      emoji: '🌙', timeLabel: '晚餐',
      protein: { omnivore: 12, 'lacto-ovo': 10, vegan: 7 },
      food: { omnivore: '麵店/小吃/火鍋', 'lacto-ovo': '麵店或蔬菜鍋', vegan: '麵店或蔬菜鍋' },
      improved: {
        omnivore: { food: '火鍋多涮肉片 + 豆腐 + 蛋，或麵加滷蛋+小菜', protein: 30 },
        'lacto-ovo': { food: '火鍋加豆腐 + 蛋 + 起司，或麵加蛋+豆干', protein: 24 },
        vegan: { food: '火鍋加板豆腐 + 毛豆 + 豆皮', protein: 20 },
      },
    },
    home: {
      emoji: '🌙', timeLabel: '晚餐',
      protein: { omnivore: 18, 'lacto-ovo': 16, vegan: 12 },
      food: { omnivore: '自己煮（炒菜+一點肉）', 'lacto-ovo': '自己煮（蛋+豆腐為主）', vegan: '自己煮（青菜+豆腐）' },
      improved: {
        omnivore: { food: '豬里肌/鮭魚 120g + 毛豆 100g + 蔬菜', protein: 37 },
        'lacto-ovo': { food: '起司蛋捲（3蛋）+ 毛豆 + 豆腐味噌湯', protein: 35 },
        vegan: { food: '板豆腐蔬菜鍋 + 毛豆 + 豆干', protein: 28 },
      },
    },
  },
};

// 點心補差距建議
function getSnackSuggestion(foodType, gap) {
  if (foodType === 'vegan') {
    if (gap > 15) return '豆干 2 片(10g) + 豆漿一杯(7g) + 堅果(6g)';
    if (gap > 10) return '豆干 2 片(10g) + 豆漿一杯(7g)';
    return '豆漿一杯(7g) + 堅果一把(6g)';
  }
  if (foodType === 'lacto-ovo') {
    if (gap > 15) return '茶葉蛋 2 顆(14g) + 鮮奶(8g)';
    if (gap > 10) return '茶葉蛋 1 顆(7g) + 希臘優格(10g)';
    return '茶葉蛋 1 顆(7g) + 堅果(6g)';
  }
  if (gap > 15) return '即食雞胸 1 包(20g)';
  if (gap > 10) return '茶葉蛋 2 顆(14g)';
  return '茶葉蛋 1 顆(7g) + 豆漿(7g)';
}

function buildPersonalizedReport(session, displayName) {
  const type = TYPE_DATA[session.metabolism_type];
  if (!type) return [textMessage('找不到你的代謝報告，請重新做一次測驗：\nhttps://abcmetabolic.com/quiz?utm_source=line&utm_medium=bot&utm_campaign=official')];

  const name = displayName ? displayName + '，' : '';
  const symptoms = session.q7_symptoms || [];

  // ─── 訊息 1：診斷 + aha moment + 一步就好 ───

  let msg1 = '';

  // 開頭：用她自己的症狀做診斷
  if (symptoms.length > 0) {
    msg1 +=
      `${name}你的代謝報告出來了\n\n` +
      `你提到了：\n` +
      symptoms.map((s) => `・${s}`).join('\n') + '\n\n' +
      `這些不是個別問題，它們都指向同一件事——\n` +
      `${type.symptomContext}\n\n`;
  } else {
    msg1 +=
      `${name}你的代謝報告出來了\n\n` +
      `「${type.tagline}」\n\n` +
      `${type.description}\n\n`;
  }

  // 體重波動加強診斷
  if (session.body_signal === 'fluctuating') {
    msg1 += `你的體重波動模式也在反映同一件事——不是你不夠努力，是身體正在用它的方式告訴你：現在的方法需要調整。\n\n`;
  }

  // aha moment：為什麼之前的方法沒用
  msg1 +=
    `━━━━━━━━━━━━━━━\n\n` +
    `${type.ahaReason}\n\n`;

  // 核心認知
  msg1 +=
    `━━━━━━━━━━━━━━━\n\n` +
    `💡 ${type.keyPoint}\n\n`;

  // 一步就好
  msg1 +=
    `不用一次改很多，先做一件事就好：\n\n` +
    `👉 ${type.oneStep}\n\n` +
    `這一步做穩了，再來調整其他的。\n\n` +
    `有任何問題都可以直接問我 🙂\n` +
    `我是一休，陪你健康的瘦一輩子`;

  // ─── 訊息 2：完整建議 + 類型頁連結 ───
  const msg2 =
    `📋 等你準備好了，這 3 件事可以慢慢做：\n\n` +
    type.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n') +
    `\n\n想更了解「${type.name}」代謝的完整解析 👇\n` +
    type.typeUrl;

  // ─── 訊息 3：互動引導 ───
  const msg3 =
    `對了，想問你一下——\n\n` +
    `你現在是想瘦幾公斤？還是想維持現在的體重？\n\n` +
    `回覆告訴我，想瘦幾公斤就好 😊`;

  return [textMessage(msg1), textMessage(msg2), textMessage(msg3)];
}
