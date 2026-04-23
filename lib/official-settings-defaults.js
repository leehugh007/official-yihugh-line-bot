// 契約 v2.4 Ch.8：settings 常數（DB fallback）
// 型別 = JS native（不是字串）。DB 值格式見契約 Ch.8.1。

export default {
  weight_diff_small_max: 5,
  weight_diff_large_min: 15,
  fallback_threshold: 2,
  stage_timeout_days: 7,
  reawaken_days: 14,
  ai_tags_expire_days: 14,
  handoff_notify_to: ['yixiu', 'wanxin'],
  handoff_rescue_notify_to: ['yixiu'],
  handoff_rescue_hours: 48,
  meal_min_chars: 20,
  postpartum_min_chars: 5,
  multi_condition_max: 2,
  min_msg_chars_for_ai: 3,
  ai_call_timeout_ms: 10000,
  handoff_keywords_price: ['價格', '費用', '多少錢', '開課', '下一期', '學費', '方案'],
  handoff_keywords_family: ['老公', '先生', '家人', '老婆', '一起', '女友', '男友', '媽媽'],
  handoff_keywords_enroll: ['報名', '我要試', '直接買', '我加入'],
  ai_polite_end_keywords: ['太貴', '沒預算', '沒錢', '先不用'],
  webhook_template_cache_ttl_sec: 60,
  gemini_model_version: 'gemini-2.5-flash-lite',
  contract_version: 'v2.4',
  test_mode: true,
  // Q5 轉換漏斗（Phase 4.1 新增）
  q5_intent_min_text_chars: 2,
  q5_active_followup_hours: 24,
  q5_visit_followup_hours: 24,
  q5_visit_followup_max_count: 1,
  q5_timeout_reset_hours: 48,
  plan_12weeks_price: 11400,
  plan_4weeks_price: 4980,
  apply_refund_policy_text: '待定',
  q5_test_mode_cron: true,
  q5_soft_invite_passive_text:
    '剛剛那些問題我都有完整的解法。要看我帶學員時整理的做法嗎？',
  q5_soft_invite_active_text:
    '之前跟你聊到的那些卡關，我有一套帶學員時在用的做法。要看嗎？',
  q5_non_text_soft_handoff_text:
    '我有看到你的問題。這個我請 fifi 直接跟你聊，她看過你剛剛跟我聊的內容，會知道你在哪個階段，等等會主動找你。\n\n先不急著決定要不要進課程，把問題問清楚再說。',
  phase_4_2_launch_date: '',
  apply_url_base: 'https://official-yihugh-line-bot.vercel.app/apply',
};
