import { QuickSwitch } from "@/components/QuickSwitch";
import { useVaultStore } from "@/lib/vault";
import { useEffect, useState } from "react";

// Global Cmd/Ctrl+K listener + conditional mount of the switcher. Kept
// separate from the switcher itself so tests can render just the dialog
// without the global-listener side effects, and so the listener doesn't
// have to re-run every time the switcher re-renders from inside.

export function QuickSwitchMount() {
  const [open, setOpen] = useState(false);
  const hasActiveVault = useVaultStore((s) => s.activeVaultId !== null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd+K on macOS, Ctrl+K elsewhere. K with no modifiers is a plain
      // letter — should never open the switcher.
      if (e.key === "k" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open || !hasActiveVault) return null;
  return <QuickSwitch onClose={() => setOpen(false)} />;
}
