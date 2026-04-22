// 契約 v6 附錄 D：DYNAMIC_TEMPLATE_IDS
// 這些模板的 message_template 欄存的是 AI prompt 骨架，不是最終回覆文字
// renderTemplate 看到這些 id 就不套變數，改用 aiOutput.feedback_text

// Phase 3.2c 重設計（2026-04-22）：
// - path_all_q4_feedback：通用 Q4 DYNAMIC（取代 eatOut-only 的 path_d_ai_meal_feedback）
// - path_d_ai_meal_feedback：保留在清單（仍是 DYNAMIC 語意），但 is_active=false 不會被選中
export const DYNAMIC_TEMPLATE_IDS = ['path_all_q4_feedback', 'path_d_ai_meal_feedback'];

export function isDynamic(id) {
  return DYNAMIC_TEMPLATE_IDS.includes(id);
}
