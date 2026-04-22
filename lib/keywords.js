// 關鍵字自動回覆系統
// 規則：匹配到 → 自動回覆；沒匹配 → 不回覆（一休手動處理）

import { getUser } from './users.js';
import supabase from './supabase.js';

// ============================================================
// DB 設定讀取（official_settings 表）
// ============================================================

async function getSetting(key) {
  const { data } = await supabase
    .from('official_settings')
    .select('value')
    .eq('key', key)
    .single();
  return data?.value || null;
}

// ============================================================
// 關鍵字定義（要加新關鍵字在這裡加就好）
// ============================================================

const KEYWORD_RULES = [
  {
    id: 'report',
    keywords: ['報告', '代謝報告', '我的類型', '我的代謝', '測驗結果'],
    handler: handleReport,
  },
  {
    id: 'trap',
    keywords: ['地雷', '我的地雷', '最大地雷'],
    handler: handleTrap,
  },
  {
    id: 'menu',
    keywords: ['菜單', '我的菜單', '怎麼吃'],
    handler: handleMenu,
  },
  // Phase 3.3: pricing 規則整組拿掉（2026-04-22）
  // 理由：/seminar 404 + /plans 是阿算的頁、不是 ABC 代謝重建減重班
  //      在有正式課程頁（/program 或新建）之前，不給任何自動回覆避免誤導
  //      handler/FALLBACK_PRICING_INFO 保留給未來重新啟用
  // {
  //   id: 'pricing',
  //   keywords: ['方案', '價格', '費用', '多少錢', '怎麼報名', '課程'],
  //   handler: handlePricing,
  // },
  {
    id: 'seminar',
    keywords: ['說明會', '直播', '講座'],
    handler: handleSeminar,
  },
  {
    id: 'articles',
    keywords: ['文章', '推薦', '想看'],
    handler: handleArticles,
  },
  {
    id: 'abc',
    // Phase 3.3: 拿掉動詞（怎麼瘦/瘦身/減肥）— 太廣容易誤攔對話路徑中的用戶
    // 保留品牌詞（ABC/abc/代謝）— 新用戶問這些詞就是在問你這個方法
    keywords: ['ABC', 'abc', '代謝'],
    handler: handleABC,
  },
];

// ============================================================
// 匹配邏輯
// ============================================================

export function matchKeyword(text) {
  const normalized = text.trim();
  for (const rule of KEYWORD_RULES) {
    for (const kw of rule.keywords) {
      if (normalized.includes(kw)) {
        return rule;
      }
    }
  }
  return null; // 沒匹配 → 不回覆
}

// ============================================================
// 各關鍵字的回覆內容
// ============================================================

async function handleReport(userId) {
  const user = await getUser(userId);
  if (user?.metabolism_type) {
    const report = getMetabolismReport(user.metabolism_type);
    return report;
  }
  return [
    {
      type: 'text',
      text: '你好像還沒做過代謝類型測驗 🙂\n\n花 2 分鐘測一下，我幫你生成專屬的代謝報告：\nhttps://abcmetabolic.com/quiz?utm_source=line&utm_medium=bot&utm_campaign=official',
    },
  ];
}

// ============================================================
// Fallback 常量（DB 沒設定時用這些）
// ============================================================

// Phase 3.3: 拿掉 /seminar 壞連結（404），改對話式引導
// 理由：每個人的狀況不一樣，硬丟一份方案給用戶看不一定適合；
//      跟 Phase 3.2c redesign 精神一致 — 個人化對話 > 制式介紹
//      後台可透過 official_settings.pricing_info 設 custom 覆蓋
const FALLBACK_PRICING_INFO =
  '方案這件事，每個人狀況不一樣，我直接丟一份給你看也不一定適合你。\n\n' +
  '最準的方式是先跟我聊你的狀況 —\n' +
  '目前體重、試過什麼方法、最卡在哪。\n\n' +
  '我看完再跟你說哪個方案配合你最剛好。';

const FALLBACK_ABC_INFO =
  'ABC 代謝重建瘦身法的核心概念：\n\n你的問題不是胖，是代謝失調。\n重建代謝力，瘦只是順便的事。\n\n✅ 不算熱量、不挨餓\n✅ 用加法思維：增加好的食物\n✅ 重建胰島素敏感度\n✅ 恢復身體的代謝彈性\n\n想知道自己的代謝狀態嗎？\n花 2 分鐘測一下 👇\nhttps://abcmetabolic.com/quiz?utm_source=line&utm_medium=bot&utm_campaign=official';

async function handlePricing() {
  const custom = await getSetting('pricing_info');
  if (custom) return [{ type: 'text', text: custom }];
  return [{ type: 'text', text: FALLBACK_PRICING_INFO }];
}

async function handleSeminar() {
  const custom = await getSetting('seminar_info');
  if (custom) return [{ type: 'text', text: custom }];
  // fallback: 從 config.js 讀取靜態設定
  const { SEMINAR_INFO } = await import('./config.js');
  return [{ type: 'text', text: SEMINAR_INFO }];
}

async function handleArticles(userId) {
  const user = await getUser(userId);
  const type = user?.metabolism_type || 'default';
  const articles = getArticlesForType(type);
  return [
    {
      type: 'text',
      text: articles,
    },
  ];
}

async function handleABC(userId) {
  const user = await getUser(userId);
  // Phase 3.3: 已做過測驗的人不該被再導去測驗（違反使用習慣）
  // 用 tagline 定位她 + 中段通用說明 + 引導回該類型的實際應用（不推測驗）
  if (user?.metabolism_type) {
    const report = METABOLISM_REPORTS[user.metabolism_type];
    const typeName = report?.name || user.metabolism_type;
    const tagline = report?.tagline || '';
    const headerLine = tagline
      ? `你是「${typeName}」—${tagline}。`
      : `你是「${typeName}」這個類型。`;
    return [
      {
        type: 'text',
        text:
          `${headerLine}\n\n` +
          `ABC 的核心：你的問題不是胖，是代謝失調。\n` +
          `重建代謝力，瘦只是順便的事。\n\n` +
          `✅ 不算熱量、不挨餓\n` +
          `✅ 加法思維：增加好的食物\n` +
          `✅ 重建胰島素敏感度、恢復代謝彈性\n\n` +
          `你這個類型最常卡在哪、怎麼解 👇\n` +
          `👉 回「地雷」看你要避開什麼\n` +
          `👉 回「菜單」看你該怎麼吃\n\n` +
          `或直接跟我說你目前體重、想瘦到多少，我看你這個類型要怎麼走。`,
      },
    ];
  }
  // 沒測過 → 原流程（推測驗，教育型觸點）
  const custom = await getSetting('abc_info');
  if (custom) return [{ type: 'text', text: custom }];
  return [{ type: 'text', text: FALLBACK_ABC_INFO }];
}

async function handleTrap(userId) {
  const user = await getUser(userId);
  if (!user?.metabolism_type) {
    return [
      {
        type: 'text',
        text: '想知道你的代謝地雷，要先知道你的代謝類型 🙂\n\n花 2 分鐘測一下，我幫你生成專屬報告：\nhttps://abcmetabolic.com/quiz?utm_source=line&utm_medium=bot&utm_campaign=official',
      },
    ];
  }
  const report = METABOLISM_REPORTS[user.metabolism_type];
  if (!report?.trap) {
    return [{ type: 'text', text: '找不到你的代謝類型對應的地雷內容，你可以直接跟我說你的情況，我幫你看。' }];
  }
  return [{ type: 'text', text: report.trap }];
}

async function handleMenu(userId) {
  const user = await getUser(userId);
  if (!user?.metabolism_type) {
    return [
      {
        type: 'text',
        text: '想知道你該怎麼吃，要先知道你的代謝類型 🙂\n\n花 2 分鐘測一下，我幫你生成專屬報告：\nhttps://abcmetabolic.com/quiz?utm_source=line&utm_medium=bot&utm_campaign=official',
      },
    ];
  }
  const report = METABOLISM_REPORTS[user.metabolism_type];
  if (!report?.menu) {
    return [{ type: 'text', text: '找不到你的代謝類型對應的菜單內容，你可以直接跟我說你的情況，我幫你看。' }];
  }
  return [{ type: 'text', text: report.menu }];
}

// ============================================================
// 代謝報告模板（5 種類型）
// ============================================================

const METABOLISM_REPORTS = {
  highRPM: {
    name: '高轉速型',
    tagline: '你太努力，身體在抗議了',
    description:
      '你的代謝像一台引擎一直催到紅線的跑車。看起來精力充沛，其實身體一直在高壓運轉，皮質醇偏高，容易累積腹部脂肪。',
    keyPoint: '你需要的不是更努力，而是讓身體學會「切換檔位」。',
    suggestions: [
      '每餐確保有足夠的好油（酪梨、堅果、橄欖油）',
      '睡前 1 小時放下手機，讓副交感神經啟動',
      '嘗試把高強度運動改成 2-3 次/週，其他天走路就好',
    ],
    articleUrl: 'https://abcmetabolic.com/articles/cortisol-fat?utm_source=line&utm_medium=bot&utm_campaign=official',
    articleTitle: '為什麼你越努力越胖？皮質醇的秘密',
    trapTeaser: '高轉速型肚子消不掉的真相',
    menuTeaser: '高轉速型怎麼吃讓肚子消下去',
    trap:
      '你是不是連放假都放鬆不下來？\n' +
      '早上鬧鐘響就起來運動、嚴格控制飲食，\n' +
      '該做的自律你都在做——\n\n' +
      '但你的肚子、腰圍、腹部的肉，卻一直消不掉。\n' +
      '你越焦慮，它越不走。\n\n' +
      '你以為是「還不夠努力」。\n' +
      '我要告訴你：你已經太努力了。\n\n' +
      '🚨 高轉速型最大的地雷，不是吃了什麼，\n' +
      '是你「一直把身體開在最高檔」這件事。\n\n' +
      '不管你是在做高強度運動、168、嚴格乾淨飲食，還是把自己逼得很緊，\n' +
      '你的身體一直處於戰鬥狀態——\n' +
      '皮質醇偏高、交感神經持續啟動，\n' +
      '身體以為你在逃命，反而拼命把脂肪存在腹部（這是演化的求生機制）。\n\n' +
      '這就是為什麼你越努力，肚子越不消。\n' +
      '不是你不夠認真，是身體把你的努力翻譯錯了。\n\n' +
      '但我要跟你說：這不是絕境，是你走錯方向。\n\n' +
      '✨ 真正要做的事，跟你過去學的完全相反——\n' +
      '不是更用力踩油門，是學會切換檔位：\n\n' +
      '1️⃣ 高強度運動減到 2-3 次/週\n' +
      '2️⃣ 其他天改成走路、伸展、瑜伽\n' +
      '3️⃣ 睡前 1 小時放下手機，讓副交感神經啟動\n\n' +
      '🌱 我帶過的高轉速型學員，有人是健身教練、有人是鐵人三項選手，\n' +
      '她們學會「踩煞車」之後，3-4 週腹部就開始消——\n' +
      '不是運動更多的結果，是終於休息夠的結果。\n\n' +
      '身體不是你的敵人，是你一直用錯的方式驅趕它。\n\n' +
      '👉 告訴我你目前幾公斤、想瘦到幾公斤，\n' +
      '我幫你看你這個類型下，怎麼放鬆身體又能進步。',
    menu:
      '你是不是覺得——「我飲食明明很乾淨，為什麼肚子還在？」\n\n' +
      '你吃得比多數人健康，\n' +
      '有量、有質、有營養概念，\n' +
      '但腹部的肉就是頑固。\n\n' +
      '高轉速型的飲食重點，不是「吃什麼」，\n' +
      '是「讓身體從戰鬥模式切回休息模式」。\n\n' +
      '📋 三個原則\n\n' +
      '1️⃣ 好油每餐都要夠（最重要）\n' +
      '酪梨、堅果、橄欖油、草飼奶油，每餐 1-2 湯匙。\n' +
      '好油是穩定皮質醇、降腹部脂肪的關鍵。\n' +
      '很多高轉速型的人不敢吃油，這是最大誤解。\n\n' +
      '2️⃣ 不要用咖啡換能量\n' +
      '靠黑咖啡硬撐會拉高皮質醇。\n' +
      '一天 1 杯以內，下午之後不喝。\n\n' +
      '3️⃣ 晚餐加一點原型碳水\n' +
      '地瓜、南瓜、糙米飯一小份。\n' +
      '晚上有碳水 = 血清素上升 = 副交感啟動 = 睡得深。\n' +
      '睡得深，隔天皮質醇才會正常。\n\n' +
      '🍽️ 簡單一天範例：\n' +
      '☀️ 早：炒蛋 2 顆 + 酪梨半顆 + 黑咖啡（不超過 1 杯）\n' +
      '🌤️ 午：蛋白質一個手掌 + 大量蔬菜 + 橄欖油，別吃太乾\n' +
      '🌙 晚：蛋白質 + 蔬菜 + 一份原型澱粉（地瓜或糙米）\n\n' +
      '非飲食但很重要：睡前 1 小時放下手機，副交感才有機會啟動。\n\n' +
      '🌱 我帶過的高轉速型學員，吃對油 + 晚上加一點碳水，\n' +
      '3-4 週腹部就開始消——\n' +
      '不是吃少的結果，是身體終於放鬆了。\n\n' +
      '👉 告訴我你目前幾公斤、想瘦到幾公斤，\n' +
      '我幫你看你這個類型下，怎麼吃讓肚子消下去。',
  },
  rollerCoaster: {
    name: '雲霄飛車型',
    tagline: '早上精神好到想跑步，下午累到想辭職',
    description:
      '你的血糖像坐雲霄飛車，忽高忽低。這讓你的精神狀態、食慾、專注力都跟著大起大落。不是你意志力不夠，是身體的血糖調控機制需要重建。',
    keyPoint: '穩定血糖 = 穩定情緒 = 穩定體重。三件事其實是同一件事。',
    suggestions: [
      '吃飯順序改成：菜 → 肉 → 飯（能有效減緩血糖上升）',
      '把精緻澱粉換成原型澱粉（白飯 → 糙米、地瓜）',
      '下午想吃甜食時，先吃一把堅果或一顆水煮蛋',
    ],
    articleUrl: 'https://abcmetabolic.com/articles/blood-sugar?utm_source=line&utm_medium=bot&utm_campaign=official',
    articleTitle: '血糖穩定，人生就穩定了',
    trapTeaser: '雲霄飛車型下午崩盤的真正原因',
    menuTeaser: '雲霄飛車型怎麼吃讓你下午不崩',
    trap:
      '你是不是一天當中某個時間點，會突然撐不住、一定要來點甜的？\n' +
      '巧克力、手搖飲、餅乾、蛋糕——\n' +
      '不吃不行，吃完又自責，晚上回家餓到暴食，\n' +
      '週末再補眠一次重來。\n\n' +
      '你以為這是意志力的問題，\n' +
      '晚上還會在心裡罵自己「怎麼又吃了」。\n\n' +
      '但我要跟你說：這根本不是你的錯。\n\n' +
      '🚨 雲霄飛車型最大的地雷，不是甜食，\n' +
      '是你「早上讓血糖衝上去」這件事。\n\n' +
      '不管你早餐是吐司、麵包、穀片、飯糰，還是飲料配咖啡，\n' +
      '只要開局是精緻澱粉 + 糖，你的血糖就已經坐上雲霄飛車了：\n\n' +
      '🌅 早上 → 衝高\n' +
      '☀️ 上午 → 急降\n' +
      '🌤️ 下午 → 崩盤\n' +
      '🌙 晚上 → 暴食\n\n' +
      '你下午想吃甜，不是意志力差，是你早餐寫好的劇本。\n' +
      '你晚上暴食，不是貪吃，是你一天血糖缺口累積的反撲。\n\n' +
      '好消息是：這條線可以立刻斷開。\n\n' +
      '🌱 我帶過的雲霄飛車型學員，有人是 10 年的嗜甜螞蟻人，\n' +
      '換掉一個早餐（從精緻澱粉換成蛋 + 酪梨 + 堅果），\n' +
      '3 天下午就不崩了，一週不會再想吃甜食。\n' +
      '不是壓抑——是身體根本不需要。\n\n' +
      '👉 告訴我你目前幾公斤、想瘦到幾公斤，\n' +
      '我幫你看你這個類型下，這個目標該怎麼走、多久能看到成果。',
    menu:
      '你是不是很想知道，怎麼吃才不會下午崩盤？\n\n' +
      '我知道你下午那種癱掉的感覺有多無力，\n' +
      '明明才中午，卻已經撐不住到下班。\n' +
      '吃了甜的精神回來一下下，又繼續掉。\n\n' +
      '雲霄飛車型的飲食重點，是「穩住血糖」。\n' +
      '穩住血糖 = 穩住精神 = 穩住情緒 = 穩住體重。\n\n' +
      '📋 三個原則\n\n' +
      '1️⃣ 早餐換掉精緻澱粉 + 糖\n' +
      '別吃吐司、麵包、穀片、含糖飲料。\n' +
      '換成蛋白質 + 好油 + 少量原型澱粉。\n' +
      '這一步就解決你一半的問題。\n\n' +
      '2️⃣ 吃飯順序：菜 → 肉 → 飯\n' +
      '同樣的食物，順序不一樣，血糖反應差一倍。\n' +
      '每一餐都這樣吃。\n\n' +
      '3️⃣ 下午想吃甜之前，先吃一把堅果或一顆水煮蛋\n' +
      '嘴饞其實是血糖訊號，不是食慾。\n' +
      '補一點蛋白質 + 好油，10 分鐘後你就不想吃甜了。\n\n' +
      '🍽️ 簡單早餐範例：\n' +
      '☀️ 炒蛋 2 顆 + 酪梨半顆 + 一小把堅果\n' +
      '☀️ 或：無糖優格 + 莓果 + 亞麻籽\n\n' +
      '下午應急包：堅果、水煮蛋、起司片，放抽屜或包包裡隨時備著。\n\n' +
      '🌱 我帶過的雲霄飛車型學員，換掉早餐這一步，\n' +
      '3 天下午就不癱，一週不再想吃甜——\n' +
      '不是壓抑，是身體根本不需要了。\n\n' +
      '👉 告訴我你目前幾公斤、想瘦到幾公斤，\n' +
      '我幫你看你這個類型下，菜單怎麼搭讓你下午不崩、晚上不暴。',
  },
  burnout: {
    name: '燃燒殆盡型',
    tagline: '不是你偷懶，是身體已經把油燒光了還在硬撐',
    description:
      '你的身體長期處於能量透支的狀態。可能節食過度、壓力太大、或長期睡眠不足。代謝已經開始自我保護，降低消耗來求生存。',
    keyPoint: '現在最重要的不是少吃，而是「吃對」讓身體重新信任你。',
    suggestions: [
      '先不要減少食量，確保每餐都有蛋白質（至少一個手掌大小）',
      '好油不要怕：每天至少 1-2 湯匙的好油脂',
      '優先處理睡眠，睡不好其他都白費',
    ],
    articleUrl: 'https://abcmetabolic.com/articles/metabolism-reset?utm_source=line&utm_medium=bot&utm_campaign=official',
    articleTitle: '你的代謝，可能只是需要重新啟動',
    trapTeaser: '燃盡型最傷代謝的那件事',
    menuTeaser: '燃盡型該怎麼吃才能把代謝養回來',
    trap:
      '你是不是有時候會覺得——\n' +
      '明明什麼都做對了，身體卻一點反應都沒有？\n\n' +
      '運動沒停、飲食在控制、甚至少吃到有點不舒服，\n' +
      '但看著鏡子，你感覺自己越來越累、越來越垮，\n' +
      '體重卻動都不動。\n\n' +
      '🚨 燃盡型最大的地雷，不是你多吃了什麼，\n' +
      '是你「長期讓身體缺油」這件事。\n\n' +
      '不管你是在做 168、低卡、斷食，還是單純吃得很少，\n' +
      '你身體接收到的訊號都是同一個：\n' +
      '「這個主人在跟我搶糧食，我必須進入求生模式。」\n\n' +
      '所以它降低代謝、守住每一分脂肪、讓你越累越瘦不下來。\n' +
      '這不是你偷懶，是你一直在逼一台沒油的車往前跑。\n\n' +
      '但我要跟你說：這不是絕境，是你走錯路。\n\n' +
      '🌱 我帶過很多燃盡型的學員——\n' +
      '有人 168 做了 3 年、有人節食了 10 年，\n' +
      '她們跟你一樣，以為自己「代謝壞了、救不回來了」。\n\n' +
      '結果呢？\n' +
      '先停掉少吃、回到三餐正常吃，每餐一個手掌蛋白質，\n' +
      '2-4 週身體就開始給反應：\n\n' +
      '1️⃣ 精神先回來\n' +
      '2️⃣ 睡眠好起來\n' +
      '3️⃣ 然後體重才開始動\n\n' +
      '順序是這樣的：先把身體養回來，瘦只是順便的事。\n\n' +
      '👉 告訴我你目前幾公斤、想瘦到幾公斤，\n' +
      '我幫你看你這個類型下，這個目標該怎麼走、要多久。',
    menu:
      '你是不是不知道自己現在到底該吃什麼？\n\n' +
      '該少的都少了、該戒的都戒了，\n' +
      '但每次面對冰箱還是很茫然——\n' +
      '「這個能吃嗎？這個會不會讓我胖？」\n\n' +
      '燃盡型的飲食原則，跟你過去學的完全相反。\n' +
      '不是「少」，是「對」。\n\n' +
      '📋 三個原則\n\n' +
      '1️⃣ 三餐都要吃，每餐不能少\n' +
      '身體只要一覺得你在餓它，就會進入求生模式。\n' +
      '再忙都要吃，只是吃對。\n\n' +
      '2️⃣ 每餐一個手掌的蛋白質（最優先）\n' +
      '蛋、雞肉、魚、豆腐，手掌大小一份。\n' +
      '這是重建代謝的燃料，不能省。\n\n' +
      '3️⃣ 好油不要怕\n' +
      '酪梨、堅果、橄欖油、無糖花生醬。\n' +
      '每餐 1-2 湯匙，幫你飽足、穩血糖、養荷爾蒙。\n\n' +
      '🍽️ 簡單一天範例：\n' +
      '☀️ 早：炒蛋 2 顆 + 半顆酪梨 + 一把堅果\n' +
      '🌤️ 午：煎雞胸 + 大量蔬菜 + 一小碗糙米飯\n' +
      '🌙 晚：魚或豆腐 + 蔬菜 + 橄欖油\n\n' +
      '看起來比你現在吃的多對不對？\n' +
      '這就是重點——你過去吃太少，現在要把量補回來，身體才會願意釋放。\n\n' +
      '🌱 我帶過的燃盡型學員，這樣吃 2-4 週，\n' +
      '不是體重先掉，是精神先回來、睡眠先好起來。\n' +
      '然後體重才會動。\n\n' +
      '順序是：先把身體養回來，瘦只是順便的事。\n\n' +
      '👉 告訴我你目前幾公斤、想瘦到幾公斤，\n' +
      '我幫你看你這個類型下，菜單怎麼搭最有效。',
  },
  powerSave: {
    name: '省電模式型',
    tagline: '吃很少還是瘦不下來？你的身體已經自己降速了',
    description:
      '你的身體進入了「省電模式」。長期低熱量攝取讓甲狀腺功能下調，基礎代謝率降低。吃少少的卻瘦不下來，就是這個原因。',
    keyPoint: '要讓代謝回來，第一步是「敢吃」。聽起來矛盾，但這是科學。',
    suggestions: [
      '循序漸進增加食量（每週多加 100-200 大卡，不要一次暴增）',
      '蛋白質是重建代謝的關鍵，每餐都要有',
      '加入阻力訓練（深蹲、硬舉），肌肉量 = 代謝的引擎',
    ],
    articleUrl: 'https://abcmetabolic.com/articles/thyroid-metabolism?utm_source=line&utm_medium=bot&utm_campaign=official',
    articleTitle: '為什麼越少吃越胖？省電模式的真相',
    trapTeaser: '省電模式型為什麼越吃少越胖',
    menuTeaser: '省電模式型該敢吃什麼',
    trap:
      '你是不是吃得不多，卻一直胖？\n' +
      '感覺自己呼吸都在長肉，\n' +
      '照鏡子看到的人越來越陌生？\n\n' +
      '你可能已經開始懷疑——\n' +
      '「是不是我甲狀腺有問題？」\n' +
      '「是不是更年期我這輩子就回不去了？」\n' +
      '「是不是我的身體壞了？」\n\n' +
      '我要告訴你：你沒壞，你的身體是進入了省電模式。\n\n' +
      '🚨 省電模式型最大的地雷，不是多吃了什麼，\n' +
      '是你「一直對身體太嚴」這件事。\n\n' +
      '不管你是做減醣、低卡、少吃、斷食、還是任何嚴格飲食，\n' +
      '你身體為了保命，把代謝主動調降了——\n' +
      '就像冬天的熊，把能量消耗降到最低。\n' +
      '你吃再少，它都只給你一點點燃燒配額。\n\n' +
      '這不是絕症，是保護機制。\n' +
      '保護機制，是可以關掉的。\n\n' +
      '✨ 真正要做的事，跟你過去學的完全相反——\n\n' +
      '1️⃣ 停掉任何形式的「限制」，三餐好好吃、吃到飽\n' +
      '2️⃣ 把蛋白質和好油補足\n' +
      '3️⃣ 讓身體相信「主人不會再餓我了」，它才會把代謝重新打開\n\n' +
      '🌱 我帶過的省電模式型學員，包括更年期的、甲狀腺低下的、\n' +
      '長期節食的，走過這條路之後，2-6 週身體會開始給訊號——\n' +
      '精神先回來、水腫先消、然後體重才會動。\n\n' +
      '順序是：先讓身體活回來，瘦才會發生。\n\n' +
      '👉 告訴我你目前幾公斤、想瘦到幾公斤，\n' +
      '我幫你看你這個類型下，怎麼重啟、要多久。',
    menu:
      '你是不是覺得——「我吃什麼都胖，那到底該吃什麼？」\n\n' +
      '你已經吃得比多數人少，\n' +
      '但身體就是不動，甚至還在增加。\n' +
      '所以你更不敢吃，結果更糟。\n\n' +
      '這個惡性循環要打破。\n' +
      '省電模式型的飲食原則，不是「少」，\n' +
      '是「讓身體相信你不會再餓它」。\n\n' +
      '📋 三個原則\n\n' +
      '1️⃣ 三餐一定要吃、不能少、不能空腹太久\n' +
      '空腹 = 繼續告訴身體「要存糧」。\n' +
      '三餐正常吃，餐間 4-6 小時，別拖延。\n\n' +
      '2️⃣ 蛋白質每餐一個手掌，重點中的重點\n' +
      '省電模式的身體最缺蛋白質。\n' +
      '蛋、雞、魚、豆腐——每餐都要，不能跳過。\n\n' +
      '3️⃣ 好油、原型碳水、原型食物\n' +
      '不要怕油——酪梨、堅果、橄欖油每天要有。\n' +
      '原型澱粉（地瓜、糙米、南瓜）比白飯好，\n' +
      '但不是不吃，是慢慢加回來。\n\n' +
      '🍽️ 簡單一天範例：\n' +
      '☀️ 早：蛋 2 顆 + 酪梨半顆 + 一片地瓜\n' +
      '🌤️ 午：雞腿 + 大量蔬菜 + 一小碗糙米飯\n' +
      '🌙 晚：魚或豆腐 + 蔬菜 + 橄欖油\n\n' +
      '看起來比你現在吃的多對不對？\n' +
      '這就是重點——敢吃，代謝才會回來。\n\n' +
      '🌱 我帶過的省電模式型學員，包括更年期、甲狀腺低下的，\n' +
      '這樣吃 2-6 週，身體訊號會先回來：\n' +
      '精神、睡眠、水腫先改善，然後體重才動。\n\n' +
      '順序是：先讓身體活回來，瘦才會發生。\n\n' +
      '👉 告訴我你目前幾公斤、想瘦到幾公斤，\n' +
      '我幫你看你這個類型下，怎麼把代謝一步一步打開。',
  },
  steady: {
    name: '穩定燃燒型',
    tagline: '朋友都問你怎麼吃不胖，但你知道自己其實可以更好',
    description:
      '你的代謝狀態相對健康，身體的基礎運作是穩定的。但「不差」不等於「最好」，你還有很大的優化空間。',
    keyPoint: '你的起點比多數人好，接下來要做的是精進，不是從頭來過。',
    suggestions: [
      '嘗試拉長空腹時間（12-14 小時），讓身體練習用脂肪當燃料',
      '增加蛋白質攝取到每公斤體重 1.2-1.6g',
      '規律運動 + 充足睡眠，把優勢鞏固住',
    ],
    articleUrl: 'https://abcmetabolic.com/articles/metabolic-flexibility?utm_source=line&utm_medium=bot&utm_campaign=official',
    articleTitle: '什麼是代謝彈性？為什麼它是健康的終極指標',
    trapTeaser: '穩定型容易忽略的小陷阱',
    menuTeaser: '穩定型該怎麼吃精進到更好',
    trap:
      '你是不是朋友都說你瘦，但你自己知道——\n' +
      '還不是你想要的狀態？\n\n' +
      '體重不至於讓人擔心，\n' +
      '飲食作息也比多數人規律，\n' +
      '但你看得出來：還可以更好。\n' +
      '只是不知道從哪裡下手。\n\n' +
      '🚨 穩定燃燒型不是沒問題，\n' +
      '你的地雷是「以為自己已經夠好了」這件事。\n\n' +
      '你可能正在吃一些「看起來健康」的東西——\n' +
      '果乾、果汁、燕麥奶、低糖飲料、標榜健康的零食、\n' +
      '甚至每天一顆大蘋果。\n' +
      '這些在一般人身上沒事，\n' +
      '但在你已經不錯的代謝上，\n' +
      '它們就是擋住你「從不差變到最好」的那道牆。\n\n' +
      '不差 ≠ 最好。\n' +
      '你的起點比別人好，代表你可以比別人走得更遠，\n' +
      '而不是待在原地。\n\n' +
      '✨ 真正要做的是精進，不是重來：\n\n' +
      '1️⃣ 水果濃縮製品換成原型水果（一天一份就夠）\n' +
      '2️⃣ 蛋白質補到每公斤體重 1.2-1.6g\n' +
      '3️⃣ 加入 12-14 小時空腹（晚上 8 點後不吃、早上 8 點再開始）\n\n' +
      '讓身體練習「用脂肪當燃料」，代謝彈性會變好。\n\n' +
      '🌱 我帶過的穩定燃燒型學員，不需要翻天覆地，\n' +
      '只要把 2-3 個小細節校準，3-4 週體態就會變——\n' +
      '不是瘦很多，是更結實、更有線條、衣服更合身。\n\n' +
      '👉 告訴我你目前幾公斤、想瘦到幾公斤，\n' +
      '我幫你看你這個類型下，怎麼精進到你想要的樣子。',
    menu:
      '你是不是覺得——「我現在吃的已經很健康了，還能怎麼進步？」\n\n' +
      '這是穩定燃燒型很常有的卡點。\n' +
      '你不是吃得不好，是卡在「不差 → 最好」的那道牆。\n\n' +
      '進步來自校準，不是翻天覆地。\n\n' +
      '📋 三個原則\n\n' +
      '1️⃣ 蛋白質拉滿\n' +
      '很多穩定型的人蛋白質其實不夠。\n' +
      '目標：每公斤體重 1.2-1.6g，每餐一個手掌以上。\n' +
      '這會讓你從「不差」變「更結實有線條」。\n\n' +
      '2️⃣ 水果濃縮製品剔除\n' +
      '果汁、果乾、燕麥奶、標榜健康的甜品——\n' +
      '這些是你還在卡關的主因。\n' +
      '換成原型水果，一天一份就好。\n\n' +
      '3️⃣ 加入 12-14 小時空腹\n' +
      '12 小時就夠——晚上 8 點吃完，早上 8 點再吃。\n' +
      '不需要挑戰極限，身體就會開始練習「用脂肪當燃料」，代謝彈性會變好。\n\n' +
      '🍽️ 簡單一天範例：\n' +
      '☀️ 早：2-3 顆蛋 + 酪梨 + 一小份原型澱粉\n' +
      '🌤️ 午：大份蛋白質（手掌 1.5 倍）+ 大量蔬菜 + 好油\n' +
      '🌙 晚：蛋白質 + 蔬菜 + 一份原型澱粉\n' +
      '🍎 水果：一天一份原型水果（例如半顆蘋果）\n\n' +
      '🌱 我帶過的穩定燃燒型學員，不需要大改，\n' +
      '把這 3 個細節校準，3-4 週體態就會變——\n' +
      '不是瘦很多，是更結實、更有線條。\n\n' +
      '你的起點比別人好，代表你可以走得更遠。\n\n' +
      '👉 告訴我你目前幾公斤、想瘦到幾公斤，\n' +
      '我幫你看你這個類型下，怎麼精進到你想要的樣子。',
  },
};

function getMetabolismReport(type) {
  const report = METABOLISM_REPORTS[type];
  if (!report) return [{ type: 'text', text: '找不到你的代謝報告，請重新做一次測驗：\nhttps://abcmetabolic.com/quiz?utm_source=line&utm_medium=bot&utm_campaign=official' }];

  const text =
    `📋 你的代謝類型：${report.name}\n\n` +
    `「${report.tagline}」\n\n` +
    `${report.description}\n\n` +
    `💡 ${report.keyPoint}\n\n` +
    `── 你現在可以做的 3 件事 ──\n\n` +
    report.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n') +
    `\n\n📖 推薦閱讀：\n${report.articleTitle}\n${report.articleUrl}\n\n` +
    `━━━━━━━━━━━━━━━\n\n` +
    `看完報告只是第一步，想繼續聊的話：\n\n` +
    `👉 回「地雷」— 我告訴你${report.trapTeaser}\n` +
    `👉 回「菜單」— 我告訴你${report.menuTeaser}\n` +
    `👉 或直接告訴我你目前幾公斤、想瘦到幾公斤，我告訴你這個目標在你這個類型下要多久、該怎麼走\n\n` +
    `我是一休，陪你健康的瘦一輩子`;

  return [{ type: 'text', text }];
}

function getArticlesForType(type) {
  const report = METABOLISM_REPORTS[type];
  if (report) {
    return (
      `根據你的代謝類型「${report.name}」，推薦你先看這篇：\n\n` +
      `📖 ${report.articleTitle}\n${report.articleUrl}\n\n` +
      `更多文章 👇\nhttps://abcmetabolic.com/articles?utm_source=line&utm_medium=bot&utm_campaign=official`
    );
  }
  return '推薦你從這些文章開始：\nhttps://abcmetabolic.com/articles?utm_source=line&utm_medium=bot&utm_campaign=official';
}
