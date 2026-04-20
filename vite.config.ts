import { readFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { buildServiceInfo, infoEndpointPlugin } from "./scripts/info-endpoint-plugin";
import { notesServicePlugin } from "./scripts/notes-service-plugin";
import { buildPwaManifest } from "./src/pwa-manifest";

// Set VITE_EXPOSE=true to bind the dev server to all interfaces and accept any
// Host header — useful when reaching the dev server over a tailnet. Off by default.
const devExposure = process.env.VITE_EXPOSE === "true";

// Notes is one of N frontends mounted under a shared root: the CLI hub page
// owns `/`, and each frontend lives under its own slug. Default to `/notes`
// here so dev, build, and `parachute start notes` all agree.
// Override with VITE_BASE_PATH=/ if you want the legacy stand-alone shape.
const basePath = normalizeBase(process.env.VITE_BASE_PATH ?? "/notes");

const DISPLAY_NAME = "Notes";
const TAGLINE = "Web client for your Parachute Vault";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "./package.json"), "utf8")) as {
  version: string;
};

const serviceInfo = buildServiceInfo({
  name: "parachute-notes",
  displayName: DISPLAY_NAME,
  tagline: TAGLINE,
  version: pkg.version,
  basePath,
  iconFile: "icon.svg",
  // Notes has a real UI — the hub should render it as a clickable card that
  // navigates into `/notes/`, not a detail panel.
  kind: "frontend",
});

function normalizeBase(input: string): string {
  let b = input.startsWith("/") ? input : `/${input}`;
  if (!b.endsWith("/")) b += "/";
  return b;
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    notesServicePlugin({
      name: "parachute-notes",
      version: pkg.version,
      basePath,
      displayName: DISPLAY_NAME,
      tagline: TAGLINE,
    }),
    infoEndpointPlugin({ basePath, ...serviceInfo }),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg", "apple-touch-icon-180x180.png", "favicon.ico"],
      manifest: buildPwaManifest(basePath),
      workbox: {
        navigateFallback: `${basePath}index.html`,
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
