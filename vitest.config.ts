import path from "node:path";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Mirror the production default so `import.meta.env.BASE_URL` in tests
  // reflects what the SPA actually sees at runtime.
  base: "/notes/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // vite-plugin-pwa only resolves this virtual at build time.
      "virtual:pwa-register/react": path.resolve(__dirname, "./src/test/stubs/pwa-register.ts"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // `.claude/` may host an untracked agent worktree (duplicate source copies);
    // exclude so vitest doesn't run those duplicates as tests.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
});
