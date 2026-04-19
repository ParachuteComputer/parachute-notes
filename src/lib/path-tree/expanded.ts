import { useCallback, useEffect, useState } from "react";

// Per-vault expanded/collapsed state for the path-tree sidebar. Persisted so
// the user's drill-down survives a page reload. We store a sorted array of
// expanded folder paths in localStorage and re-hydrate to a Set in memory.
const STORAGE_PREFIX = "lens:path-tree-expanded:";

function keyFor(vaultId: string): string {
  return STORAGE_PREFIX + vaultId;
}

export function loadExpanded(vaultId: string): Set<string> {
  try {
    const raw = localStorage.getItem(keyFor(vaultId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

export function saveExpanded(vaultId: string, expanded: Set<string>): void {
  try {
    localStorage.setItem(keyFor(vaultId), JSON.stringify([...expanded].sort()));
  } catch {
    // storage unavailable — best-effort only
  }
}

export function useExpandedPaths(vaultId: string | null): {
  expanded: Set<string>;
  toggle: (path: string) => void;
} {
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    vaultId ? loadExpanded(vaultId) : new Set(),
  );

  useEffect(() => {
    setExpanded(vaultId ? loadExpanded(vaultId) : new Set());
  }, [vaultId]);

  const toggle = useCallback(
    (path: string) => {
      if (!vaultId) return;
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        saveExpanded(vaultId, next);
        return next;
      });
    },
    [vaultId],
  );

  return { expanded, toggle };
}
