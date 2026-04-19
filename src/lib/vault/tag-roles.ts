import { useCallback, useEffect, useState } from "react";

// Per-vault "tag role" settings. Features like capture, pin, archive want to
// apply a specific tag — but hardcoding tag names pushes one vault's
// conventions onto every vault. Each role holds a customizable tag name; the
// defaults preserve sensible behavior for a fresh vault.
//
// Stored per-vault in localStorage, analogous to scribe settings. Remapping a
// role never retags existing notes — the role just points at the new tag
// going forward.
export interface TagRoles {
  pinned: string;
  archived: string;
  captureVoice: string;
  captureText: string;
  view: string;
}

export const DEFAULT_TAG_ROLES: TagRoles = {
  pinned: "pinned",
  archived: "archived",
  captureVoice: "voice",
  captureText: "quick",
  view: "view",
};

export const TAG_ROLE_KEYS = ["pinned", "archived", "captureVoice", "captureText", "view"] as const;
export type TagRoleKey = (typeof TAG_ROLE_KEYS)[number];

const STORAGE_PREFIX = "lens:tag-roles:";

function keyFor(vaultId: string): string {
  return STORAGE_PREFIX + vaultId;
}

function normalizeTag(name: string | undefined, fallback: string): string {
  if (typeof name !== "string") return fallback;
  const trimmed = name.trim().replace(/^#/, "");
  return trimmed.length > 0 ? trimmed : fallback;
}

export function loadTagRoles(vaultId: string): TagRoles {
  try {
    const raw = localStorage.getItem(keyFor(vaultId));
    if (!raw) return { ...DEFAULT_TAG_ROLES };
    const parsed = JSON.parse(raw) as Partial<TagRoles>;
    return {
      pinned: normalizeTag(parsed.pinned, DEFAULT_TAG_ROLES.pinned),
      archived: normalizeTag(parsed.archived, DEFAULT_TAG_ROLES.archived),
      captureVoice: normalizeTag(parsed.captureVoice, DEFAULT_TAG_ROLES.captureVoice),
      captureText: normalizeTag(parsed.captureText, DEFAULT_TAG_ROLES.captureText),
      view: normalizeTag(parsed.view, DEFAULT_TAG_ROLES.view),
    };
  } catch {
    return { ...DEFAULT_TAG_ROLES };
  }
}

export function saveTagRoles(vaultId: string, roles: TagRoles): void {
  const normalized: TagRoles = {
    pinned: normalizeTag(roles.pinned, DEFAULT_TAG_ROLES.pinned),
    archived: normalizeTag(roles.archived, DEFAULT_TAG_ROLES.archived),
    captureVoice: normalizeTag(roles.captureVoice, DEFAULT_TAG_ROLES.captureVoice),
    captureText: normalizeTag(roles.captureText, DEFAULT_TAG_ROLES.captureText),
    view: normalizeTag(roles.view, DEFAULT_TAG_ROLES.view),
  };
  try {
    localStorage.setItem(keyFor(vaultId), JSON.stringify(normalized));
  } catch {
    // storage unavailable — best-effort only
  }
}

export function deleteTagRoles(vaultId: string): void {
  try {
    localStorage.removeItem(keyFor(vaultId));
  } catch {
    // storage unavailable — best-effort only
  }
}

// Re-reads on mount and on vaultId change. `setRoles(null)` resets to defaults.
// Returns defaults (not null) when nothing is stored so call sites can read a
// role tag without null-checks.
export function useTagRoles(vaultId: string | null): {
  roles: TagRoles;
  setRoles: (next: TagRoles | null) => void;
} {
  const [roles, setState] = useState<TagRoles>(() =>
    vaultId ? loadTagRoles(vaultId) : { ...DEFAULT_TAG_ROLES },
  );

  useEffect(() => {
    setState(vaultId ? loadTagRoles(vaultId) : { ...DEFAULT_TAG_ROLES });
  }, [vaultId]);

  const setRoles = useCallback(
    (next: TagRoles | null) => {
      if (!vaultId) return;
      if (next === null) {
        deleteTagRoles(vaultId);
        setState({ ...DEFAULT_TAG_ROLES });
      } else {
        saveTagRoles(vaultId, next);
        setState(loadTagRoles(vaultId));
      }
    },
    [vaultId],
  );

  return { roles, setRoles };
}
