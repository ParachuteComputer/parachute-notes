import { useCallback, useEffect, useState } from "react";

// Per-vault setting for the path-tree sidebar. `auto` renders the tree only
// when the vault's paths meet the threshold in `tree.ts`; `always` forces it
// on; `never` keeps the sidebar tag-flat. Defaults to `auto`.
export type PathTreeMode = "auto" | "always" | "never";

export const PATH_TREE_MODES: readonly PathTreeMode[] = ["auto", "always", "never"];

export const DEFAULT_PATH_TREE_MODE: PathTreeMode = "auto";

const STORAGE_PREFIX = "lens:path-tree:";

function keyFor(vaultId: string): string {
  return STORAGE_PREFIX + vaultId;
}

function normalize(value: unknown): PathTreeMode {
  return typeof value === "string" && (PATH_TREE_MODES as readonly string[]).includes(value)
    ? (value as PathTreeMode)
    : DEFAULT_PATH_TREE_MODE;
}

export function loadPathTreeMode(vaultId: string): PathTreeMode {
  try {
    const raw = localStorage.getItem(keyFor(vaultId));
    if (!raw) return DEFAULT_PATH_TREE_MODE;
    const parsed = JSON.parse(raw) as { mode?: unknown };
    return normalize(parsed.mode);
  } catch {
    return DEFAULT_PATH_TREE_MODE;
  }
}

export function savePathTreeMode(vaultId: string, mode: PathTreeMode): void {
  try {
    localStorage.setItem(keyFor(vaultId), JSON.stringify({ mode }));
  } catch {
    // storage unavailable — best-effort only
  }
}

export function deletePathTreeMode(vaultId: string): void {
  try {
    localStorage.removeItem(keyFor(vaultId));
  } catch {
    // storage unavailable — best-effort only
  }
}

export function usePathTreeMode(vaultId: string | null): {
  mode: PathTreeMode;
  setMode: (next: PathTreeMode) => void;
} {
  const [mode, setState] = useState<PathTreeMode>(() =>
    vaultId ? loadPathTreeMode(vaultId) : DEFAULT_PATH_TREE_MODE,
  );

  useEffect(() => {
    setState(vaultId ? loadPathTreeMode(vaultId) : DEFAULT_PATH_TREE_MODE);
  }, [vaultId]);

  const setMode = useCallback(
    (next: PathTreeMode) => {
      if (!vaultId) return;
      savePathTreeMode(vaultId, next);
      setState(next);
    },
    [vaultId],
  );

  return { mode, setMode };
}
