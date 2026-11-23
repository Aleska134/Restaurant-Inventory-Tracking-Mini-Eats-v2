import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the server logic in lib/ (no network, no database, no AI calls).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // Next.js blocks importing server code from the browser; in tests it is just an empty module.
      "server-only": fileURLToPath(new URL("./tests/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
