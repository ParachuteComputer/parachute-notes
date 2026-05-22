// Per-vault "recently viewed notes" track, used as the empty-state of the
// Cmd+K switcher. localStorage-backed, capped so it never balloons.
//
// Storage shape: `lens:recents:<vaultId>` → JSON array of {id, viewedAt}.
// Most-recent first; older entries fall off when the cap is hit.

export const MAX_RECENTS = 10;
const STORAGE_PREFIX = "lens:recents:";

export interface RecentEntry {
  id: string;
  viewedAt: number;
}

function keyFor(vaultId: string): string {
  return STORAGE_PREFIX + vaultId;
}

export function loadRecents(vaultId: string): RecentEntry[] {
  try {
    const raw = localStorage.getItem(keyFor(vaultId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is RecentEntry =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as RecentEntry).id === "string" &&
          typeof (e as RecentEntry).viewedAt === "number",
      )
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

// Push an id to the top, removing any earlier entry with the same id so the
// list stays deduplicated.
export function pushRecent(vaultId: string, id: string, now: number = Date.now()): void {
  try {
    const current = loadRecents(vaultId).filter((e) => e.id !== id);
    const next: RecentEntry[] = [{ id, viewedAt: now }, ...current].slice(0, MAX_RECENTS);
    localStorage.setItem(keyFor(vaultId), JSON.stringify(next));
  } catch {
    // storage unavailable — best-effort only
  }
}

export function clearRecents(vaultId: string): void {
  try {
    localStorage.removeItem(keyFor(vaultId));
  } catch {
    // best-effort
  }
}
