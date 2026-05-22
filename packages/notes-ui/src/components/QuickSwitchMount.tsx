import { QuickSwitch } from "@/components/QuickSwitch";
import { useQuickSwitchOpen } from "@/lib/quick-switch/open-store";
import { useVaultStore } from "@/lib/vault";
import { useEffect, useRef } from "react";

// Global Cmd/Ctrl+K listener + conditional mount of the switcher. Kept
// separate from the switcher itself so tests can render just the dialog
// without the global-listener side effects, and so the listener doesn't
// have to re-run every time the switcher re-renders from inside.
//
// Open state lives in `useQuickSwitchOpen` so other surfaces (e.g. the
// mobile bottom-tab Search button) can open the switcher too.

export function QuickSwitchMount() {
  const open = useQuickSwitchOpen((s) => s.open);
  const setOpen = useQuickSwitchOpen((s) => s.setOpen);
  const toggle = useQuickSwitchOpen((s) => s.toggle);
  const activeVaultId = useVaultStore((s) => s.activeVaultId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd+K on macOS, Ctrl+K elsewhere. K with no modifiers is a plain
      // letter — should never open the switcher.
      if (e.key === "k" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // Reset open state on vault switch — otherwise the switcher pops back open
  // against the new vault's notes mid-transition, which never matches what
  // the user was looking at. Skip the initial mount so the open state isn't
  // clobbered before the user has had a chance to interact.
  const lastVaultId = useRef(activeVaultId);
  useEffect(() => {
    if (lastVaultId.current !== activeVaultId) {
      lastVaultId.current = activeVaultId;
      setOpen(false);
    }
  }, [activeVaultId, setOpen]);

  if (!open || activeVaultId === null) return null;
  return <QuickSwitch onClose={() => setOpen(false)} />;
}
