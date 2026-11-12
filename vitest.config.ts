import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "scripts/test/**/*.test.ts"],
          exclude: ["**/*.e2e.test.ts", "**/node_modules/**"],
        },
      },
      {
        test: {
          name: "web",
          environment: "happy-dom",
          include: ["apps/web/test/**/*.test.{ts,tsx}"],
          exclude: ["**/*.e2e.test.*", "**/node_modules/**"],
        },
      },
      {
        test: {
          name: "e2e",
          include: ["packages/*/test/**/*.e2e.test.ts", "apps/*/test/**/*.e2e.test.ts"],
          testTimeout: 300_000,
          hookTimeout: 300_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
