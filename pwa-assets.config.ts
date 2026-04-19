import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: {
      ...minimal2023Preset.maskable,
      padding: 0.2,
      resizeOptions: {
        ...minimal2023Preset.maskable.resizeOptions,
        background: "#4a7c59",
      },
    },
    apple: {
      ...minimal2023Preset.apple,
      padding: 0.1,
      resizeOptions: {
        ...minimal2023Preset.apple.resizeOptions,
        background: "#4a7c59",
      },
    },
  },
  images: ["public/icon.svg"],
});
