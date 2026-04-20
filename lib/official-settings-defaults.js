// 契約 v6 第 8.3 章：22 個 settings 的 JS 常數（DB fallback）
// 型別 = JS native（不是字串）。DB 值格式見第 8.1 章。

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
  handoff_keywords_price: ['價格', '費用', '多少錢', '怎麼報名', '開課', '下一期', '報名', '學費', '方案'],
  handoff_keywords_family: ['老公', '先生', '家人', '老婆', '一起', '女友', '男友', '媽媽'],
  handoff_keywords_enroll: ['我要報', '我要試', '直接買', '我加入', '報名我'],
  ai_polite_end_keywords: ['太貴', '沒預算', '沒錢', '先不用'],
  webhook_template_cache_ttl_sec: 60,
  gemini_model_version: 'gemini-2.5-flash-lite',
  contract_version: 'v6',
  test_mode: true,
};
