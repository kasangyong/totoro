import { defineConfig } from "vitest/config";

// 로컬 Supabase가 떠 있어야 한다 (npx supabase start). 실행: npm run test:db
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    // Windows에서 프로세스가 많을 때 fork 워커가 0xC0000142로 죽는 경우가 있어 스레드 사용
    pool: "threads",
    testTimeout: 30000,
  },
});
