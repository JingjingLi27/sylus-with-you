import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 领域层为纯逻辑，使用 node 环境即可，无需浏览器 DOM。
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
