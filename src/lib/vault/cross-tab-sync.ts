import { useEffect } from "react";
import { AUTH_HALT_KEY_PREFIX, useAuthHaltStore } from "./auth-halt-store";
import { loadActiveVaultId, loadVaults } from "./storage";
import { useVaultStore } from "./store";

// Storage events fire across same-origin tabs but never within the tab that
// wrote the change — so this listener can call `setState` directly without
// looping. We mirror only the *state*, never the action: the `setActive` etc.
// methods write to localStorage themselves, which is what triggered the event
// in the other tab. Calling them here would write again and cause a redundant
// save.
//
// Keys we mirror:
//   - lens:vaults           (full vault list)
//   - lens:active_vault     (active vault id; vault-switch-aware components
//                            (QuickSwitchMount etc.) react via existing hooks)
//   - lens:auth-halt:<id>   (per-vault auth halt; reload entire halt store
//                            because there's no per-key removal in zustand)

const VAULTS_KEY = "lens:vaults";
const ACTIVE_KEY = "lens:active_vault";

export function useCrossTabVaultSync(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      // `e.key === null` means localStorage.clear() — refresh everything we
      // mirror so no stale state survives the wipe.
      if (e.key === null) {
        useVaultStore.setState({
          vaults: loadVaults(),
          activeVaultId: loadActiveVaultId(),
        });
        useAuthHaltStore.getState().reloadFromStorage();
        return;
      }
      if (e.key === ACTIVE_KEY) {
        useVaultStore.setState({ activeVaultId: loadActiveVaultId() });
        return;
      }
      if (e.key === VAULTS_KEY) {
        useVaultStore.setState({ vaults: loadVaults() });
        return;
      }
      if (e.key.startsWith(AUTH_HALT_KEY_PREFIX)) {
        useAuthHaltStore.getState().reloadFromStorage();
        return;
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
}
