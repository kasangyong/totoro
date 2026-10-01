import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// 기본 테스트는 DB 없이 도는 순수 엔진 테스트만. DB 테스트는 vitest.db.config.mts (npm run test:db).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    exclude: [...configDefaults.exclude, "tests/**"],
  },
});
