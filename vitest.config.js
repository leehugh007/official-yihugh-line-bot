// 明確指定 vitest config，避免往上層吃到 ~/vite.config.ts
// Vitest 預設會 walk up parent dirs 找 vite.config.* — 家目錄那支需要 @vitejs/plugin-react
// 本 repo 不裝，所以要在專案根釘死一份獨立 config。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.{js,mjs}'],
  },
});
