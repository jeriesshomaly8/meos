import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";


export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    /*
     * Vitest only defaults NODE_ENV to "test" when nothing has set it already.
     * A shell that exports production — CI images and some dev machines do —
     * hands the tests React's production build, which ships no `act()`, and
     * component tests then fail with "React.act is not a function" rather than
     * anything about the code. Pinned so `npm test` behaves the same anywhere.
     */
    env: { NODE_ENV: "test" },
  },
});
