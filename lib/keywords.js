// 關鍵字自動回覆系統
// 規則：匹配到 → 自動回覆；沒匹配 → 不回覆（一休手動處理）

import { getUser } from './users.js';

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
    id: 'pricing',
    keywords: ['方案', '價格', '費用', '多少錢', '怎麼報名', '課程'],
    handler: handlePricing,
  },
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
    keywords: ['ABC', 'abc', '怎麼瘦', '瘦身', '減肥', '代謝'],
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
      text: '你好像還沒做過代謝類型測驗 🙂\n\n花 2 分鐘測一下，我幫你生成專屬的代謝報告：\nhttps://abcmetabolic.com/quiz',
    },
  ];
}

async function handlePricing() {
  return [
    {
      type: 'text',
      text: '目前 ABC 代謝重建瘦身法有提供線上課程 💪\n\n想了解詳細方案和價格的話，可以先參加我們的免費說明會，我會完整說明課程內容和適合的方案：\n\n👉 最近一場說明會報名：\nhttps://abcmetabolic.com/seminar\n\n有任何問題也可以直接問我！',
    },
  ];
}

async function handleSeminar() {
  // 說明會資訊從 config 讀取，一休更新時改 config 就好
  const { SEMINAR_INFO } = await import('./config.js');
  return [
    {
      type: 'text',
      text: SEMINAR_INFO,
    },
  ];
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

async function handleABC() {
  return [
    {
      type: 'text',
      text: 'ABC 代謝重建瘦身法的核心概念：\n\n你的問題不是胖，是代謝失調。\n重建代謝力，瘦只是順便的事。\n\n✅ 不算熱量、不挨餓\n✅ 用加法思維：增加好的食物\n✅ 重建胰島素敏感度\n✅ 恢復身體的代謝彈性\n\n想知道自己的代謝狀態嗎？\n花 2 分鐘測一下 👇\nhttps://abcmetabolic.com/quiz',
    },
  ];
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
    articleUrl: 'https://abcmetabolic.com/articles/cortisol-fat',
    articleTitle: '為什麼你越努力越胖？皮質醇的秘密',
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
    articleUrl: 'https://abcmetabolic.com/articles/blood-sugar',
    articleTitle: '血糖穩定，人生就穩定了',
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
    articleUrl: 'https://abcmetabolic.com/articles/metabolism-reset',
    articleTitle: '你的代謝，可能只是需要重新啟動',
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
    articleUrl: 'https://abcmetabolic.com/articles/thyroid-metabolism',
    articleTitle: '為什麼越少吃越胖？省電模式的真相',
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
    articleUrl: 'https://abcmetabolic.com/articles/metabolic-flexibility',
    articleTitle: '什麼是代謝彈性？為什麼它是健康的終極指標',
  },
};

function getMetabolismReport(type) {
  const report = METABOLISM_REPORTS[type];
  if (!report) return [{ type: 'text', text: '找不到你的代謝報告，請重新做一次測驗：\nhttps://abcmetabolic.com/quiz' }];

  const text =
    `📋 你的代謝類型：${report.name}\n\n` +
    `「${report.tagline}」\n\n` +
    `${report.description}\n\n` +
    `💡 ${report.keyPoint}\n\n` +
    `── 你現在可以做的 3 件事 ──\n\n` +
    report.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n') +
    `\n\n📖 推薦閱讀：\n${report.articleTitle}\n${report.articleUrl}\n\n` +
    `有任何問題都可以直接問我 🙂\n` +
    `我是一休，陪你健康的瘦一輩子`;

  return [{ type: 'text', text }];
}

function getArticlesForType(type) {
  const report = METABOLISM_REPORTS[type];
  if (report) {
    return (
      `根據你的代謝類型「${report.name}」，推薦你先看這篇：\n\n` +
      `📖 ${report.articleTitle}\n${report.articleUrl}\n\n` +
      `更多文章 👇\nhttps://abcmetabolic.com/articles`
    );
  }
  return '推薦你從這些文章開始：\nhttps://abcmetabolic.com/articles';
}
