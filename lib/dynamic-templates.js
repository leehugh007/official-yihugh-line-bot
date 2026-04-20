// 契約 v6 附錄 D：DYNAMIC_TEMPLATE_IDS
// 這些模板的 message_template 欄存的是 AI prompt 骨架，不是最終回覆文字
// renderTemplate 看到這些 id 就不套變數，改用 aiOutput.feedback_text

export const DYNAMIC_TEMPLATE_IDS = ['path_d_ai_meal_feedback'];

export function isDynamic(id) {
  return DYNAMIC_TEMPLATE_IDS.includes(id);
}
