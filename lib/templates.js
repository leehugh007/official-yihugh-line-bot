// 契約 v6 第 4.3 章：renderTemplate
// 用途：把 message_template 的 {diff}/{current}/{target} 變數替換成 user 欄位值
// DYNAMIC 模板走 aiOutput.feedback_text 直出

import { isDynamic } from './dynamic-templates.js';

export async function renderTemplate(template, user, aiOutput = null) {
  if (isDynamic(template.id)) {
    if (!aiOutput?.feedback_text) {
      throw new Error(`DYNAMIC ${template.id} missing aiOutput`);
    }
    return aiOutput.feedback_text;
  }

  let text = template.message_template;
  const vars = {
    '{diff}': () => Math.abs(user.target_weight - user.current_weight),
    '{current}': () => user.current_weight,
    '{target}': () => user.target_weight,
  };

  for (const [placeholder, get] of Object.entries(vars)) {
    if (text.includes(placeholder)) {
      const val = get();
      if (val == null) {
        throw new Error(`${template.id} needs ${placeholder} but value is null`);
      }
      text = text.replaceAll(placeholder, String(val));
    }
  }
  return text;
}
