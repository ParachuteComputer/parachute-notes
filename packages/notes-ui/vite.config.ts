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

// Notes is one of N frontends in the ecosystem. Two things share the
// "where does Notes live?" concept and they no longer agree by default:
//
//   - `basePath` (below) is the *advertised dev/preview mount* — it
//     pins the dev server to `/notes/`, scopes the PWA manifest, and
//     populates `services.json` / `.parachute/info` so `parachute
//     start notes` works under the legacy daemon shape. Override with
//     VITE_BASE_PATH=/ for the stand-alone shape (no path prefix).
//
//   - The bundle's *runtime* mount is detected at load time via
//     `detectMountBase()` in `src/lib/base-url.ts` (reads
//     `window.location.pathname`). That's how the same built `dist/`
//     can serve at `/notes/` (legacy daemon), `/app/notes/`
//     (parachute-app default), or `/app/<custom-slug>/` (parachute-app
//     with a renamed install) without a rebuild.
//
// The big shift (2026-05-23, this commit): `base: ""` below tells Vite
// to emit RELATIVE asset URLs (`./assets/...`) in the built
// `index.html` instead of absolute (`/notes/assets/...`). The browser
// resolves them against the document's URL, so wherever the bundle is
// served, assets resolve correctly. React Router's basename then comes
// from `detectMountBase()` not `import.meta.env.BASE_URL`.
//
// One known limitation: the PWA manifest's `start_url`/`scope` are
// fixed at build time (the spec doesn't support runtime values without
// server-side rewriting). The PWA install therefore launches under the
// build-time `basePath` (default `/notes/`). Operators who want PWA
// install at a non-default mount must build with VITE_BASE_PATH set
// to that mount. Documented in CHANGELOG; revisit when parachute-app
// grows a manifest-rewrite hook.
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
  // Relative-mode asset URLs (`./assets/...`) so the same built bundle
  // works at any mount path. See the long comment above `basePath` for
  // the runtime mount detection that replaces `import.meta.env.BASE_URL`
  // as the source of truth for the router basename + OAuth callback path.
  base: "",
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
      // App code is the only registration path: `UpdateBanner` calls
      // `useRegisterSW` (gated by `shouldRegisterServiceWorker()` which
      // compares the runtime mount to the build-time vite base). Tell
      // vite-plugin-pwa NOT to auto-inject a registration script into
      // `index.html` — otherwise that script would register the SW
      // unconditionally at the page's current scope, which is exactly
      // the bug we just fixed for parachute-app installs (notes 0.1.2,
      // 2026-05-23). Belt + suspenders: even though vite-plugin-pwa's
      // default in v1 is to skip auto-inject when `useRegisterSW` is
      // used, declaring it explicitly here documents the contract.
      injectRegister: false,
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
  // Notes' canonical Parachute slot is 1942 (vault is 1940; the 1939–1949
  // range is reserved for first-party services). Pin it so the manifest
  // write in `notes-service-plugin.ts` advertises a stable port — Vite's
  // 5173 default would otherwise drift if anything else grabs that port.
  server: {
    port: 1942,
    host: devExposure ? "0.0.0.0" : undefined,
    allowedHosts: devExposure ? true : undefined,
  },
  preview: {
    port: 1942,
  },
});
