// V3.2 三段價定價狀態 helper（migration_019 起）
//
// 業務時間軸：
//   NOW < super_cutoff_at                → super ($10,400)
//   super_cutoff_at <= NOW < regular_cutoff_at → regular ($11,400)
//   NOW >= regular_cutoff_at             → anchor ($12,600 真實成交)
//
// 從 official_settings 讀 6 個 key：
//   super_early_bird_cutoff_at  — 超早鳥截止
//   regular_early_bird_cutoff_at — 一般早鳥截止
//   price_12weeks_super         — 超早鳥價 (10400)
//   price_12weeks_regular       — 一般早鳥價 (11400)
//   price_12weeks_anchor        — 原價 (12600，5/24 後真實成交)
//   price_4weeks_trial          — 4 週體驗版 (4980)
//
// 用途：visit / submit / admin 三處共用

import supabase from './supabase.js';

const PRICING_KEYS = [
  'super_early_bird_cutoff_at',
  'regular_early_bird_cutoff_at',
  'price_12weeks_super',
  'price_12weeks_regular',
  'price_12weeks_anchor',
  'price_4weeks_trial',
  'program_batch_name',
  'program_start_date',
  'q5_msg3_template',
  'q5_msg4_template',
];

/**
 * 讀當前定價狀態（三段邏輯）
 * @returns {Promise<{
 *   tier: 'super'|'regular'|'anchor',
 *   super_early_active: boolean,
 *   regular_early_active: boolean,
 *   super_cutoff_at: string|null,
 *   regular_cutoff_at: string|null,
 *   active_cutoff_at: string|null,  // 當前 phase 的截止時間（給 Countdown 用）
 *   now: string,
 *   prices: { super: number, regular: number, anchor: number, trial: number }
 * }>}
 */
export async function getPricingState() {
  const { data: settings, error } = await supabase
    .from('official_settings')
    .select('key, value')
    .in('key', PRICING_KEYS);

  if (error) {
    console.error('[pricing] settings read error:', error);
  }

  const map = Object.fromEntries((settings || []).map((s) => [s.key, s.value]));
  const super_cutoff_at = map.super_early_bird_cutoff_at || null;
  const regular_cutoff_at = map.regular_early_bird_cutoff_at || null;
  const now = new Date();

  const superDate = super_cutoff_at ? new Date(super_cutoff_at) : null;
  const regularDate = regular_cutoff_at ? new Date(regular_cutoff_at) : null;
  const superValid = superDate && !isNaN(superDate.getTime());
  const regularValid = regularDate && !isNaN(regularDate.getTime());

  const super_early_active = !!(superValid && now < superDate);
  // regular_early_active 條件：超早鳥已過 + 一般早鳥還沒過
  const regular_early_active = !!(
    !super_early_active && regularValid && now < regularDate
  );

  let tier;
  let active_cutoff_at;
  if (super_early_active) {
    tier = 'super';
    active_cutoff_at = super_cutoff_at;
  } else if (regular_early_active) {
    tier = 'regular';
    active_cutoff_at = regular_cutoff_at;
  } else {
    tier = 'anchor';
    active_cutoff_at = null; // anchor 階段沒有截止（持續成交原價）
  }

  return {
    tier,
    super_early_active,
    regular_early_active,
    super_cutoff_at,
    regular_cutoff_at,
    active_cutoff_at,
    now: now.toISOString(),
    prices: {
      super: parseInt(map.price_12weeks_super, 10) || 10400,
      regular: parseInt(map.price_12weeks_regular, 10) || 11400,
      anchor: parseInt(map.price_12weeks_anchor, 10) || 12600,
      trial: parseInt(map.price_4weeks_trial, 10) || 4980,
    },
    batch: {
      name: map.program_batch_name || '下一期班',
      start_date: map.program_start_date || '',
    },
    q5_templates: {
      msg3: map.q5_msg3_template || '',
      msg4: map.q5_msg4_template || '',
    },
  };
}

/**
 * 算指定方案的成交價（給 submit endpoint 用）
 * @param {string} program_choice — '12weeks' | '4weeks_trial'
 * @param {object} pricingState — getPricingState() 的回傳
 * @returns {{ final_price: number, tier: string, super_early_bird_applied: boolean }}
 *
 * tier 對應價格：super=10400, regular=11400, anchor=12600, trial=4980
 * super_early_bird_applied 保留 backward compat（migration_018），只 tier='super' 才 true
 */
export function calcFinalPrice(program_choice, pricingState) {
  if (program_choice === '4weeks_trial') {
    return {
      final_price: pricingState.prices.trial,
      tier: 'trial',
      super_early_bird_applied: false,
    };
  }
  // 12weeks 三段
  if (pricingState.tier === 'super') {
    return {
      final_price: pricingState.prices.super,
      tier: 'super',
      super_early_bird_applied: true,
    };
  }
  if (pricingState.tier === 'regular') {
    return {
      final_price: pricingState.prices.regular,
      tier: 'regular',
      super_early_bird_applied: false,
    };
  }
  // anchor
  return {
    final_price: pricingState.prices.anchor,
    tier: 'anchor',
    super_early_bird_applied: false,
  };
}
