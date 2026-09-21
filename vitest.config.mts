import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  esbuild: { jsx: "automatic" },
  test: { include: ["tests/frontend/**/*.test.{ts,tsx}"], environment: "node" },
});
