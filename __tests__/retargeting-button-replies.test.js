import { describe, expect, it } from 'vitest';
import {
  RETARGETING_ACTIVITY_LIBRARY_KEY,
  RETARGETING_PRIMARY_CONFIG_KEY,
  findRetargetingButtonReply,
  parseRetargetingSettings,
} from '../lib/retargeting-button-replies.js';

const messageButton = (messageText, replyText, label = messageText) => ({
  label,
  actionType: 'message',
  messageText,
  replyText,
});

describe('retargeting button replies', () => {
  it('優先使用該會員最近收到的再行銷發送紀錄', () => {
    const reply = findRetargetingButtonReply('我想問問題', {
      userLogs: [{
        buttons: [messageButton('我想問問題', '這是該會員實際收到的活動回覆')],
      }],
      activities: [{
        enabled: true,
        stageTemplates: [{
          buttons: [messageButton('我想問問題', '這是活動庫預設回覆')],
        }],
      }],
    });

    expect(reply).toBe('這是該會員實際收到的活動回覆');
  });

  it('支援多活動 activity library，依 priority 尋找文字回覆按鈕', () => {
    const { activities, primaryConfig } = parseRetargetingSettings([
      {
        key: RETARGETING_ACTIVITY_LIBRARY_KEY,
        value: JSON.stringify([
          {
            activityId: 'activity_b',
            enabled: true,
            priority: 2,
            stageTemplates: [{
              buttons: [messageButton('想了解更多', 'B 活動回覆')],
            }],
          },
          {
            activityId: 'activity_a',
            enabled: true,
            priority: 1,
            stageTemplates: [{
              buttons: [messageButton('想了解更多', 'A 活動回覆')],
            }],
          },
        ]),
      },
    ]);

    expect(primaryConfig).toBeNull();
    expect(findRetargetingButtonReply('想了解更多', { activities })).toBe('A 活動回覆');
  });

  it('會掃 cycleFlows 的第 2/3 階段模板，不只掃舊 stageTemplates', () => {
    const reply = findRetargetingButtonReply('我還有疑問', {
      activities: [{
        enabled: true,
        cycleFlows: [{
          cycle: 2,
          enabled: true,
          stages: [
            { stage: 1, enabled: true, buttons: [] },
            { stage: 2, enabled: true, buttons: [messageButton('我還有疑問', '第二輪第二階段回覆')] },
          ],
        }],
      }],
    });

    expect(reply).toBe('第二輪第二階段回覆');
  });

  it('支援後台立即與排程推播留下的一般 push log', () => {
    const reply = findRetargetingButtonReply('請助教回覆我', {
      generalLogs: [{
        template_id: 'custom_123',
        buttons: [messageButton('請助教回覆我', 'fifi 助教看到會回覆你')],
      }],
    });

    expect(reply).toBe('fifi 助教看到會回覆你');
  });

  it('保留舊 primary config fallback，避免舊設定失效', () => {
    const { activities, primaryConfig } = parseRetargetingSettings([
      {
        key: RETARGETING_PRIMARY_CONFIG_KEY,
        value: JSON.stringify({
          stageTemplates: [{
            buttons: [messageButton('我想問最後一個問題', '舊 primary 回覆')],
          }],
        }),
      },
    ]);

    expect(activities).toEqual([]);
    expect(findRetargetingButtonReply('我想問最後一個問題', { primaryConfig })).toBe('舊 primary 回覆');
  });

  it('忽略網址按鈕與缺少 Bot 回覆文字的 message 按鈕', () => {
    const reply = findRetargetingButtonReply('閱讀文章', {
      activities: [{
        enabled: true,
        stageTemplates: [{
          buttons: [
            { label: '閱讀文章', actionType: 'url', url: 'https://example.com' },
            { label: '閱讀文章', actionType: 'message', messageText: '閱讀文章', replyText: '' },
          ],
        }],
      }],
    });

    expect(reply).toBeNull();
  });
});
