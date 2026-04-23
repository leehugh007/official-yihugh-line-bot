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
import {
  getUser,
  upsertUser,
  recordInteraction,
  markBlocked,
  getUserPathState,
  updatePathStage,
  updateAiTags,
} from '../../../lib/users.js';
import { getSettingTyped } from '../../../lib/official-settings.js';
import { renderTemplate } from '../../../lib/templates.js';
import {
  CHOICE_TO_PATH,
  isMainChoice,
  detectMultiChoice,
  extractWeights,
  pickWeightDiffCondition,
  parseQ3Choice,
} from '../../../lib/conversation-path.js';
import {
  matchPoliteEnd,
  matchGlobalHandoff,
  triggerHandoff,
  handlePoliteEnd,
} from '../../../lib/handoff.js';
import { generateFinalFeedback, verifyHandoffIntent } from '../../../lib/ai-classifier.js';
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
// 2026-04-23 一休決策切 false：Phase 3.3 B 軌 Q1→Q4 全量開放
// 斷點背景：A 軌菜單/地雷回覆末尾問體重，333/335 用戶已輸入回應但被 TEST_MODE 擋靜默
// 現在 B 軌全開，用戶回體重會自動走 Q1→Q2→Q3→Q4 AI 回饋
// stage=4 後再傳訊息目前仍靜默（Phase 4.2 Q5 未 wire，是預期行為，一休 OK 訊息有進 DB 可人工處理）
// 未來：搬到 official_settings 表讓後台可開關（契約 v2.3 backlog）
const TEST_MODE = false;
const TEST_ALLOWLIST = [
  'U51808e2cc195967eba53701518e6f547', // 一休
  'U3edf3d2114ee03ad81cff1fd35c04600', // 婉馨
];

async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  // 代碼領取 + A 軌關鍵字回覆：都繞過 TEST_MODE（全量用戶可用）
  // A 軌 = 地雷 / 菜單 / 報告 / 方案 / 說明會 / 文章 / ABC 等靜態關鍵字回覆
  // 跟代碼領取同等地位：走 matchKeyword 命中即回，不進對話路徑 dispatch
  if (event.type === 'message' && event.message?.type === 'text') {
    const text = event.message.text.trim();

    // 代碼領取
    if (/^[A-Z2-9]{4}$/.test(text)) {
      const claimed = await handleCodeClaim(event, userId, text);
      if (claimed) return; // 代碼有效，已回覆
    }

    // Phase 3.3: Handoff/禮貌結束 pre-check（放在 A 軌關鍵字之前）
    // 根因：「我老公反對我瘦身」含『瘦身』→ matchKeyword 先命中 → 回代謝測驗 → handoff 沒機會跑
    // 修法：stage>=2 用戶先走 Level 0（禮貌結束）+ Level 1（Handoff + 方案 C AI verify）
    //       verify 判 false 或沒命中 → fall through 到 A 軌關鍵字 / 對話路徑 dispatch
    const preUser = await getUser(userId);
    const preStage = preUser?.path_stage ?? 0;
    if (preUser && !preUser.is_blocked && preStage >= 2 && preStage !== 5) {
      // Level 0 禮貌結束
      if (await matchPoliteEnd(text)) {
        await recordInteraction(userId);
        await handlePoliteEnd(event, userId, replyMessage);
        return;
      }
      // Level 1 Handoff + AI 二次判斷
      const preReason = await matchGlobalHandoff(text);
      if (preReason) {
        const verify = await verifyHandoffIntent({ text, reason: preReason });
        console.log('[Handoff] pre-keyword verify:', {
          userId,
          reason: preReason,
          is_intent: verify.is_intent,
          confidence: verify.confidence,
          fallback: verify.fallback,
        });
        if (verify.is_intent) {
          await recordInteraction(userId);
          const ok = await triggerHandoff(userId, preReason);
          if (ok) {
            const messages = [
              textMessage('你這個問題值得好好聊，我請 fifi 助教私訊你，她會主動找你。'),
            ];
            if (TEST_MODE && TEST_ALLOWLIST.includes(userId)) {
              messages.push(
                textMessage(
                  `[debug] Handoff 觸發(pre-keyword)：reason=${preReason}, ai_verify=${verify.is_intent}(${verify.confidence})${verify.fallback ? ' [fallback]' : ''}`
                )
              );
            }
            await replyMessage(event.replyToken, messages);
            return;
          }
        }
        // verify 判 false → fall through（讓 A 軌關鍵字或對話路徑接）
      }
    }

    // A 軌關鍵字（繞過 TEST_MODE，跟代碼領取同等地位）
    const rule = matchKeyword(text);
    if (rule) {
      // 確保用戶檔案存在 + 記錄互動（對齊 handleTextMessage 的邏輯）
      const existingUser = preUser || (await getUser(userId));
      if (!existingUser) {
        const profile = await getProfile(userId);
        await upsertUser(userId, {
          displayName: profile?.displayName || '',
          source: 'legacy',
        });
      }
      await recordInteraction(userId);

      // Phase 3.3 bug fix (2026-04-23)：A 軌命中 → 用戶有瘦身意圖，stage=0 upgrade 到 1
      // A 軌 handler 末尾會問「告訴我你目前幾公斤、想瘦到幾公斤」，用戶有機率回自由文字
      // （「就是想瘦」「我不知道體重」etc），靠 stage=1 讓 handleConversationPath 能接住。
      // stage>=1 不動（不 regress 正在走 B 軌的用戶）
      const preStageForUpgrade = preUser?.path_stage ?? 0;
      if (preStageForUpgrade === 0) {
        await supabase
          .from('official_line_users')
          .update({
            path_stage: 1,
            path_stage_updated_at: new Date().toISOString(),
          })
          .eq('line_user_id', userId);
      }

      const messages = await rule.handler(userId);
      await replyMessage(event.replyToken, messages);
      return;
    }
  }

  // 測試模式：白名單外的人靜默（代碼領取 + A 軌關鍵字除外，上面已處理）
  // 放在 idempotency INSERT 之前，避免非白名單用戶污染 official_webhook_events
  if (TEST_MODE && !TEST_ALLOWLIST.includes(userId)) return;

  // Webhook idempotency（Phase 3.1）：LINE retry 會用同一個 webhookEventId
  // 先 INSERT PK；違反 (23505) = 重複事件，skip
  const eventId = event.webhookEventId;
  if (eventId) {
    const { error: dupErr } = await supabase
      .from('official_webhook_events')
      .insert({ event_id: eventId });
    if (dupErr?.code === '23505') {
      console.log('[Webhook] Duplicate event, skip:', eventId);
      return;
    }
    // 其他 INSERT 錯（例如網路暫失） → log 但繼續處理（不擋正常流程）
    if (dupErr) console.error('[Webhook] idempotency INSERT failed:', dupErr.message);
  }

  switch (event.type) {
    case 'follow':
      await handleFollow(event, userId);
      break;
    case 'unfollow':
      await markBlocked(userId);
      break;
    case 'message': {
      // Q5 契約 v2.3 Ch.0.7：pre-check 讀 state 一次，之後傳入 handler（減 DB read）
      const msgType = event.message?.type;
      const state = await getUserPathState(userId);

      // Q5 契約 v2.3 Ch.7.2：stage=6/7 非文字訊息（貼圖/影片/檔案/圖片）→ 軟 handoff
      // 觸發 q5_non_text_query，用戶用非文字表達在 /apply 附近的狀態 → 接回真人
      //
      // yi-challenge #2 洞修法：加 q5_sent_at 守門。Defense in depth —
      //   避免 rollback race window 中「stage=6 但 Q5 其實沒送達」的用戶
      //   被誤判為已進 Q5 軌。按 PR 0.10 新 rollback 策略 q5_sent_at 不會被清，
      //   這個 guard 在 race window 極短的當下自動收斂，多一層防禦不花成本。
      if (
        (state?.path_stage === 6 || state?.path_stage === 7) &&
        state?.q5_sent_at &&
        msgType !== 'text'
      ) {
        await recordInteraction(userId);
        const ok = await triggerHandoff(userId, 'q5_non_text_query');
        if (ok) {
          // TODO Phase 4.1：改走 getSettingTyped('q5_non_text_soft_handoff_text')
          await replyMessage(event.replyToken, [
            textMessage(
              '我這邊只能看文字訊息，你的情況我請 fifi 助教直接跟你聊，她等等會主動找你。\n\n有什麼想先問的，你也可以直接打字告訴我。'
            ),
          ]);
        }
        break;
      }

      if (msgType === 'text') {
        await handleTextMessage(event, userId, state);
      } else if (msgType === 'image') {
        await handleImageMessage(event, userId, state);
      }
      // 其他（貼圖、影片、檔案等，stage ≠ 6/7）→ 不回覆
      break;
    }
    case 'postback':
      // Q5 契約 v2.3 Ch.0.2：Q5 軟邀請 Quick Reply「有問題想問」→ handoff
      // Phase 4.2 之後，visit-followup 等多入口也會進來（Ch.11.5）
      await handlePostback(event, userId);
      break;
  }
}

// ============================================================
// Postback 事件（Q5 契約 v2.3 Ch.0.2 / Ch.6.1.1）
// ============================================================
async function handlePostback(event, userId) {
  const rawData = event.postback?.data || '';
  const params = new URLSearchParams(rawData);
  const action = params.get('action');

  if (action === 'handoff_from_q5') {
    // 用戶按 Q5 軟邀請的「有問題想問」→ stage=5 + notify 婉馨/一休
    await recordInteraction(userId);
    const ok = await triggerHandoff(userId, 'q5_followup');
    if (ok) {
      // 契約 Ch.6.1.1 stage=6/7 專屬 handoff 文案
      const message = textMessage(
        '我有看到你的問題。這個我請 fifi 直接跟你聊，她看過你剛剛跟我聊的內容，會知道你在哪個階段，等等會主動找你。\n\n先不急著決定要不要進課程，把問題問清楚再說。'
      );
      await replyMessage(event.replyToken, [message]);
    }
    return;
  }

  // 未知 action → 靜默（未來擴 visit-followup 等新入口時再加 branch）
  console.log('[Postback] unknown action, ignored:', { userId, rawData });
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

  // 3. 再查脂肪肝代碼
  const { data: fattyLiverSession } = await supabase
    .from('fatty_liver_sessions')
    .select('*')
    .eq('claim_code', code)
    .single();

  if (fattyLiverSession) {
    return await handleFattyLiverCodeClaim(event, userId, fattyLiverSession);
  }

  // 4. 再查 TDEE 代碼
  const { data: tdeeSession } = await supabase
    .from('tdee_sessions')
    .select('*')
    .eq('claim_code', code)
    .single();

  if (tdeeSession) {
    return await handleTdeeCodeClaim(event, userId, tdeeSession);
  }

  // 5. 再查血糖穩定度代碼
  const { data: bloodSugarSession } = await supabase
    .from('blood_sugar_sessions')
    .select('*')
    .eq('claim_code', code)
    .single();

  if (bloodSugarSession) {
    return await handleBloodSugarCodeClaim(event, userId, bloodSugarSession);
  }

  // 6. 再查糖攝取代碼
  const { data: sugarSession } = await supabase
    .from('sugar_sessions')
    .select('*')
    .eq('claim_code', code)
    .single();

  if (sugarSession) {
    return await handleSugarCodeClaim(event, userId, sugarSession);
  }

  return false; // 六張表都查不到
}

// 糖攝取代碼領取
async function handleSugarCodeClaim(event, userId, session) {
  const existingUser = await getUser(userId);
  if (!existingUser) {
    const profile = await getProfile(userId);
    await upsertUser(userId, {
      displayName: profile?.displayName || '',
      source: 'sugar',
    });
  }

  const dripNextAt = new Date();
  dripNextAt.setDate(dripNextAt.getDate() + 1);
  dripNextAt.setUTCHours(0, 0, 0, 0);

  const keepSource = ['quiz', 'protein'].includes(existingUser?.source);
  await supabase
    .from('official_line_users')
    .update({
      source: keepSource ? existingUser.source : 'sugar',
      drip_next_at: existingUser?.drip_next_at || dripNextAt.toISOString(),
    })
    .eq('line_user_id', userId);

  await supabase
    .from('sugar_sessions')
    .update({ claimed_by: userId, claimed_at: new Date().toISOString() })
    .eq('id', session.id);

  await recordInteraction(userId);

  const profile = await getProfile(userId);
  const report = buildSugarReport(session, profile?.displayName || '');
  await replyMessage(event.replyToken, report);
  return true;
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

// 脂肪肝代碼領取
async function handleFattyLiverCodeClaim(event, userId, session) {
  const existingUser = await getUser(userId);
  if (!existingUser) {
    const profile = await getProfile(userId);
    await upsertUser(userId, {
      displayName: profile?.displayName || '',
      source: 'fatty_liver',
    });
  }

  const dripNextAt = new Date();
  dripNextAt.setDate(dripNextAt.getDate() + 1);
  dripNextAt.setUTCHours(0, 0, 0, 0);

  // 更新用戶來源 + 啟動 Drip（quiz/protein 優先）
  const keepSource = ['quiz', 'protein'].includes(existingUser?.source);
  await supabase
    .from('official_line_users')
    .update({
      source: keepSource ? existingUser.source : 'fatty_liver',
      drip_next_at: existingUser?.drip_next_at || dripNextAt.toISOString(),
    })
    .eq('line_user_id', userId);

  // 標記已領取
  await supabase
    .from('fatty_liver_sessions')
    .update({ claimed_by: userId, claimed_at: new Date().toISOString() })
    .eq('id', session.id);

  await recordInteraction(userId);

  const profile = await getProfile(userId);
  const report = buildFattyLiverReport(session, profile?.displayName || '');
  await replyMessage(event.replyToken, report);
  return true;
}

// 血糖穩定度代碼領取
async function handleBloodSugarCodeClaim(event, userId, session) {
  const existingUser = await getUser(userId);
  if (!existingUser) {
    const profile = await getProfile(userId);
    await upsertUser(userId, {
      displayName: profile?.displayName || '',
      source: 'blood_sugar',
    });
  }

  const dripNextAt = new Date();
  dripNextAt.setDate(dripNextAt.getDate() + 1);
  dripNextAt.setUTCHours(0, 0, 0, 0);

  const keepSource = ['quiz', 'protein'].includes(existingUser?.source);
  await supabase
    .from('official_line_users')
    .update({
      source: keepSource ? existingUser.source : 'blood_sugar',
      drip_next_at: existingUser?.drip_next_at || dripNextAt.toISOString(),
    })
    .eq('line_user_id', userId);

  await supabase
    .from('blood_sugar_sessions')
    .update({ claimed_by: userId, claimed_at: new Date().toISOString() })
    .eq('id', session.id);

  await recordInteraction(userId);

  const profile = await getProfile(userId);
  const report = buildBloodSugarReport(session, profile?.displayName || '');
  await replyMessage(event.replyToken, report);
  return true;
}

// TDEE 代碼領取
async function handleTdeeCodeClaim(event, userId, session) {
  const existingUser = await getUser(userId);
  if (!existingUser) {
    const profile = await getProfile(userId);
    await upsertUser(userId, {
      displayName: profile?.displayName || '',
      source: 'tdee',
    });
  }

  const dripNextAt = new Date();
  dripNextAt.setDate(dripNextAt.getDate() + 1);
  dripNextAt.setUTCHours(0, 0, 0, 0);

  const keepSource = ['quiz', 'protein'].includes(existingUser?.source);
  await supabase
    .from('official_line_users')
    .update({
      source: keepSource ? existingUser.source : 'tdee',
      drip_next_at: existingUser?.drip_next_at || dripNextAt.toISOString(),
    })
    .eq('line_user_id', userId);

  await supabase
    .from('tdee_sessions')
    .update({ claimed_by: userId, claimed_at: new Date().toISOString() })
    .eq('id', session.id);

  await recordInteraction(userId);

  const profile = await getProfile(userId);
  const report = buildTdeeReport(session, profile?.displayName || '');
  await replyMessage(event.replyToken, report);
  return true;
}

// ============================================================
// 文字訊息處理
// ============================================================
async function handleTextMessage(event, userId, state) {
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

  // 代碼領取 + A 軌關鍵字比對已在 handleEvent 層處理（繞過 TEST_MODE）
  // 到這裡代表：白名單用戶，訊息不是代碼也不是 A 軌關鍵字 → 走對話路徑
  // state 由 caller 傳入（Q5 契約 v2.3 Ch.0.7 避免重讀 DB）
  const handled = await handleConversationPath(event, userId, text, state);
  if (handled) return;

  // 對話路徑也沒接到 → 靜默（一休/婉馨手動處理）
}

// ============================================================
// Phase 3.1 對話路徑 dispatch（無 AI，純 regex + 選項比對）
// ============================================================

// CHOICE_TO_PATH / isMainChoice / extractWeights / pickWeightDiffCondition
// 已抽出到 lib/conversation-path.js（便於單元測試 + Phase 3.2 reuse）

// 讀啟用的單一模板（partial index 已 WHERE is_active=true）
async function getTemplate(path, stage, condition) {
  let q = supabase
    .from('official_reply_templates')
    .select('*')
    .eq('stage', stage)
    .eq('condition', condition)
    .eq('is_active', true)
    .limit(1);
  // path 可能為 NULL（Q1/Q2 通用）
  if (path === null || path === undefined) {
    q = q.is('path', null);
  } else {
    q = q.eq('path', path);
  }
  const { data, error } = await q.maybeSingle();
  if (error) {
    console.error('[getTemplate] error:', error.message, { path, stage, condition });
    return null;
  }
  return data;
}

// pickWeightDiffCondition 已在 lib/conversation-path.js，此處包裝讀 setting
async function pickWeightDiffConditionWithSettings(diff) {
  const smallMax = await getSettingTyped('weight_diff_small_max'); // default 5
  const largeMin = await getSettingTyped('weight_diff_large_min'); // default 15
  return pickWeightDiffCondition(diff, smallMax, largeMin);
}

/**
 * 對話路徑 dispatch（MVP 版本）
 * 回傳 true = 已處理（發出 reply），false = 未處理（讓 caller 靜默）
 */
async function handleConversationPath(event, userId, text, state) {
  // state 由 caller 傳入（Q5 契約 v2.3 Ch.0.7 pre-check 讀一次，避免下游重讀）
  // 注意：L745 state2 二讀保留 — 那是 updatePathStage(3) 之後要拿最新 state，不能共用

  // 封鎖用戶 / Stage 5 特例：Phase 3.1/3.2a 不接，留給 3.3 處理
  if (state.is_blocked) return false;
  if (state.path_stage === 5) return false;

  const stage = state.path_stage ?? 0;

  // Phase 3.3: Level 0/1 handoff 已移到 handleEvent 的 A 軌關鍵字之前處理
  // 原因：「我老公反對我瘦身」含『瘦身』會先被 matchKeyword 攔截，handoff 沒機會跑
  // 詳見 handleEvent 內的 pre-keyword handoff block

  // === 分支 1：Q1→Q2（stage 0 或 1，用戶提供體重數字）===
  if (stage <= 1) {
    const weights = extractWeights(text);
    if (!weights) {
      // Phase 3.3 bug fix (2026-04-23)：stage=1 自由文字 → 輕量引導（原本 return false 靜默）
      // stage=0 維持靜默（保護新用戶：沒走過 A 軌的新加好友打招呼不該被硬塞「要兩個數字」）
      // stage=1 = A 軌命中後 upgrade 過（見 L144-161 matchKeyword 分支），用戶明確在 Q1 階段
      if (stage === 1) {
        const retryTpl = await getTemplate(null, 1, 'retry_weight');
        if (retryTpl) {
          const msg = await renderTemplate(retryTpl, {});
          await replyMessage(event.replyToken, [textMessage(msg)]);
          await supabase
            .from('official_line_users')
            .update({ last_user_reply_at: new Date().toISOString() })
            .eq('line_user_id', userId);
          return true;
        }
        console.error('[ConversationPath] stage=1 fallback: q1_retry_weight template missing/inactive');
      }
      return false; // stage=0 或 template 缺失 → 靜默
    }

    const { current, target } = weights;

    // 打反了（目標 ≥ 現在）→ 推 q1_target_invalid
    if (target >= current) {
      const tpl = await getTemplate(null, 1, 'weight_target_invalid');
      if (!tpl) {
        console.error('[ConversationPath] q1_target_invalid template missing/inactive');
        return false;
      }
      const text2 = await renderTemplate(tpl, { current_weight: current, target_weight: target });
      await replyMessage(event.replyToken, [textMessage(text2)]);
      // 不推進 stage（等用戶重答）
      await supabase
        .from('official_line_users')
        .update({ last_user_reply_at: new Date().toISOString() })
        .eq('line_user_id', userId);
      return true;
    }

    // 正常 → 寫體重 + 推進 stage=2
    const diff = current - target;
    const condition = await pickWeightDiffConditionWithSettings(diff);
    const tpl = await getTemplate(null, 2, condition);
    if (!tpl) {
      console.error('[ConversationPath] q2 template missing/inactive:', condition);
      return false;
    }

    // 寫 current/target + last_user_reply_at + 推進 stage=2
    await supabase
      .from('official_line_users')
      .update({
        current_weight: current,
        target_weight: target,
        last_user_reply_at: new Date().toISOString(),
      })
      .eq('line_user_id', userId);

    const r = await updatePathStage(userId, 2);
    if (!r.ok) console.error('[ConversationPath] updatePathStage(2) failed:', r.error);

    const q2Text = await renderTemplate(tpl, { current_weight: current, target_weight: target });

    // chain_next_id：推完 Q2 體重差距馬上 push Q2 主因選項
    const messages = [textMessage(q2Text)];
    if (tpl.chain_next_id) {
      const nextTpl = await getTemplate(null, 2, 'path_choice');
      if (nextTpl) {
        const nextText = await renderTemplate(nextTpl, { current_weight: current, target_weight: target });
        messages.push(textMessage(nextText));
      }
    }
    await replyMessage(event.replyToken, messages);
    return true;
  }

  // === 分支 2：Q2→Q3（stage === 2，用戶選 A/B/C/D）===
  if (stage === 2) {
    const choice = isMainChoice(text);
    if (!choice) {
      // Phase 3.3: 偵測複選（AB / ABD / A,B ...）→ 引導選單一
      // 不接敘述式複選（「選 A 跟 B」）— 這種交給未來 AI 分類
      const multi = detectMultiChoice(text);
      if (multi) {
        const letters = multi.join('、');
        await replyMessage(event.replyToken, [
          textMessage(
            `選 ${letters} 的話，每個都蠻常見的。先挑「最困擾你」或「最想先處理」的那一個就好，其他之後再聊。回 A/B/C/D 其中一個給我。`
          ),
        ]);
        return true;
      }

      // Phase 3.3 bug fix (2026-04-23)：stage=2 自由文字 fallback
      // 原本 return false 靜默 → 用戶卡住（許莎拉「就是想瘦」案例）

      // 2a. 命中 extractWeights（重傳體重）→ 當「修正數字意圖」處理
      //
      // Phase 3.3 incident fix (2026-04-23 晚)：
      //   PR #35 第一版只重推 path_choice 沒更新 DB current/target，
      //   結果用戶第一次打錯（或 LINE 收回 + 重發正確數字）時，DB 仍卡在舊值，
      //   Q4 AI 用錯的 target 產出離譜 diff（KCw 案例：打 58→33 收回改 58→50，
      //   Bot Q4 回「想瘦 25 公斤」來自舊 target=33）。
      //
      // 修法：更新 DB current/target + 用新 diff 重推 Q2 weight_diff 模板 + path_choice，
      //       讓 Bot 對「修正後的數字」有認知，下游 Q4 AI 拿到對的 target。
      //       不升 stage（已是 2），只更新數字。
      const maybeWeights = extractWeights(text);
      if (maybeWeights) {
        const { current, target } = maybeWeights;

        // 打反（target >= current）→ 走 Q1 target_invalid（抄 stage<=1 分支 L720-734）
        if (target >= current) {
          const invalidTpl = await getTemplate(null, 1, 'weight_target_invalid');
          if (invalidTpl) {
            const invText = await renderTemplate(invalidTpl, {
              current_weight: current,
              target_weight: target,
            });
            await replyMessage(event.replyToken, [textMessage(invText)]);
            await supabase
              .from('official_line_users')
              .update({ last_user_reply_at: new Date().toISOString() })
              .eq('line_user_id', userId);
            return true;
          }
        }

        // 正常修正：更新 DB + 用新 diff 重推 Q2 + path_choice
        const diff = current - target;
        const condition = await pickWeightDiffConditionWithSettings(diff);
        const q2Tpl = await getTemplate(null, 2, condition);
        if (!q2Tpl) {
          console.error(
            '[ConversationPath] stage=2 weight retry: q2 template missing/inactive:',
            condition
          );
          // fallback：至少重推 path_choice（不升 diff 訊息）+ 更新 DB
        }

        await supabase
          .from('official_line_users')
          .update({
            current_weight: current,
            target_weight: target,
            last_user_reply_at: new Date().toISOString(),
          })
          .eq('line_user_id', userId);

        const messages = [textMessage('體重我更新一下 ——')];
        if (q2Tpl) {
          const q2Text = await renderTemplate(q2Tpl, {
            current_weight: current,
            target_weight: target,
          });
          messages.push(textMessage(q2Text));
          if (q2Tpl.chain_next_id) {
            const nextTpl = await getTemplate(null, 2, 'path_choice');
            if (nextTpl) {
              const nextText = await renderTemplate(nextTpl, {
                current_weight: current,
                target_weight: target,
              });
              messages.push(textMessage(nextText));
            }
          }
        } else {
          // q2 模板缺失 → 至少推 path_choice
          const pcTpl = await getTemplate(null, 2, 'path_choice');
          if (pcTpl) {
            const pcText = await renderTemplate(pcTpl, {
              current_weight: current,
              target_weight: target,
            });
            messages.push(pcText && textMessage(pcText));
          }
        }
        await replyMessage(event.replyToken, messages.filter(Boolean));
        return true;
      }

      // 2b. 其他自由文字（「就是想瘦」「我不知道」etc）→ 輕量引導
      await replyMessage(event.replyToken, [
        textMessage('先給我一個字母 A / B / C / D 就好 — 或直接講你最困擾的狀況是什麼，我看看。'),
      ]);
      await supabase
        .from('official_line_users')
        .update({ last_user_reply_at: new Date().toISOString() })
        .eq('line_user_id', userId);
      return true;
    }

    const pathVal = CHOICE_TO_PATH[choice] ?? 'other';
    const q3Tpl = await getTemplate(pathVal, 3, 'q3');
    if (!q3Tpl) {
      console.error('[ConversationPath] q3 template missing/inactive:', pathVal);
      return false;
    }

    // last_user_reply_at
    await supabase
      .from('official_line_users')
      .update({ last_user_reply_at: new Date().toISOString() })
      .eq('line_user_id', userId);

    // updatePathStage(3, {path}) 會同時寫 path + path_stage + retry_count_q3=0
    const r = await updatePathStage(userId, 3, { path: pathVal });
    if (!r.ok) {
      console.error('[ConversationPath] updatePathStage(3) failed:', r.error);
      return false;
    }

    const state2 = await getUserPathState(userId);
    const q3Text = await renderTemplate(q3Tpl, {
      current_weight: state2.current_weight,
      target_weight: state2.target_weight,
    });
    await replyMessage(event.replyToken, [textMessage(q3Text)]);
    return true;
  }

  // === 分支 3：Q3→Q4（stage === 3，Phase 3.2a 接 AI 子情境分類）===
  if (stage === 3) {
    return await handleStage3ToQ4(event, userId, text, state);
  }

  // Phase 3.3 bridging (2026-04-23 晚)：Q5 未 wire，stage=4 自由文字 → 進 handoff
  //
  // 問題：Q4 AI 回饋末尾問「想不想聽聽她們當時是怎麼從這裡走出來的？」
  //       用戶回「好」→ 原本 stage=4 return false 靜默 → 用戶被忽略 + 一休/婉馨沒收到通知
  //
  // 解法（Phase 4.2 Q5 wire 前臨時）：
  //   stage=4 自由文字 → triggerHandoff(reason='q4_followup_before_q5_wire')
  //   → 升 stage=5 + notify 一休+婉馨 + 回用戶「我有看到你的問題」
  //
  // 已排除情境（pre-check 接住，不會走到這裡）：
  //   - 禮貌結束（「謝謝」「了解」）→ handlePoliteEnd 已處理
  //   - 明確 handoff 關鍵字（「怎麼報名」「多少錢」）→ matchGlobalHandoff 已處理
  //   到這裡 = stage=4 且自由文字 = 高意願訊號
  //
  // TODO Phase 4.2：Q5 classifier wire 上線後拿掉這段（stage=4 走 Q5 classifier 分流）
  if (stage === 4) {
    const ok = await triggerHandoff(userId, 'q4_followup_before_q5_wire');
    if (ok) {
      await replyMessage(event.replyToken, [
        textMessage(
          '我有看到你的問題。我這邊先跟 fifi 助教說，她會看你剛剛跟我聊的內容，等等主動找你 —— 你先不用急著回什麼。'
        ),
      ]);
      return true;
    }
    return false;
  }

  // stage >= 5 → 靜默（handoff 已觸發，等人工處理）
  return false;
}

// ============================================================
// Phase 3.2a stage=3 → stage=4 AI 分類（Code Gate E1-E2 + Gemini + ai_tags 寫入）
// ============================================================

// AI 重入保護窗口：同一用戶 1h 內只打一次 Gemini
// 目的：Q4 模板 is_active=false 時，每則訊息 stage 停在 3，若不保護會每則都打 AI
const AI_REENTRY_WINDOW_MS = 60 * 60 * 1000;

function isInTestAllowlist(userId) {
  return TEST_ALLOWLIST.includes(userId);
}

async function handleStage3ToQ4(event, userId, text, state) {
  // === Code Gate E0（Phase 3.2b）：stage=3 收到「像 Q1 體重格式」訊息 → 用戶想重來 ===
  const maybeWeights = extractWeights(text);
  if (maybeWeights) {
    await supabase
      .from('official_line_users')
      .update({
        current_weight: null,
        target_weight: null,
        path: null,
        path_stage: 1,
        path_stage_updated_at: new Date().toISOString(),
        last_user_reply_at: new Date().toISOString(),
      })
      .eq('line_user_id', userId);

    await updateAiTags(userId, {
      q4_classified_at: null,
      q4_condition: null,
      q3_choice: null,
      q3_condition_selected: null,
      retry_count_q3: 0,
      _op: 'overwrite',
    });

    const retryTpl = await getTemplate(null, 1, 'retry_weight');
    const msg = retryTpl
      ? await renderTemplate(retryTpl, {})
      : '看起來你想重新講一次？好的，我重新聽 — 你目前體重幾公斤，想瘦到幾公斤？';

    const messages = [textMessage(msg)];
    if (TEST_MODE && isInTestAllowlist(userId)) {
      messages.push(
        textMessage('[debug] Code Gate E0 觸發：偵測到 Q1 體重格式，已重置 stage=1+清 path+清 q3/q4 flag。')
      );
    }
    await replyMessage(event.replyToken, messages);
    return true;
  }

  // === Phase 3.2c 重設計：Q3 改 1/2/3/4 選項，不走 E1/E2 字數／emoji 檢查 ===
  // （原 E1/E2 設計是防「自由打字太短」浪費 AI token；Q3 選項後這類檢查不適用）
  const { path } = state;

  // path=other 或未選 → Phase 3.2 後續 path_e 邏輯
  if (!['healthCheck', 'rebound', 'postpartum', 'eatOut'].includes(path)) {
    return false;
  }

  // === 解析 Q3 選項（1/2/3/4） ===
  const parsed = parseQ3Choice(text, path);
  if (!parsed) {
    // 用戶沒回純數字 → 重問 Q3
    const newCount = (state.ai_tags?.retry_count_q3 ?? 0) + 1;
    await updateAiTags(userId, {
      retry_count_q3: newCount,
      _op: 'overwrite',
    });

    const q3Tpl = await getTemplate(path, 3, 'q3');
    const q3Body = q3Tpl ? await renderTemplate(q3Tpl, {}) : '';
    const retryPrefix = '先幫我用數字回一下就好（例如 1 或 2），我才看得出該怎麼幫你。\n\n';
    const msg = q3Body ? retryPrefix + q3Body : retryPrefix;

    const messages = [textMessage(msg)];
    if (TEST_MODE && isInTestAllowlist(userId)) {
      messages.push(
        textMessage(
          `[debug] Q3 選項未命中（text="${text.slice(0, 30)}"，path=${path}）。retry_count_q3=${newCount}。`
        )
      );
    }
    await replyMessage(event.replyToken, messages);
    return true;
  }

  const { choice, cond, label } = parsed;

  // === 重入保護：1h 內已產過 Q4 DYNAMIC 回饋 ===
  const lastClassifiedAt = state.ai_tags?.q4_classified_at;
  if (lastClassifiedAt) {
    const age = Date.now() - new Date(lastClassifiedAt).getTime();
    if (age < AI_REENTRY_WINDOW_MS && age >= 0) {
      console.log('[Stage3ToQ4] skip AI (1h reentry window):', {
        userId,
        path,
        age_ms: age,
        last_condition: state.ai_tags?.q4_condition,
      });
      if (TEST_MODE && isInTestAllowlist(userId)) {
        await replyMessage(event.replyToken, [
          textMessage(
            `[debug] 跳過 AI（1h 內已產過 Q4 回饋，上次 condition=${state.ai_tags?.q4_condition || '?'}）。DYNAMIC 模板 inactive 時正式流程會靜默。`
          ),
        ]);
      }
      return false;
    }
  }

  // === 寫 Q3 選項結果 ===
  await updateAiTags(userId, {
    q3_choice: choice,
    q3_condition_selected: cond,
    _op: 'overwrite',
  });

  // === 取 Q4 通用 DYNAMIC 模板 ===
  const dynamicTpl = await getTemplate(null, 4, 'ai_final_feedback');

  // === AI call ===
  const result = await generateFinalFeedback({
    current: state.current_weight,
    target: state.target_weight,
    path,
    q3Label: label,
    metabolismType: state.metabolism_type || null,
  });

  if (!result.ok) {
    console.error('[Stage3ToQ4] generateFinalFeedback failed:', result.reason, { userId, path, label });
    if (TEST_MODE && isInTestAllowlist(userId)) {
      await replyMessage(event.replyToken, [
        textMessage(`[debug] generateFinalFeedback 失敗：${result.reason}`),
      ]);
    }
    return false;
  }

  const { output, fallback } = result;

  // 寫 ai_tags（Q3 選項後主要塞 intent，其他大多空陣列）
  if (output.ai_tags) {
    const r = await updateAiTags(userId, {
      ...output.ai_tags,
      _from_ai: true,
      _op: 'append',
    });
    if (!r.ok) console.error('[Stage3ToQ4] updateAiTags failed:', r.error);
  }

  // 寫 classify flag（防 1h 重打 AI）
  await updateAiTags(userId, {
    q4_classified_at: new Date().toISOString(),
    q4_condition: 'ai_final_feedback',
    _op: 'overwrite',
  });

  // fallback（confidence=low / feedback 過短） → 不推進
  if (fallback) {
    console.log('[Stage3ToQ4] Q4 fallback:', { userId, path, label });
    if (TEST_MODE && isInTestAllowlist(userId)) {
      await replyMessage(event.replyToken, [
        textMessage(
          `[debug] AI 低信心（confidence=${output.confidence}，len=${output.feedback_text?.length}），暫不推進 stage=4。feedback_text 預覽：\n${(output.feedback_text || '').slice(0, 100)}…`
        ),
      ]);
    }
    return false;
  }

  // 模板未啟用 → TEST_MODE 預覽 AI 產出，不推進
  if (!dynamicTpl) {
    console.log('[Stage3ToQ4] Q4 DYNAMIC inactive:', { userId, path, label });
    if (TEST_MODE && isInTestAllowlist(userId)) {
      const intent = output.ai_tags?.intent || '?';
      await replyMessage(event.replyToken, [
        textMessage(
          `[debug] AI 生成 Q4 個人化回饋成功：\npath=${path} / Q3 選項=${label} / intent=${intent} / confidence=${output.confidence} / len=${output.feedback_text.length}\n→ DYNAMIC 模板 path_all_q4_feedback is_active=false，正式流程會靜默。\nai_tags 已寫入 DB。`
        ),
        textMessage(`[debug preview] ${output.feedback_text}`),
      ]);
    }
    return false;
  }

  // === 推進 stage=4 + 寫 last_user_reply_at ===
  await supabase
    .from('official_line_users')
    .update({ last_user_reply_at: new Date().toISOString() })
    .eq('line_user_id', userId);

  const r = await updatePathStage(userId, 4);
  if (!r.ok) {
    console.error('[Stage3ToQ4] updatePathStage(4) failed:', r.error);
    return false;
  }

  // DYNAMIC 走 renderTemplate 的 feedback_text 分支
  const feedbackText = await renderTemplate(
    dynamicTpl,
    { current_weight: state.current_weight, target_weight: state.target_weight },
    { feedback_text: output.feedback_text }
  );
  await replyMessage(event.replyToken, [textMessage(feedbackText)]);
  return true;
}

// ============================================================
// Phase 3.2c：圖片訊息處理（stage=3 引導用戶回數字）
// ============================================================

async function handleImageMessage(event, userId, state) {
  // Phase 3.2c 重設計：Q3 是 1/2/3/4 選項，stage=3 任一條 path 收到圖片都引導回數字
  // state 由 caller 傳入（Q5 契約 v2.3 Ch.0.7 pre-check 讀一次）
  if (!state) return;
  if (state.path_stage !== 3) return;
  if (!['healthCheck', 'rebound', 'postpartum', 'eatOut'].includes(state.path)) return;

  await replyMessage(event.replyToken, [
    textMessage('先用數字回一下 Q3 就好（例如 1 或 2），我才看得出該怎麼幫你。'),
  ]);
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
    trapTeaser: '高轉速型肚子消不掉的真相',
    menuTeaser: '高轉速型怎麼吃讓肚子消下去',
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
    trapTeaser: '雲霄飛車型下午崩盤的真正原因',
    menuTeaser: '雲霄飛車型怎麼吃讓你下午不崩',
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
    trapTeaser: '燃盡型最傷代謝的那件事',
    menuTeaser: '燃盡型該怎麼吃才能把代謝養回來',
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
    trapTeaser: '省電模式型為什麼越吃少越胖',
    menuTeaser: '省電模式型該敢吃什麼',
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
    trapTeaser: '穩定型容易忽略的小陷阱',
    menuTeaser: '穩定型該怎麼吃精進到更好',
  },
};

// ============================================================
// 蛋白質策略回覆 — 診斷→aha moment→一步就好→搭配→互動
// ============================================================

function buildProteinStrategy(session, displayName) {
  const { food_type, protein_min, protein_max, age, height, weight } = session;
  const avgProtein = Math.round((protein_min + protein_max) / 2);
  const name = displayName ? displayName + '，' : '';

  // BMI + 分齡提醒（有資料才顯示）
  let bmiLine = '';
  if (height && weight) {
    const h = height / 100;
    const bmi = Math.round((weight / (h * h)) * 10) / 10;
    const bmiLabel = bmi < 18.5 ? '偏輕' : bmi < 24 ? '正常範圍' : bmi < 27 ? '微超標' : '偏高';
    bmiLine = `BMI ${bmi}（${bmiLabel}）\n`;
  }
  let ageLine = '';
  if (age && age >= 50) {
    ageLine = '\n⚡ 50 歲以後肌肉流失速度加快，你的建議量已經幫你調高了。吃夠蛋白質是守住代謝最重要的一步。\n';
  } else if (age && age >= 40) {
    ageLine = '\n⚡ 40 歲以後肌肉每年流失 1-2%，代謝跟著慢下來。你的建議量已經幫你往上調了，吃夠蛋白質比少吃重要。\n';
  }

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
    `你的目標：每天 ${protein_min}-${protein_max}g\n` +
    bmiLine +
    ageLine +
    `\n━━━━━━━━━━━━━━━\n\n` +
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
        omnivore: { food: '雞胸肉 150g + 板豆腐半塊 + 飯 + 青菜', protein: 40 },
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

  // ─── 訊息 1：診斷 + aha moment + 一步就好（方向 B：emoji 段首 + 精簡結尾）───

  let msg1 = `${name}你的代謝報告出來了\n\n`;

  // 🎯 你的狀況（用她自己的症狀做診斷；沒勾症狀用 tagline+description fallback）
  if (symptoms.length > 0) {
    msg1 +=
      `🎯 你的狀況\n` +
      `你提到了：\n` +
      symptoms.map((s) => `・${s}`).join('\n') + '\n' +
      `這些不是個別問題，它們都指向同一件事——\n` +
      `${type.symptomContext}\n\n`;
  } else {
    msg1 +=
      `🎯 你的狀況\n` +
      `「${type.tagline}」\n` +
      `${type.description}\n\n`;
  }

  // 體重波動加強診斷
  if (session.body_signal === 'fluctuating') {
    msg1 += `你的體重波動模式也在反映同一件事——不是你不夠努力，是身體正在用它的方式告訴你：現在的方法需要調整。\n\n`;
  }

  // 💭 為什麼之前沒用（aha moment）
  msg1 += `💭 為什麼之前沒用\n${type.ahaReason}\n\n`;

  // 💡 核心認知
  msg1 += `💡 核心認知\n${type.keyPoint}\n\n`;

  // 👉 先做這一件事
  msg1 += `👉 先做這一件事\n${type.oneStep}\n\n`;

  // 簽名（拿掉「這一步做穩了」+「有問題問我」兩句贅語）
  msg1 += `我是一休，陪你健康的瘦一輩子`;

  // ─── 訊息 2：完整建議 + 類型頁連結 ───
  const msg2 =
    `📋 等你準備好了，這 3 件事可以慢慢做：\n\n` +
    type.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n') +
    `\n\n想更了解「${type.name}」代謝的完整解析 👇\n` +
    type.typeUrl;

  // ─── 訊息 3：互動引導（精簡第三 bullet）───
  const msg3 =
    `看完報告，想繼續聊的話：\n\n` +
    `👉 回「地雷」— 我告訴你${type.trapTeaser}\n` +
    `👉 回「菜單」— 我告訴你${type.menuTeaser}\n` +
    `👉 或告訴我「現在幾公斤、想瘦到幾公斤」，我幫你看時間跟怎麼走`;

  return [textMessage(msg1), textMessage(msg2), textMessage(msg3)];
}

// ============================================================
// 脂肪肝報告
// ============================================================

const FATTY_LIVER_RISK = {
  low: {
    label: '低風險',
    diagnosis: '你的生活習慣對肝臟的負擔不大，肝臟目前還不算加班。',
    aha: '但你可能不知道——脂肪肝初期完全沒感覺。台灣每 2 個人就有 1 個有脂肪肝，很多體重正常的人也有。不是現在沒事就永遠沒事，而是你現在的好習慣正在保護它。',
    oneStep: '每年做一次腹部超音波。脂肪肝初期只有超音波看得到，體重計量不到。這是最簡單的保護。',
    tips: [
      '維持目前少糖的習慣——肝臟最怕的不是油，是多餘的糖',
      '注意腰圍變化——腰圍比體重更能反映內臟脂肪',
      '蛋白質吃夠，下午就不會一直想找飲料喝',
    ],
  },
  moderate: {
    label: '中等風險',
    diagnosis: '你的飲食裡有幾個地方，正在讓肝臟默默加班。',
    aha: '你可能覺得「我又沒喝酒」。但手搖飲裡的高果糖糖漿，走進身體之後的路跟酒精幾乎一樣——全部直接塞給肝臟處理，速度是一般糖的 5 到 10 倍。你不喝酒，但你的肝每天下午都在處理一杯「酒」。\n\n好消息是，這個階段調整效果最好。',
    oneStep: '先從下午那杯飲料下手——換成無糖茶或水就好。光這一步，你的肝就少扛一半的工作量。',
    tips: [
      '含糖飲料換成無糖茶、黑咖啡、氣泡水',
      '中午多夾一樣菜、選蛋白質取代炸物',
      '量一次腰圍（肚臍一圈），一個月後再量，看變化',
    ],
  },
  high: {
    label: '高風險',
    diagnosis: '你的多項習慣都在增加肝臟的負擔。不是嚇你，但你的肝需要你的注意了。',
    aha: '肝不會痛、不會腫、不會發燒。它就是默默扛，扛到有一天扛不住。等你感覺到的時候，通常不是脂肪肝了，是更嚴重的東西。\n\n但脂肪肝是可以改善的。不一定要瘦下來，改變吃進去的東西就有用。',
    oneStep: '最重要的一步：把每天的含糖飲料換掉。高果糖糖漿全部直接塞給肝臟處理，換掉它，肝臟的壓力馬上減半。',
    tips: [
      '把含糖飲料全部換成水或無糖飲品——這是最大的槓桿',
      '安排一次腹部超音波檢查——照了才知道',
      '蛋白質吃夠，身體不缺了就不會一直跟你討糖',
    ],
  },
};

// 飲料打臉
const DRINK_AHA = {
  'sugar-tea': '你平常喝手搖飲——裡面的高果糖糖漿，走進身體之後的路跟酒精幾乎一樣，全部直接塞給肝臟處理。你不喝酒，但你的肝每天下午都在處理一杯「酒」。',
  'juice': '你平常喝果汁——你以為很健康？果汁的果糖含量不輸手搖飲，而且沒有纖維幫忙減速，全部直接塞給肝臟處理。',
  'sugar-coffee': '你平常喝加糖咖啡——三合一和加糖拿鐵裡的糖，一天兩杯就超過肝臟的舒適負擔。',
  'water': null,
};

// 午餐打臉
const LUNCH_AHA = {
  'bento': '再加上你中午吃便當——裡面大部分是精緻澱粉，你的肝下午就在加班處理這些糖。',
  'noodle': '再加上你中午吃麵食——幾乎全是精緻碳水，蛋白質很少，肝臟一整個下午都在處理多出來的糖。',
  'homemade': null,
  'skip': '再加上你中午常跳過或隨便吃——身體拿不到需要的東西，反而更容易在下午、晚上爆吃，肝臟反而更累。',
};

function buildFattyLiverReport(session, displayName) {
  const risk = FATTY_LIVER_RISK[session.risk_level];
  if (!risk) return [textMessage('找不到你的檢測結果，請重新做一次檢測：\nhttps://abcmetabolic.com/tools/fatty-liver')];

  const name = displayName ? displayName + '，' : '';
  const answers = session.answers || [];
  const { drink_habit, lunch_habit } = session;

  // 從回答中找出最嚴重的習慣（score 最高的題目）
  const worstHabit = answers.reduce((worst, a) => (!worst || a.score > worst.score) ? a : worst, null);

  // ─── 訊息 1：診斷 → aha → 一步就好 ───
  let msg1 = '';

  // 診斷開頭：用她的回答
  if (worstHabit && worstHabit.score >= 2) {
    msg1 +=
      `${name}你的護肝報告出來了\n\n` +
      `你提到了「${worstHabit.answer}」\n` +
      `這件事跟你的肝臟狀態直接相關。\n\n`;
  } else {
    msg1 += `${name}你的護肝報告出來了\n\n`;
  }

  msg1 +=
    `檢測結果：${risk.label}\n` +
    `${risk.diagnosis}\n\n`;

  // 飲食習慣打臉（用第二階段的回答）
  const drinkAha = DRINK_AHA[drink_habit];
  const lunchAha = LUNCH_AHA[lunch_habit];

  if (drinkAha || lunchAha) {
    msg1 += `━━━━━━━━━━━━━━━\n\n`;
    if (drinkAha) msg1 += `${drinkAha}\n\n`;
    if (lunchAha) msg1 += `${lunchAha}\n\n`;
    if (drinkAha && lunchAha) {
      msg1 += `飲料 + 午餐，你的肝一天加班兩次。\n\n`;
    }
  } else {
    // 沒有飲食打臉就用原本的 aha
    msg1 +=
      `━━━━━━━━━━━━━━━\n\n` +
      `${risk.aha}\n\n`;
  }

  // 一步就好
  msg1 +=
    `━━━━━━━━━━━━━━━\n\n` +
    `不用一次改很多，先做一件事就好：\n\n` +
    `👉 ${risk.oneStep}\n\n` +
    `這一步做穩了，再來調整其他的。\n\n` +
    `有任何問題都可以直接問我 🙂\n` +
    `我是一休，陪你健康的瘦一輩子`;

  // ─── 訊息 2：完整建議 ───
  const msg2 =
    `📋 等你準備好了，這 3 件事可以慢慢做：\n\n` +
    risk.tips.map((t, i) => `${i + 1}. ${t}`).join('\n');

  // ─── 訊息 3：互動引導 ───
  const msg3 =
    `對了，想問你一下——\n\n` +
    `你現在是想瘦幾公斤？還是想維持現在的體重？\n\n` +
    `回覆告訴我，想瘦幾公斤就好 😊`;

  return [textMessage(msg1), textMessage(msg2), textMessage(msg3)];
}

// ============================================================
// TDEE 報告
// ============================================================

// 早餐蛋白質估算
const BREAKFAST_PROTEIN = {
  bread: { label: '麵包/蛋餅/三明治', protein: 8, gap: '碳水為主，蛋白質只有一點點' },
  skip: { label: '不吃早餐', protein: 0, gap: '整個早上身體都在空轉，代謝從一早就在降速' },
  cereal: { label: '牛奶/麥片/燕麥', protein: 10, gap: '感覺健康但蛋白質還是不夠' },
  balanced: { label: '有意識搭配', protein: 20, gap: null },
};

// 減肥方式的 aha
const DIET_METHOD_AHA = {
  'eat-less': '你選了「少吃」——這就是你的代謝越來越低的原因。身體偵測到熱量不夠，第一反應不是燒脂肪，是降代謝。你越少吃，它越省著用。',
  'exercise': '你選了「運動為主」——運動很好，但光靠運動消耗的卡路里其實遠比你想的少。跑步 30 分鐘大約消耗 250 卡，但一杯手搖飲就 500 卡。運動不是不做，但吃的東西不對，怎麼動都追不回來。',
  'both': '你選了「兩個都有但效果不持久」——因為少吃+運動的組合會讓身體以為你在逃難，它會同時降代謝+增加飢餓感。這不是你意志力差，是身體的生存本能在跟你打架。',
  'none': '你選了「沒特別做但體重一直上升」——這通常代表代謝正在慢慢下降。可能是蛋白質長期不夠、可能是精緻澱粉太多，身體一直在儲存模式。',
};

function buildTdeeReport(session, displayName) {
  const name = displayName ? displayName + '，' : '';
  const { bmr, tdee, protein_min, protein_max, activity_level, diet_method, breakfast_habit, afternoon_craving } = session;

  const deficit = tdee - 500;
  const bmrAfter3m = Math.round(bmr * 0.87);
  const proteinPerMeal = Math.round(protein_min / 3);
  const isSedentary = activity_level === 'sedentary' || activity_level === 'light';
  const breakfast = BREAKFAST_PROTEIN[breakfast_habit] || BREAKFAST_PROTEIN.bread;
  const dietAha = DIET_METHOD_AHA[diet_method] || DIET_METHOD_AHA['eat-less'];

  // ─── 訊息 1：診斷 → aha → 一步就好 ───
  let msg1 =
    `${name}你的飲食模式分析出來了\n\n` +
    `你的 TDEE 是 ${tdee} 卡，BMR 是 ${bmr} 卡。\n\n`;

  // 用她的減肥方式做診斷
  msg1 += `${dietAha}\n\n`;

  // 代謝適應數字
  msg1 +=
    `━━━━━━━━━━━━━━━\n\n` +
    `用數字看更清楚：\n` +
    `你吃 ${deficit} 卡，3 個月後 BMR 可能從 ${bmr} 降到 ${bmrAfter3m}。\n` +
    `到時候正常吃就會復胖。這不是你的問題，是方法的問題。\n\n`;

  // 早餐蛋白質打臉
  if (breakfast.gap) {
    msg1 +=
      `而且你的早餐「${breakfast.label}」，蛋白質大約只有 ${breakfast.protein}g。\n` +
      `你的目標是每餐 ${proteinPerMeal}g——差了 ${Math.max(0, proteinPerMeal - breakfast.protein)}g。\n` +
      `${breakfast.gap}。\n\n`;
  }

  // 下午想吃甜食的因果串聯
  if (afternoon_craving === 'must') {
    msg1 += `你說下午一定要來杯飲料？這不是嘴饞——你早餐和中午的蛋白質沒吃夠，血糖掉了，大腦在跟你要糖。\n\n`;
  } else if (afternoon_craving === 'sometimes') {
    msg1 += `你說下午有時候想吃——這可能跟中午吃的蛋白質不夠有關。蛋白質吃夠了，下午自然不會想找東西吃。\n\n`;
  }

  // 一步就好
  msg1 +=
    `━━━━━━━━━━━━━━━\n\n` +
    `不用算卡路里，先做一件事就好：\n\n` +
    `👉 每餐至少吃 ${proteinPerMeal} 克蛋白質。蛋白質吃夠了，代謝不會降、不容易餓、肌肉不流失。` +
    (isSedentary ? '\n\n你目前活動量偏低，蛋白質更重要——代謝有一半以上靠肌肉撐著，蛋白質不夠，肌肉流失，代謝只會越來越低。' : '') +
    `\n\n` +
    `這一步做穩了，再來調整其他的。\n\n` +
    `有任何問題都可以直接問我 🙂\n` +
    `我是一休，陪你健康的瘦一輩子`;

  // ─── 訊息 2：完整建議 ───
  const msg2 =
    `📋 不用算卡路里，照這個比例吃就好：\n\n` +
    `1. 每餐蛋白質 ${proteinPerMeal}g 以上（一個手掌大的肉/魚/蛋）\n` +
    `2. 蔬菜佔餐盤一半（纖維撐飽足感，不用靠意志力）\n` +
    `3. 碳水吃原型的（白飯→糙米或地瓜，不用不吃，換一種就好）\n\n` +
    `每天蛋白質目標：${protein_min}-${protein_max} 克`;

  // ─── 訊息 3：互動引導 ───
  const msg3 =
    `對了，想問你一下——\n\n` +
    `你現在是想瘦幾公斤？還是想維持現在的體重？\n\n` +
    `回覆告訴我，想瘦幾公斤就好 😊`;

  return [textMessage(msg1), textMessage(msg2), textMessage(msg3)];
}

// ============================================================
// 血糖穩定度報告
// ============================================================

const BLOOD_SUGAR_DRINK_AHA = {
  'sugar-tea': '你平常喝手搖飲——一杯下去，你的血糖在 30 分鐘內飆到最高點，然後胰島素把它壓下來，血糖掉得比飆上去還快。你下午想睡、想吃甜，就是這杯飲料造成的。',
  'juice': '你平常喝果汁——你以為很健康？果汁沒有纖維減速，果糖直接衝進身體，血糖波動跟喝手搖飲差不多。',
  'sugar-coffee': '你平常喝加糖咖啡——你以為在提神，但糖讓血糖先飆後掉，兩小時後比喝之前更累。',
  'water': null,
};

const BLOOD_SUGAR_LUNCH_AHA = {
  'bento': '再加上你中午吃便當——白飯佔了大半，蛋白質不夠，血糖吃完就飆。到了下午，血糖掉到谷底，你的大腦就開始跟你要糖。',
  'noodle': '再加上你中午吃麵食——幾乎全是碳水，血糖吃完直接衝上去，掉下來的時候你就想睡、想吃甜。',
  'homemade': null,
  'skip': '再加上你中午常跳過——血糖先掉到谷底，下午一吃東西就報復性飆高，波動比正常吃三餐還大。',
};

const BLOOD_SUGAR_RISK_DATA = {
  low: {
    label: '穩定',
    diagnosis: '你的血糖目前看起來還算穩定，日常症狀不多。',
    aha: '但你可能不知道——血糖不穩的早期完全沒感覺。空腹血糖可以正常好幾年，但你的胰島素可能早就在超時工作了。知道怎麼保持，比不知不覺滑下去重要。',
    oneStep: '每餐吃東西的順序改成：先吃菜和肉，最後吃飯。同樣的食物，換個順序，血糖波動就能減少三成。這是最簡單的保護。',
    tips: [
      '吃飯順序：菜 → 肉 → 飯，穩住餐後血糖',
      '少喝含糖飲料——每一杯都是一次血糖雲霄飛車',
      '每年健檢加驗「空腹胰島素」，不只看空腹血糖',
    ],
  },
  moderate: {
    label: '有波動',
    diagnosis: '你的血糖已經開始不穩了——你的身體正在用這些症狀跟你說。',
    aha: '你可能以為吃飽想睡是正常的、下午想喝飲料是嘴饞。但這些都是血糖在控制你的訊號。\n\n好消息是：血糖波動是可逆的。不用吃藥，調整吃法就有用。',
    oneStep: '先從吃飯順序開始：先吃菜和肉，最後吃飯。同樣的東西，換個順序，血糖波動能減少三成。做到這一步，你會發現吃飽不再想睡了。',
    tips: [
      '吃飯順序：菜 → 肉 → 飯（最重要的一步）',
      '下午想喝飲料時，先吃一把堅果或一顆水煮蛋',
      '把精緻澱粉（白飯、麵）換成原型澱粉（糙米、地瓜）',
    ],
  },
  high: {
    label: '明顯不穩',
    diagnosis: '你的多個症狀都指向血糖波動——你的身體已經在發出明顯的警訊了。',
    aha: '吃飽想睡、下午要喝飲料、肚子大、怎麼少吃都瘦不下來——這些不是個別問題，它們的共同根源是血糖不穩導致的高胰島素。\n\n高胰島素會鎖住脂肪，不讓身體燃燒。不是你不夠努力，是身體被鎖住了。但這是可逆的。',
    oneStep: '最重要的一步：改變吃飯順序，先吃菜和肉，最後吃飯。然後把含糖飲料換掉。這兩步做到，血糖波動能減少一半以上。',
    tips: [
      '吃飯順序：菜 → 肉 → 飯（血糖波動減少三成）',
      '含糖飲料全部換掉——每一杯都讓血糖坐一次雲霄飛車',
      '建議跟醫師要求檢查「空腹胰島素」，不只看空腹血糖',
    ],
  },
  'very-high': {
    label: '需要注意',
    diagnosis: '你的身體正在發出很多警訊——這些症狀加在一起，代表你的血糖波動已經很大了。',
    aha: '你的多個症狀都指向同一件事：身體需要分泌越來越多胰島素才能壓住血糖。長期下來，細胞對胰島素越來越不敏感——這就是胰島素阻抗。\n\n但胰島素阻抗是可逆的。飲食調整是最有效的方式，不一定需要吃藥。',
    oneStep: '最重要的一步：去做一次健檢，要求加驗「空腹胰島素」（不只是空腹血糖）。很多醫師不會主動檢查，你可以主動提出。同時開始調整吃飯順序：先吃菜和肉，最後吃飯。',
    tips: [
      '去醫院要求檢查「空腹胰島素」——這是早期發現的關鍵',
      '吃飯順序：菜 → 肉 → 飯，立刻降低餐後血糖飆高',
      '含糖飲料換掉 + 精緻澱粉減量，讓胰島素有機會休息',
    ],
  },
};

function buildBloodSugarReport(session, displayName) {
  const risk = BLOOD_SUGAR_RISK_DATA[session.risk_level];
  if (!risk) return [textMessage('找不到你的檢測結果，請重新做一次檢測：\nhttps://abcmetabolic.com/tools/blood-sugar')];

  const name = displayName ? displayName + '，' : '';
  const symptoms = session.symptoms || [];
  const { drink_habit, lunch_habit } = session;

  // 找出最有打臉力的症狀
  const keySymptoms = [];
  if (symptoms.includes('吃飽之後很容易想睡覺')) keySymptoms.push('吃飽就想睡');
  if (symptoms.includes('下午特別容易想喝手搖飲或吃甜食')) keySymptoms.push('下午想喝飲料');
  if (symptoms.includes('怎麼少吃都瘦不下來')) keySymptoms.push('怎麼少吃都瘦不下來');
  if (symptoms.includes('肚子（腰部）的肉特別多，四肢相對瘦')) keySymptoms.push('肚子特別大');

  // ─── 訊息 1：診斷 → aha → 一步就好 ───
  let msg1 = `${name}你的血糖穩定報告出來了\n\n`;

  // 用她的症狀做開頭
  if (keySymptoms.length > 0) {
    msg1 += `你提到了${keySymptoms.map(s => `「${s}」`).join('、')}——\n`;
    msg1 += `這些不是個別問題，它們都指向同一件事：你的血糖在餐後飆太高了。\n\n`;
  }

  msg1 += `檢測結果：${risk.label}\n${risk.diagnosis}\n\n`;

  // 飲食習慣打臉
  const drinkAha = BLOOD_SUGAR_DRINK_AHA[drink_habit];
  const lunchAha = BLOOD_SUGAR_LUNCH_AHA[lunch_habit];

  if (drinkAha || lunchAha) {
    msg1 += `━━━━━━━━━━━━━━━\n\n`;
    if (drinkAha) msg1 += `${drinkAha}\n\n`;
    if (lunchAha) msg1 += `${lunchAha}\n\n`;
    if (drinkAha && lunchAha) {
      msg1 += `午餐讓血糖飆上去，飲料再飆一次——你的血糖一天坐兩次雲霄飛車。\n\n`;
    }
  } else {
    msg1 += `━━━━━━━━━━━━━━━\n\n${risk.aha}\n\n`;
  }

  // 一步就好
  msg1 +=
    `━━━━━━━━━━━━━━━\n\n` +
    `不用一次改很多，先做一件事就好：\n\n` +
    `👉 ${risk.oneStep}\n\n` +
    `這一步做穩了，再來調整其他的。\n\n` +
    `有任何問題都可以直接問我 🙂\n` +
    `我是一休，陪你健康的瘦一輩子`;

  // ─── 訊息 2：完整建議 ───
  const msg2 =
    `📋 等你準備好了，這 3 件事可以慢慢做：\n\n` +
    risk.tips.map((t, i) => `${i + 1}. ${t}`).join('\n');

  // ─── 訊息 3：互動引導 ───
  const msg3 =
    `對了，想問你一下——\n\n` +
    `你現在是想瘦幾公斤？還是想維持現在的體重？\n\n` +
    `回覆告訴我，想瘦幾公斤就好 😊`;

  return [textMessage(msg1), textMessage(msg2), textMessage(msg3)];
}

// ============================================================
// 糖攝取報告
// ============================================================

const SWEETNESS_GRAMS = {
  full: { label: '全糖', grams: 50 },
  less: { label: '少糖', grams: 38 },
  half: { label: '半糖', grams: 25 },
  slight: { label: '微糖', grams: 13 },
  none: { label: '無糖', grams: 0 },
};

const CUPS_NUM = { '0': 0, '1': 1, '2': 2, '3': 3 };

function buildSugarReport(session, displayName) {
  const name = displayName ? displayName + '，' : '';
  const { sugar_limit_10, sugar_limit_5, cups_per_day, sweetness_level, drink_time, topping } = session;

  const sweet = SWEETNESS_GRAMS[sweetness_level] || SWEETNESS_GRAMS.half;
  const cups = CUPS_NUM[cups_per_day] || 1;
  const dailySugar = cups * sweet.grams;
  const overRate = sugar_limit_10 > 0 ? Math.round((dailySugar / sugar_limit_10) * 100) : 0;

  // 配料卡路里
  const TOPPING_DATA = {
    boba: { label: '波霸', cal: 156, green: '蒟蒻', greenCal: 71 },
    cream: { label: '奶蓋', cal: 203, green: '仙草', greenCal: 57 },
    pudding: { label: '布丁/芋圓', cal: 119, green: '愛玉', greenCal: 45 },
    jelly: { label: '仙草/愛玉', cal: 57, green: '仙草/愛玉', greenCal: 57 },
    none: { label: '不加', cal: 0, green: '不加', greenCal: 0 },
  };
  const BASE_CAL = { full: 575, less: 475, half: 375, slight: 275, none: 0 };
  const tp = TOPPING_DATA[topping] || TOPPING_DATA.none;
  const baseCal = BASE_CAL[sweetness_level] || 0;
  const currentPerCup = baseCal + tp.cal;
  const greenPerCup = tp.greenCal; // 無糖茶 0 + 綠燈配料
  const currentDaily = currentPerCup * cups;
  const greenDaily = greenPerCup * cups;
  const savedDaily = currentDaily - greenDaily;
  const savedMonthKg = Math.round((savedDaily * 30 / 7700) * 10) / 10;

  // ─── 訊息 1：診斷 → aha → 一步就好 ───
  let msg1 = `${name}你的糖攝取報告出來了\n\n`;

  if (dailySugar > 0) {
    msg1 +=
      `你每天喝 ${cups} 杯${sweet.label}飲料\n` +
      `= 每天 ${dailySugar}g 糖\n\n` +
      `你的每日上限是 ${sugar_limit_10}g——`;

    if (overRate > 100) {
      msg1 += `你光喝飲料就超標了，是上限的 ${overRate}%。\n\n`;
    } else {
      msg1 += `光飲料就用掉 ${overRate}% 的額度，剩下的要給一整天的食物。\n\n`;
    }
  } else {
    msg1 +=
      `你已經喝無糖了，飲料這塊不用擔心。\n` +
      `但注意食物裡的隱藏糖——醬料、麵包、水果乾裡都有。\n\n`;
  }

  msg1 += `━━━━━━━━━━━━━━━\n\n`;

  if (dailySugar > 0) {
    if (sweetness_level === 'full') {
      msg1 +=
        `你現在喝全糖——一杯就 50g，你的上限才 ${sugar_limit_10}g。\n\n` +
        `但你不需要一次戒到無糖。很多學員的經驗是：先從全糖改少糖，兩週後你會覺得全糖太甜了。\n` +
        `不是意志力，是味覺跟著身體一起改變了。\n\n`;
    } else if (sweetness_level === 'half' || sweetness_level === 'less') {
      msg1 +=
        `你覺得${sweet.label}已經很節制了？${sweet.label}一杯還有 ${sweet.grams}g 糖。\n` +
        `你一天 ${cups} 杯 = ${dailySugar}g，上限是 ${sugar_limit_10}g。\n\n` +
        `而且這只是飲料。你早餐的麵包、午餐的醬料裡都有隱藏糖。加起來，你每天吃的糖可能是上限的 2-3 倍。\n\n`;
    } else {
      msg1 +=
        `你點${sweet.label}，糖量不算多。但配料的差距更大——\n` +
        `奶蓋 203 卡、波霸 156 卡，換成仙草 57 卡、愛玉 45 卡，一杯差 100 卡以上。\n\n`;
    }
  } else {
    msg1 +=
      `你的飲料控制得不錯。但糖最容易藏在你不注意的地方：\n` +
      `果汁、優酪乳、能量棒、沙拉醬、番茄醬——這些看起來健康的東西裡面都有糖。\n\n`;
  }

  // 配料 + 時段個人化
  if (tp.cal > 70) {
    msg1 += `你加的「${tp.label}」一份就 ${tp.cal} 卡。換成「${tp.green}」只有 ${tp.greenCal} 卡——同樣有口感，差了 ${tp.cal - tp.greenCal} 卡。\n\n`;
  }

  if (drink_time === 'afternoon') {
    msg1 += `你下午喝那杯——可能不只是習慣。如果你中午吃的蛋白質不夠，血糖會在下午掉下來，大腦就跟你要糖。不是嘴饞，是血糖在控制你。\n\n`;
  }

  // 卡路里對比（最有衝擊力的部分）
  if (savedDaily > 0) {
    msg1 +=
      `用數字看更清楚：\n` +
      `你現在：每天 ${cups} 杯 = ${currentDaily} 卡\n` +
      `換個點法：每天 ${cups} 杯 = ${greenDaily} 卡\n` +
      `每天省 ${savedDaily} 卡，一個月 ≈ ${savedMonthKg} 公斤\n\n` +
      `你沒有少喝，只是換了一個點法。\n\n`;
  }

  msg1 +=
    `━━━━━━━━━━━━━━━\n\n` +
    `不用一次改很多，先做一件事就好：\n\n`;

  if (sweetness_level === 'full') {
    msg1 += `👉 下一杯點少糖就好。一杯省 100 卡，一天 ${cups} 杯就省 ${cups * 100} 卡。兩週後你會自然覺得全糖太甜——不是靠意志力，是味覺跟著身體一起改變了。`;
  } else if (tp.cal > 70) {
    msg1 += `👉 配料從「${tp.label}」換成「${tp.green}」就好。口感差不多，一杯省 ${tp.cal - tp.greenCal} 卡。不是不能喝紅燈的，只是不用每杯都加。`;
  } else if (sweetness_level === 'less' || sweetness_level === 'half') {
    msg1 += `👉 試試微糖或無糖。一杯再省 ${sweet.grams > 13 ? sweet.grams - 13 : sweet.grams}g 糖。喝幾天你就會習慣，味覺會跟著調整。`;
  } else {
    msg1 += `👉 你的飲料已經控制得不錯了。下一步注意食物裡的隱藏糖——醬料、麵包、水果乾裡都有，看包裝上的含糖量你會嚇到。`;
  }

  msg1 +=
    `\n\n這一步做穩了，再來調整其他的。\n\n` +
    `有任何問題都可以直接問我 🙂\n` +
    `我是一休，陪你健康的瘦一輩子`;

  // ─── 訊息 2：配料紅綠燈 ───
  const msg2 =
    `📋 手搖飲配料紅綠燈（存起來）：\n\n` +
    `🔴 紅燈（偶爾喝）：\n` +
    `奶蓋 203 卡 / 波霸 156 卡 / 冰淇淋 160 卡 / 多多 144 卡\n\n` +
    `🟡 黃燈（注意頻率）：\n` +
    `粉條 131 卡 / 芋圓 128 卡 / 布丁 110 卡\n\n` +
    `🟢 綠燈（放心加）：\n` +
    `椰果 76 卡 / 蒟蒻 71 卡 / 仙草 57 卡 / 愛玉 45 卡 / 寒天 42 卡\n\n` +
    `基底：無糖茶 0 卡 → 半糖 100 卡 → 全糖 200 卡`;

  // ─── 訊息 3：互動引導 ───
  const msg3 =
    `對了，想問你一下——\n\n` +
    `你現在是想瘦幾公斤？還是想維持現在的體重？\n\n` +
    `回覆告訴我，想瘦幾公斤就好 😊`;

  return [textMessage(msg1), textMessage(msg2), textMessage(msg3)];
}
