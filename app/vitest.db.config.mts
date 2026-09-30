import { defineConfig } from "vitest/config";

// 로컬 Supabase가 떠 있어야 한다 (npx supabase start). 실행: npm run test:db
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
  },
});
