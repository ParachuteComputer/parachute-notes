import { MemoCapture } from "@/app/routes/MemoCapture";
import { TextCapture } from "@/app/routes/TextCapture";
import { useVaultStore } from "@/lib/vault";
import { useEffect, useState } from "react";
import { Navigate } from "react-router";

// Persisted so someone who always types gets typed-mode by default; someone
// who always records lands on voice. Defaults to text because Apple-Notes-fast
// typing is the more common capture shape.
const MODE_KEY = "lens:capture:mode";
type Mode = "text" | "voice";

function loadMode(): Mode {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    return raw === "voice" ? "voice" : "text";
  } catch {
    return "text";
  }
}

export function Capture() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const [mode, setMode] = useState<Mode>(() => loadMode());

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // quota/private-mode — not worth surfacing
    }
  }, [mode]);

  if (!activeVault) return <Navigate to="/" replace />;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div
        role="tablist"
        aria-label="Capture mode"
        className="mb-6 inline-flex rounded-full border border-border bg-card p-1 text-sm"
      >
        <TabButton active={mode === "text"} onClick={() => setMode("text")} label="Text" />
        <TabButton active={mode === "voice"} onClick={() => setMode("voice")} label="Voice" />
      </div>

      {mode === "text" ? <TextCapture /> : <MemoCapture embedded />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 transition ${
        active ? "bg-accent text-white" : "text-fg-muted hover:text-accent"
      }`}
    >
      {label}
    </button>
  );
}
