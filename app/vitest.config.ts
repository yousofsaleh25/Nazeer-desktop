import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const src = resolve(__dirname, "src");
const alias = {
  "@": resolve(src, "renderer"),
  "@shared": resolve(src, "shared"),
  "@print": resolve(src, "print"),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          include: [
            "src/main/**/*.test.ts",
            "src/shared/**/*.test.ts",
            "src/preload/**/*.test.ts",
            // renderer/print checks that read files from disk (*.node.test.ts)
            "src/renderer/**/*.node.test.ts",
            "src/print/**/*.node.test.ts",
          ],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "web",
          environment: "jsdom",
          include: ["src/renderer/**/*.test.{ts,tsx}", "src/print/**/*.test.{ts,tsx}"],
          exclude: ["**/*.node.test.ts", "**/node_modules/**"],
          // CSS imports are stubbed as empty by default; the contrast and palette checks (and the
          // /design gallery) read the shipped token values through `tokens.css?raw`
          css: { include: [/design\/tokens\.css/] },
          setupFiles: ["src/renderer/test/setup.ts"],
        },
      },
    ],
  },
});
