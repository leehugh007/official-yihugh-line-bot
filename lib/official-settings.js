// 契約 v6 第 8.2 章：getSettingTyped + SETTING_SCHEMA
// DB 查不到 → fallback 到 official-settings-defaults.js

import supabase from './supabase.js';
import DEFAULTS from './official-settings-defaults.js';

const SETTING_SCHEMA = {
  weight_diff_small_max: 'int',
  weight_diff_large_min: 'int',
  fallback_threshold: 'int',
  stage_timeout_days: 'int',
  reawaken_days: 'int',
  ai_tags_expire_days: 'int',
  handoff_notify_to: 'json',
  handoff_rescue_notify_to: 'json',
  handoff_rescue_hours: 'int',
  meal_min_chars: 'int',
  postpartum_min_chars: 'int',
  multi_condition_max: 'int',
  min_msg_chars_for_ai: 'int',
  ai_call_timeout_ms: 'int',
  handoff_keywords_price: 'csv',
  handoff_keywords_family: 'csv',
  handoff_keywords_enroll: 'csv',
  ai_polite_end_keywords: 'csv',
  webhook_template_cache_ttl_sec: 'int',
  gemini_model_version: 'string',
  contract_version: 'string',
  test_mode: 'bool',
  // Q5 轉換漏斗（契約 v2.4 Ch.8）
  q5_intent_min_text_chars: 'int',
  q5_active_followup_hours: 'int',
  q5_visit_followup_hours: 'int',
  q5_visit_followup_max_count: 'int',
  q5_timeout_reset_hours: 'int',
  plan_12weeks_price: 'int',
  plan_4weeks_price: 'int',
  apply_refund_policy_text: 'string',
  q5_test_mode_cron: 'bool',
  q5_restricted_to_test_users: 'bool',
  q5_soft_invite_passive_text: 'string',
  q5_soft_invite_active_text: 'string',
  q5_non_text_soft_handoff_text: 'string',
  q5_visit_followup_text: 'string',
  phase_4_2_launch_date: 'string',
  apply_url_base: 'string',
};

async function getSettingRaw(key) {
  const { data } = await supabase
    .from('official_settings')
    .select('value')
    .eq('key', key)
    .single();
  return data?.value ?? null;
}

async function getSettingTyped(key) {
  const raw = await getSettingRaw(key);
  const type = SETTING_SCHEMA[key];
  const defaultVal = DEFAULTS[key];
  if (raw == null) return defaultVal;
  switch (type) {
    case 'int':
      return parseInt(raw, 10);
    case 'bool':
      return raw === 'true';
    case 'json':
      return JSON.parse(raw);
    case 'csv':
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    case 'string':
    default:
      return String(raw);
  }
}

export { getSettingTyped, SETTING_SCHEMA };
