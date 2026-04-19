import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { PWA_MANIFEST } from "./src/pwa-manifest";

// Set VITE_EXPOSE=true to bind the dev server to all interfaces and accept any
// Host header — useful when reaching the dev server over a tailnet. Off by default.
const devExposure = process.env.VITE_EXPOSE === "true";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg", "apple-touch-icon-180x180.png", "favicon.ico"],
      manifest: PWA_MANIFEST,
      workbox: {
        navigateFallback: "/index.html",
        // Keep vault API + OAuth off the nav fallback so they error cleanly offline.
        navigateFallbackDenylist: [/^\/api\//, /^\/oauth\//, /^\/\.well-known\//],
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
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
