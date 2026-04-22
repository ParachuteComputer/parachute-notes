import { useCallback, useEffect, useState } from "react";

// Per-vault list of "pinned" tag names. The Notes home renders these as a
// quick-filter strip; tapping one narrows the list to that tag. Stored in
// localStorage so the strip survives reloads without a roundtrip to the vault.
//
// TODO(lens-settings): once the lens-settings tentacle lands its
// `useVaultSettings` hook with a `pinnedTags` field, migrate call sites from
// `usePinnedTags(vaultId)` to `useVaultSettings(vaultId).pinnedTags` and
// delete this file. Keeping the storage key narrow (`lens:pinned-tags:*`,
// shape `string[]`) so the move is mechanical.

const STORAGE_PREFIX = "lens:pinned-tags:";

function keyFor(vaultId: string): string {
  return STORAGE_PREFIX + vaultId;
}

function normalize(name: string): string {
  return name.trim().replace(/^#/, "");
}

function dedupe(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = normalize(raw);
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

export function loadPinnedTags(vaultId: string): string[] {
  try {
    const raw = localStorage.getItem(keyFor(vaultId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return dedupe(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return [];
  }
}

export function savePinnedTags(vaultId: string, tags: string[]): void {
  try {
    localStorage.setItem(keyFor(vaultId), JSON.stringify(dedupe(tags)));
  } catch {
    // storage unavailable — best-effort only
  }
}

export function deletePinnedTags(vaultId: string): void {
  try {
    localStorage.removeItem(keyFor(vaultId));
  } catch {
    // storage unavailable — best-effort only
  }
}

// Re-reads on mount and on vaultId change. Returns `[]` (not null) so call
// sites can map without null-checks.
export function usePinnedTags(vaultId: string | null): {
  pinnedTags: string[];
  setPinnedTags: (next: string[]) => void;
  togglePin: (tag: string) => void;
  isPinned: (tag: string) => boolean;
} {
  const [pinnedTags, setState] = useState<string[]>(() => (vaultId ? loadPinnedTags(vaultId) : []));

  useEffect(() => {
    setState(vaultId ? loadPinnedTags(vaultId) : []);
  }, [vaultId]);

  const setPinnedTags = useCallback(
    (next: string[]) => {
      if (!vaultId) return;
      const cleaned = dedupe(next);
      savePinnedTags(vaultId, cleaned);
      setState(cleaned);
    },
    [vaultId],
  );

  const togglePin = useCallback(
    (tag: string) => {
      if (!vaultId) return;
      const t = normalize(tag);
      if (!t) return;
      setState((prev) => {
        const has = prev.some((p) => p.toLowerCase() === t.toLowerCase());
        const next = has ? prev.filter((p) => p.toLowerCase() !== t.toLowerCase()) : [...prev, t];
        savePinnedTags(vaultId, next);
        return next;
      });
    },
    [vaultId],
  );

  const isPinned = useCallback(
    (tag: string) => {
      const t = normalize(tag).toLowerCase();
      return pinnedTags.some((p) => p.toLowerCase() === t);
    },
    [pinnedTags],
  );

  return { pinnedTags, setPinnedTags, togglePin, isPinned };
}
