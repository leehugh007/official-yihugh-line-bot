// lib/conversation-path.js 單元測試
// 聚焦 extractWeights（既有）+ extractPartialWeight（新增 Q1 漏接修復）
//
// 跑法：npm test

import { describe, it, expect } from 'vitest';
import {
  extractWeights,
  extractPartialWeight,
  pickWeightDiffCondition,
  isMainChoice,
  detectMultiChoice,
} from '../lib/conversation-path.js';

describe('extractWeights (既有行為保護)', () => {
  it('標準雙數字 + 公斤', () => {
    expect(extractWeights('58 公斤 瘦到 50')).toEqual({ current: 58, target: 50 });
  });
  it('無關鍵字 → null', () => {
    expect(extractWeights('58 50')).toBeNull();
  });
  it('單數字 → null', () => {
    expect(extractWeights('52')).toBeNull();
    expect(extractWeights('我現在 58 公斤')).toBeNull();
  });
  it('剔除身高', () => {
    expect(extractWeights('身高 165 體重 58 公斤 想瘦到 50')).toEqual({ current: 58, target: 50 });
    expect(extractWeights('165 公分 58 公斤 瘦到 50')).toEqual({ current: 58, target: 50 });
  });
  it('極端數字排除', () => {
    expect(extractWeights('220 公斤 瘦到 200')).toBeNull(); // current > 200
  });
});

describe('extractPartialWeight — 規則 1 diff', () => {
  it('瘦3公斤', () => {
    expect(extractPartialWeight('瘦3公斤')).toEqual({ diff: 3 });
  });
  it('減5kg', () => {
    expect(extractPartialWeight('減5kg')).toEqual({ diff: 5 });
  });
  it('-3 公斤', () => {
    expect(extractPartialWeight('-3 公斤')).toEqual({ diff: 3 });
  });
  it('想瘦10', () => {
    expect(extractPartialWeight('想瘦10')).toEqual({ diff: 10 });
  });
  it('瘦3公斤（strict mode 也可）', () => {
    expect(extractPartialWeight('瘦3公斤', { mode: 'strict' })).toEqual({ diff: 3 });
  });
  it('diff 上限 100', () => {
    expect(extractPartialWeight('瘦 150 公斤')).toBeNull();
  });
  it('無數字的「想瘦」不命中', () => {
    expect(extractPartialWeight('想瘦')).toBeNull();
    expect(extractPartialWeight('就是想瘦')).toBeNull();
  });
});

describe('extractPartialWeight — 規則 2 target', () => {
  it('瘦到50', () => {
    expect(extractPartialWeight('瘦到50')).toEqual({ target: 50 });
  });
  it('目標48', () => {
    expect(extractPartialWeight('目標48')).toEqual({ target: 48 });
  });
  it('降到60', () => {
    expect(extractPartialWeight('降到60')).toEqual({ target: 60 });
  });
  it('想變50公斤', () => {
    expect(extractPartialWeight('想變50公斤')).toEqual({ target: 50 });
  });
  it('希望到55', () => {
    expect(extractPartialWeight('希望到55')).toEqual({ target: 55 });
  });
  it('瘦到50 優先於 diff（帶 target hint 時不抓 diff）', () => {
    // 「瘦到50」不該抓成 diff=50，要抓 target=50
    expect(extractPartialWeight('瘦到50')).toEqual({ target: 50 });
  });
});

describe('extractPartialWeight — 規則 3 current 明確意圖', () => {
  it('我現在58', () => {
    expect(extractPartialWeight('我現在58')).toEqual({ current: 58 });
  });
  it('目前65', () => {
    expect(extractPartialWeight('目前65')).toEqual({ current: 65 });
  });
  it('我是58', () => {
    expect(extractPartialWeight('我是58')).toEqual({ current: 58 });
  });
  it('現在 72 公斤', () => {
    expect(extractPartialWeight('現在 72 公斤')).toEqual({ current: 72 });
  });
});

describe('extractPartialWeight — 規則 4 單數字 + 公斤單位', () => {
  it('58公斤', () => {
    expect(extractPartialWeight('58公斤')).toEqual({ current: 58 });
  });
  it('50 kg', () => {
    expect(extractPartialWeight('50 kg')).toEqual({ current: 50 });
  });
  it('strict mode 也命中', () => {
    expect(extractPartialWeight('58公斤', { mode: 'strict' })).toEqual({ current: 58 });
  });
});

describe('extractPartialWeight — 規則 5 純單數字（loose only）', () => {
  it('loose mode：純 52 → current', () => {
    expect(extractPartialWeight('52')).toEqual({ current: 52 });
  });
  it('loose mode：純 58.5 → current', () => {
    expect(extractPartialWeight('58.5')).toEqual({ current: 58.5 });
  });
  it('strict mode：純單數字 → null（防 2024 年誤觸）', () => {
    expect(extractPartialWeight('52', { mode: 'strict' })).toBeNull();
    expect(extractPartialWeight('58', { mode: 'strict' })).toBeNull();
  });
  it('「6452」4 位數不命中任一規則', () => {
    expect(extractPartialWeight('6452')).toBeNull();
    expect(extractPartialWeight('6452', { mode: 'strict' })).toBeNull();
  });
  it('單數字超範圍（220）不命中', () => {
    expect(extractPartialWeight('220')).toBeNull();
  });
  it('單數字過小（15）不命中', () => {
    expect(extractPartialWeight('15')).toBeNull();
  });
});

describe('extractPartialWeight — 邊界 / 混合', () => {
  it('雙數字（會被 extractWeights 先吃掉，此處也不該誤報）', () => {
    // 「58 瘦到 50」走 target 規則 → 只回 target=50（不會抓 current）
    expect(extractPartialWeight('58 瘦到 50')).toEqual({ target: 50 });
  });
  it('空字串 / null 安全', () => {
    expect(extractPartialWeight('')).toBeNull();
    expect(extractPartialWeight(null)).toBeNull();
    expect(extractPartialWeight(undefined)).toBeNull();
  });
  it('純打招呼 → null', () => {
    expect(extractPartialWeight('你好')).toBeNull();
    expect(extractPartialWeight('哈囉', { mode: 'strict' })).toBeNull();
  });
  it('含數字但非體重語意（strict）', () => {
    // strict mode 下 「52」不命中，但「52 公斤」會命中（規則 4）
    expect(extractPartialWeight('52', { mode: 'strict' })).toBeNull();
    expect(extractPartialWeight('2024 年想瘦', { mode: 'strict' })).toBeNull();
  });
  it('loose mode 會誤觸「52 號」→ 這是設計取捨，stage=1 情境下預期用戶在回體重', () => {
    // 記錄行為：loose mode 純單數字預設 current，用戶否認時 bot 反問修正
    expect(extractPartialWeight('52 號', { mode: 'loose' })).toBeNull(); // 有「號」字不是純數字 → null
    expect(extractPartialWeight('52', { mode: 'loose' })).toEqual({ current: 52 });
  });
});

describe('pickWeightDiffCondition', () => {
  it('小差距', () => {
    expect(pickWeightDiffCondition(3, 5, 15)).toBe('weight_diff_small');
    expect(pickWeightDiffCondition(5, 5, 15)).toBe('weight_diff_small');
  });
  it('中差距', () => {
    expect(pickWeightDiffCondition(8, 5, 15)).toBe('weight_diff_medium');
  });
  it('大差距', () => {
    expect(pickWeightDiffCondition(15, 5, 15)).toBe('weight_diff_large');
    expect(pickWeightDiffCondition(20, 5, 15)).toBe('weight_diff_large');
  });
});

describe('isMainChoice (既有行為保護)', () => {
  it('A / B / C / D', () => {
    expect(isMainChoice('A')).toBe('A');
    expect(isMainChoice('我選B')).toBe('B');
    expect(isMainChoice('選 C')).toBe('C');
    expect(isMainChoice('Ａ')).toBe('A'); // 全形
  });
  it('複選不命中', () => {
    expect(isMainChoice('AB')).toBeNull();
  });
});

describe('detectMultiChoice (既有行為保護)', () => {
  it('AB', () => {
    expect(detectMultiChoice('AB')).toEqual(['A', 'B']);
  });
  it('ABD', () => {
    expect(detectMultiChoice('ABD')).toEqual(['A', 'B', 'D']);
  });
  it('單一 A 不是複選', () => {
    expect(detectMultiChoice('A')).toBeNull();
  });
});
