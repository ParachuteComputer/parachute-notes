import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Set VITE_EXPOSE=true to bind the dev server to all interfaces and accept any
// Host header — useful when reaching the dev server over a tailnet. Off by default.
const devExposure = process.env.VITE_EXPOSE === "true";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: devExposure ? "0.0.0.0" : undefined,
    allowedHosts: devExposure ? true : undefined,
  },
});
