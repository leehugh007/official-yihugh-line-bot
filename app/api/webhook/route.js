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
    typeUrl: 'https://abcmetabolic.com/types/high-rpm?utm_source=line&utm_medium=bot&utm_campaign=report',
  },
  rollerCoaster: {
    name: '雲霄飛車型', tagline: '早上精神好到想跑步，下午累到想辭職',
    description: '你的血糖像坐雲霄飛車，忽高忽低。這讓你的精神狀態、食慾、專注力都跟著大起大落。',
    keyPoint: '穩定血糖 = 穩定情緒 = 穩定體重。三件事其實是同一件事。',
    suggestions: ['吃飯順序改成：菜 → 肉 → 飯', '把精緻澱粉換成原型澱粉（白飯 → 糙米、地瓜）', '下午想吃甜食時，先吃一把堅果或一顆水煮蛋'],
    symptomContext: '這些症狀跟血糖不穩直接相關——當血糖像雲霄飛車一樣大起大落，你的身體就會用這些方式求救。',
    typeUrl: 'https://abcmetabolic.com/types/roller-coaster?utm_source=line&utm_medium=bot&utm_campaign=report',
  },
  burnout: {
    name: '燃燒殆盡型', tagline: '不是你偷懶，是身體已經把油燒光了還在硬撐',
    description: '你的身體長期處於能量透支的狀態。可能節食過度、壓力太大、或長期睡眠不足。代謝已經開始自我保護。',
    keyPoint: '現在最重要的不是少吃，而是「吃對」讓身體重新信任你。',
    suggestions: ['先不要減少食量，確保每餐都有蛋白質', '好油不要怕：每天至少 1-2 湯匙的好油脂', '優先處理睡眠，睡不好其他都白費'],
    symptomContext: '這些都是身體長期能量透支的警訊——不是你不夠努力，是身體已經在用最後的力氣撐了。',
    typeUrl: 'https://abcmetabolic.com/types/burnout?utm_source=line&utm_medium=bot&utm_campaign=report',
  },
  powerSave: {
    name: '省電模式型', tagline: '吃很少還是瘦不下來？你的身體已經自己降速了',
    description: '你的身體進入了「省電模式」。長期低熱量攝取讓甲狀腺功能下調，基礎代謝率降低。',
    keyPoint: '要讓代謝回來，第一步是「敢吃」。聽起來矛盾，但這是科學。',
    suggestions: ['循序漸進增加食量（每週多加 100-200 大卡）', '蛋白質是重建代謝的關鍵，每餐都要有', '加入阻力訓練（深蹲、硬舉），肌肉量 = 代謝的引擎'],
    symptomContext: '這些都是代謝降速的典型反應——你的身體為了省能量，把很多「非必要功能」關掉了。',
    typeUrl: 'https://abcmetabolic.com/types/power-save?utm_source=line&utm_medium=bot&utm_campaign=report',
  },
  steady: {
    name: '穩定燃燒型', tagline: '朋友都問你怎麼吃不胖，但你知道自己其實可以更好',
    description: '你的代謝狀態相對健康，身體的基礎運作是穩定的。但「不差」不等於「最好」。',
    keyPoint: '你的起點比多數人好，接下來要做的是精進，不是從頭來過。',
    suggestions: ['嘗試拉長空腹時間（12-14 小時）', '增加蛋白質攝取到每公斤體重 1.2-1.6g', '規律運動 + 充足睡眠，把優勢鞏固住'],
    symptomContext: '雖然你的代謝整體穩定，但這些小信號代表還有優化空間——身體在告訴你哪裡可以更好。',
    typeUrl: 'https://abcmetabolic.com/types/steady?utm_source=line&utm_medium=bot&utm_campaign=report',
  },
};

// ============================================================
// 蛋白質策略回覆（根據 5 題答案組合）
// ============================================================
const GOAL_LABELS = { maintain: '維持健康', 'fat-loss': '減脂增肌', intense: '高強度訓練' };
const DIET_LABELS = { 'eating-out': '外食族', 'home-cook': '自煮族', mixed: '混合型' };
const FOOD_LABELS = { omnivore: '葷食', 'lacto-ovo': '蛋奶素', vegan: '全素' };
const MEAL_LABELS = { '2': '兩餐', '3': '三餐', frequent: '少量多餐' };

function buildProteinStrategy(session, displayName) {
  const { weight, goal, diet_type, meal_count, food_type, protein_min, protein_max } = session;
  const avgProtein = Math.round((protein_min + protein_max) / 2);

  // 每餐分配
  const meals = meal_count === '2' ? 2 : meal_count === '3' ? 3 : 4;
  const perMeal = Math.round(avgProtein / meals);

  // 食材推薦（根據 food_type）
  const foodRecs = getProteinFoodRecs(food_type, diet_type);

  // 組訊息 1：策略主體
  let msg1 =
    `🥚 ${displayName ? displayName + '，' : ''}你的蛋白質攻略來了\n\n` +
    `━━━━━━━━━━━━━━━\n\n` +
    `📊 你的數字\n` +
    `每天需要 ${protein_min}-${protein_max}g 蛋白質\n` +
    `分成${MEAL_LABELS[meal_count]}，每餐約 ${perMeal}g\n\n` +
    `目標：${GOAL_LABELS[goal] || goal}\n` +
    `飲食型態：${DIET_LABELS[diet_type] || diet_type}｜${FOOD_LABELS[food_type] || food_type}\n\n` +
    `━━━━━━━━━━━━━━━\n\n` +
    `🍽️ ${DIET_LABELS[diet_type] || ''}這樣湊到 ${perMeal}g／餐\n\n`;

  // 三餐範例
  const mealExamples = getMealExamples(food_type, diet_type, perMeal);
  msg1 += mealExamples;

  msg1 +=
    `\n━━━━━━━━━━━━━━━\n\n` +
    `⚡ 最多人卡住的 3 件事\n\n` +
    `1. 以為有吃，但沒算過\n` +
    `→ 一份便當的蛋白質通常只有 15-20g，離目標還差很遠\n\n` +
    `2. 早餐幾乎沒蛋白質\n` +
    `→ 吐司配奶茶 ≈ 5g，一天的缺口從早上就開始了\n\n` +
    `3. 只吃雞胸肉，吃到怕\n` +
    `→ 蛋白質來源要多樣：蛋、豆腐、魚、毛豆都算\n\n` +
    `━━━━━━━━━━━━━━━\n\n` +
    `有任何問題都可以直接問我 🙂\n` +
    `我是一休，陪你健康的瘦一輩子`;

  // 訊息 2：互動引導
  const msg2 =
    `對了，想問你一下——\n\n` +
    `你現在是想瘦幾公斤？還是想維持現在的體重？\n\n` +
    `回覆告訴我，我可以給你更具體的建議 😊`;

  return [textMessage(msg1), textMessage(msg2)];
}

// 根據葷素 + 飲食型態推薦蛋白質食材
function getProteinFoodRecs(foodType, dietType) {
  if (foodType === 'vegan') {
    return {
      high: ['毛豆（100g = 11g）', '板豆腐（一塊 = 14g）', '天貝（100g = 19g）'],
      mid: ['豆漿無糖（240ml = 7g）', '鷹嘴豆（100g = 9g）', '黑豆（100g = 9g）'],
      snack: ['堅果一把（6g）', '豆干（2片 = 10g）', '素肉排（依品牌 10-15g）'],
    };
  }
  if (foodType === 'lacto-ovo') {
    return {
      high: ['雞蛋（2顆 = 14g）', '板豆腐（一塊 = 14g）', '希臘優格（200g = 14g）'],
      mid: ['起司片（2片 = 10g）', '豆漿無糖（240ml = 7g）', '毛豆（100g = 11g）'],
      snack: ['茶葉蛋（1顆 = 7g）', '堅果一把（6g）', '鮮奶（240ml = 8g）'],
    };
  }
  // omnivore
  return {
    high: ['雞胸肉（100g = 23g）', '鮭魚（100g = 20g）', '豬里肌（100g = 22g）'],
    mid: ['雞蛋（2顆 = 14g）', '板豆腐（一塊 = 14g）', '鯛魚（100g = 18g）'],
    snack: ['茶葉蛋（1顆 = 7g）', '即食雞胸（1包 = 20g）', '毛豆（100g = 11g）'],
  };
}

// 三餐搭配範例
function getMealExamples(foodType, dietType, perMeal) {
  const isEatingOut = dietType === 'eating-out';
  const isMixed = dietType === 'mixed';

  if (foodType === 'vegan') {
    if (isEatingOut || isMixed) {
      return (
        `☀️ 早餐（超商）\n` +
        `・無糖豆漿 + 堅果飯糰 ≈ ${Math.min(perMeal, 13)}g\n\n` +
        `🌤️ 午餐（自助餐/便當）\n` +
        `・滷豆腐 + 毛豆 + 五穀飯 ≈ ${Math.min(perMeal, 22)}g\n\n` +
        `🌙 晚餐\n` +
        `・豆干炒蔬菜 + 味噌湯（加豆腐）≈ ${Math.min(perMeal, 18)}g\n`
      );
    }
    return (
      `☀️ 早餐\n` +
      `・豆漿燕麥碗 + 堅果 ≈ ${Math.min(perMeal, 15)}g\n\n` +
      `🌤️ 午餐\n` +
      `・天貝炒蔬菜 + 糙米飯 ≈ ${Math.min(perMeal, 22)}g\n\n` +
      `🌙 晚餐\n` +
      `・板豆腐蔬菜鍋 + 毛豆 ≈ ${Math.min(perMeal, 20)}g\n`
    );
  }

  if (foodType === 'lacto-ovo') {
    if (isEatingOut || isMixed) {
      return (
        `☀️ 早餐（超商）\n` +
        `・茶葉蛋 2 顆 + 無糖豆漿 ≈ ${Math.min(perMeal, 21)}g\n\n` +
        `🌤️ 午餐（自助餐）\n` +
        `・蛋料理 + 豆腐 + 蔬菜 ≈ ${Math.min(perMeal, 22)}g\n\n` +
        `🌙 晚餐\n` +
        `・希臘優格 + 堅果 + 起司蛋吐司 ≈ ${Math.min(perMeal, 24)}g\n`
      );
    }
    return (
      `☀️ 早餐\n` +
      `・水煮蛋 2 顆 + 鮮奶 ≈ ${Math.min(perMeal, 22)}g\n\n` +
      `🌤️ 午餐\n` +
      `・豆腐蔬菜蛋炒飯 ≈ ${Math.min(perMeal, 24)}g\n\n` +
      `🌙 晚餐\n` +
      `・起司蛋捲 + 毛豆 + 味噌豆腐湯 ≈ ${Math.min(perMeal, 22)}g\n`
    );
  }

  // omnivore
  if (isEatingOut || isMixed) {
    return (
      `☀️ 早餐（超商）\n` +
      `・茶葉蛋 2 顆 + 無糖豆漿 ≈ ${Math.min(perMeal, 21)}g\n\n` +
      `🌤️ 午餐（自助餐/便當）\n` +
      `・一份主菜（雞腿/魚）+ 豆腐 ≈ ${Math.min(perMeal, 30)}g\n\n` +
      `🌙 晚餐\n` +
      `・鮭魚/里肌 + 蛋 + 蔬菜 ≈ ${Math.min(perMeal, 30)}g\n`
    );
  }
  return (
    `☀️ 早餐\n` +
    `・水煮蛋 2 顆 + 鮮奶 ≈ ${Math.min(perMeal, 22)}g\n\n` +
    `🌤️ 午餐\n` +
    `・雞胸肉/魚 + 豆腐 + 糙米飯 ≈ ${Math.min(perMeal, 35)}g\n\n` +
    `🌙 晚餐\n` +
    `・豬里肌 + 毛豆 + 蔬菜 ≈ ${Math.min(perMeal, 30)}g\n`
  );
}

function buildPersonalizedReport(session, displayName) {
  const type = TYPE_DATA[session.metabolism_type];
  if (!type) return [textMessage('找不到你的代謝報告，請重新做一次測驗：\nhttps://abcmetabolic.com/quiz?utm_source=line&utm_medium=bot&utm_campaign=official')];

  // 訊息 1：個人化報告
  let msg1 =
    `📋 ${displayName ? displayName + '，這是' : '這是'}你的代謝報告\n\n` +
    `你是「${type.name}」代謝\n` +
    `「${type.tagline}」\n\n` +
    `${type.description}\n\n` +
    `💡 ${type.keyPoint}\n\n` +
    `── 給你的 3 個具體建議 ──\n\n` +
    type.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n');

  // Q7 症狀回饋（個人化的核心）
  const symptoms = session.q7_symptoms || [];
  if (symptoms.length > 0) {
    msg1 += `\n\n───────────────\n\n`;
    msg1 += `📊 你的身體正在告訴你：\n\n`;
    msg1 += `你提到了這些狀況：\n`;
    msg1 += symptoms.map((s) => `• ${s}`).join('\n');
    msg1 += `\n\n${type.symptomContext}`;
  }

  // 體重趨勢
  if (session.body_signal === 'fluctuating') {
    msg1 += symptoms.length > 0 ? '\n\n' : '\n\n───────────────\n\n';
    msg1 += `📉 你的體重波動模式也反映了代謝不穩定——這不是意志力的問題，是身體在告訴你現在的方法需要調整。`;
  }

  msg1 += `\n\n有任何問題都可以直接問我 🙂\n我是一休，陪你健康的瘦一輩子`;

  // 訊息 2：類型詳細頁連結
  const msg2 =
    `想更了解「${type.name}」代謝的完整解析 👇\n` +
    type.typeUrl;

  return [textMessage(msg1), textMessage(msg2)];
}
