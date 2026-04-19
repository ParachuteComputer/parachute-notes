import { useState } from "react";

// Test stub for `virtual:pwa-register/react` — the real module is only
// resolved by vite-plugin-pwa at build time. In tests we return a minimal
// no-op that matches the shape consumers rely on.
export function useRegisterSW(_options?: unknown) {
  const needRefresh = useState(false);
  const offlineReady = useState(false);
  return {
    needRefresh,
    offlineReady,
    updateServiceWorker: async (_reloadPage?: boolean) => {},
  };
}
