import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "out/**",
      "dist*/**",
      "release/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "src/shared/api.d.ts",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: [
      "src/main/**",
      "src/preload/**",
      "scripts/**",
      "e2e/**",
      "*.config.*",
      "**/*.node.test.ts",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/renderer/**", "src/print/**"],
    // checks that read source files from disk run in Node (vitest "node" project)
    ignores: ["**/*.node.test.ts"],
    extends: [reactHooks.configs.flat["recommended-latest"]],
    languageOptions: { globals: globals.browser },
    rules: {
      // the renderer never touches Electron or Node: it talks to window.nazeer and the engine
      "no-restricted-imports": ["error", { paths: ["electron"], patterns: ["node:*"] }],
    },
  },
  {
    // the print page takes language, rubric and names as explicit inputs (D7), never storage
    files: ["src/print/**"],
    rules: {
      "no-restricted-globals": ["error", "localStorage", "sessionStorage", "indexedDB"],
    },
  },
);
