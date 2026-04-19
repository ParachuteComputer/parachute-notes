import { useCallback, useEffect, useState } from "react";
import type { ScribeSettings } from "./types";

const STORAGE_PREFIX = "lens:scribe:";

function keyFor(vaultId: string): string {
  return STORAGE_PREFIX + vaultId;
}

export function loadScribeSettings(vaultId: string): ScribeSettings | null {
  try {
    const raw = localStorage.getItem(keyFor(vaultId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ScribeSettings>;
    if (!parsed.url || typeof parsed.url !== "string") return null;
    return {
      url: parsed.url,
      token: typeof parsed.token === "string" && parsed.token.length > 0 ? parsed.token : undefined,
      cleanup: parsed.cleanup === true,
    };
  } catch {
    return null;
  }
}

export function saveScribeSettings(vaultId: string, settings: ScribeSettings): void {
  // Strip empty strings so `loadScribeSettings` consistently returns undefined
  // for missing optional fields.
  const normalized: ScribeSettings = {
    url: settings.url.trim(),
    token: settings.token && settings.token.length > 0 ? settings.token : undefined,
    cleanup: settings.cleanup === true,
  };
  try {
    localStorage.setItem(keyFor(vaultId), JSON.stringify(normalized));
  } catch {
    // storage unavailable — best-effort only
  }
}

export function deleteScribeSettings(vaultId: string): void {
  try {
    localStorage.removeItem(keyFor(vaultId));
  } catch {
    // storage unavailable — best-effort only
  }
}

// Thin React hook for the settings form. Re-reads on mount and on vault
// change. Saves go through the setter, which also broadcasts via the
// `storage` event so other tabs pick them up on next mount.
export function useScribeSettings(vaultId: string | null): {
  settings: ScribeSettings | null;
  setSettings: (next: ScribeSettings | null) => void;
} {
  const [settings, setState] = useState<ScribeSettings | null>(() =>
    vaultId ? loadScribeSettings(vaultId) : null,
  );

  useEffect(() => {
    setState(vaultId ? loadScribeSettings(vaultId) : null);
  }, [vaultId]);

  const setSettings = useCallback(
    (next: ScribeSettings | null) => {
      if (!vaultId) return;
      if (next === null) {
        deleteScribeSettings(vaultId);
      } else {
        saveScribeSettings(vaultId, next);
      }
      setState(next);
    },
    [vaultId],
  );

  return { settings, setSettings };
}
