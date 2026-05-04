// V3.2 超早鳥定價狀態 helper
//
// 從 official_settings 讀 5 個 key：
//   super_early_bird_cutoff_at — 唯一 gate（NOW() < cutoff_at = 享超早鳥）
//   price_12weeks_super        — 超早鳥價（10400）
//   price_12weeks_regular      — 常規早鳥價（11400）
//   price_12weeks_anchor       — 原價錨點（12600，永不真實成交）
//   price_4weeks_trial         — 4 週體驗版（4980）
//
// 用途：
//   - /api/apply/visit：回傳 pricing 給 landing UI 顯示對應價格 + 倒數計時
//   - /api/apply/submit：server 再 check super_early_active 算出當下 final_price
//   - /admin/super-early-bird：後台顯示當前狀態
//
// 設計：
//   - 不做個人 24h 計時（一休拍板：3 天後再點還是要享超早鳥）
//   - cutoff_at 是公司階段切換 hard gate
//   - 後台改 cutoff_at = NOW() = 立刻關超早鳥
//   - 後台改 cutoff_at = 未來日 = 設截止 / 延長

import supabase from './supabase.js';

const PRICING_KEYS = [
  'super_early_bird_cutoff_at',
  'price_12weeks_super',
  'price_12weeks_regular',
  'price_12weeks_anchor',
  'price_4weeks_trial',
];

/**
 * 讀當前定價狀態
 * @returns {Promise<{
 *   super_early_active: boolean,
 *   cutoff_at: string|null,
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
  const cutoff_at = map.super_early_bird_cutoff_at || null;
  const now = new Date();
  const cutoffDate = cutoff_at ? new Date(cutoff_at) : null;
  const super_early_active = !!(cutoffDate && !isNaN(cutoffDate.getTime()) && now < cutoffDate);

  return {
    super_early_active,
    cutoff_at,
    now: now.toISOString(),
    prices: {
      super: parseInt(map.price_12weeks_super, 10) || 10400,
      regular: parseInt(map.price_12weeks_regular, 10) || 11400,
      anchor: parseInt(map.price_12weeks_anchor, 10) || 12600,
      trial: parseInt(map.price_4weeks_trial, 10) || 4980,
    },
  };
}

/**
 * 算指定方案的成交價（給 submit endpoint 用）
 * @param {string} program_choice — '12weeks' | '4weeks_trial'
 * @param {object} pricingState — getPricingState() 的回傳
 * @returns {{ final_price: number, super_early_bird_applied: boolean }}
 */
export function calcFinalPrice(program_choice, pricingState) {
  if (program_choice === '4weeks_trial') {
    return { final_price: pricingState.prices.trial, super_early_bird_applied: false };
  }
  // 12weeks
  if (pricingState.super_early_active) {
    return { final_price: pricingState.prices.super, super_early_bird_applied: true };
  }
  return { final_price: pricingState.prices.regular, super_early_bird_applied: false };
}
