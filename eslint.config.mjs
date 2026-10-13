import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      curly: ["error", "all"],
    },
  },
  globalIgnores([
    ".next/**",
    ".next-e2e/**",
    "next-env.d.ts",
    "design/**",
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);
