import type { ManifestOptions } from "vite-plugin-pwa";

export const PWA_MANIFEST: Partial<ManifestOptions> = {
  id: "/",
  name: "Parachute Lens",
  short_name: "Lens",
  description: "A lightweight web UI for any Parachute Vault.",
  theme_color: "#4a7c59",
  background_color: "#faf8f4",
  display: "standalone",
  orientation: "any",
  start_url: "/",
  scope: "/",
  icons: [
    { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
    { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
    { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    {
      src: "maskable-icon-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
};
