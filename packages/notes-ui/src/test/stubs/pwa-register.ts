import { useState } from "react";

// Test stub for `virtual:pwa-register/react` — the real module is only
// resolved by vite-plugin-pwa at build time. In tests we return a minimal
// shape consumers rely on, plus a hook (`__pwaTestRig`) that lets a test
// flip needRefresh and observe updateServiceWorker calls. Production code
// imports from this stub via the vitest alias.
export interface PwaTestRig {
  setNeedRefresh: (v: boolean) => void;
  updateServiceWorker: (reload?: boolean) => Promise<void>;
}

let rig: PwaTestRig | null = null;
const updateCalls: boolean[] = [];

export function useRegisterSW(_options?: unknown) {
  const needRefreshState = useState(false);
  const offlineReady = useState(false);
  const setNeedRefresh = needRefreshState[1];
  const updateServiceWorker = async (reload?: boolean) => {
    updateCalls.push(reload ?? false);
  };
  rig = { setNeedRefresh, updateServiceWorker };
  return {
    needRefresh: needRefreshState,
    offlineReady,
    updateServiceWorker,
  };
}

// Test-only: trigger needRefresh from outside React's hook tree so a test
// can render UpdateBanner, flip the flag, click Reload, and observe the
// chain. Returns the underlying rig so tests can also assert the call.
export function __getPwaTestRig(): PwaTestRig | null {
  return rig;
}

export function __getPwaUpdateCalls(): boolean[] {
  return updateCalls;
}

export function __resetPwaTestRig(): void {
  rig = null;
  updateCalls.length = 0;
}
