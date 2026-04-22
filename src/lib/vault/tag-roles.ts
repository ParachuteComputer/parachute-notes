// Per-vault "tag role" settings. Features like capture, pin, archive want to
// apply a specific tag — but hardcoding tag names pushes one vault's
// conventions onto every vault. Each role holds a customizable tag name; the
// defaults preserve sensible behavior for a fresh vault.
//
// Storage: starting in v0.3.0-rc.2, tag roles live inside the vault settings
// note (`.parachute/lens/settings`) so they sync across the same user's
// devices. The legacy per-vault localStorage key `lens:tag-roles:<vaultId>`
// is still read on first boot as a migration seed; leave it in place one
// release cycle so a downgrade doesn't lose the data. The `useTagRoles` hook
// now lives in `./settings.ts` (delegating to `useVaultSettings`) — keeping it
// out of this file breaks a tag-roles → settings → tag-roles import cycle.
//
// Remapping a role never retags existing notes — the role just points at the
// new tag going forward.
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

// Accepts any shape (including a partial object from the vault settings note)
// and returns a fully-populated TagRoles. Shared between the legacy
// localStorage path and the settings-note extraction.
export function normalizeTagRoles(raw: unknown): TagRoles {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_TAG_ROLES };
  const r = raw as Partial<TagRoles>;
  return {
    pinned: normalizeTag(r.pinned, DEFAULT_TAG_ROLES.pinned),
    archived: normalizeTag(r.archived, DEFAULT_TAG_ROLES.archived),
    captureVoice: normalizeTag(r.captureVoice, DEFAULT_TAG_ROLES.captureVoice),
    captureText: normalizeTag(r.captureText, DEFAULT_TAG_ROLES.captureText),
    view: normalizeTag(r.view, DEFAULT_TAG_ROLES.view),
  };
}

// Legacy localStorage helpers — retained as a migration seed for the vault
// settings note. Kept in-tree one release cycle; remove in rc.3+.
export function loadTagRoles(vaultId: string): TagRoles {
  try {
    const raw = localStorage.getItem(keyFor(vaultId));
    if (!raw) return { ...DEFAULT_TAG_ROLES };
    return normalizeTagRoles(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_TAG_ROLES };
  }
}

export function saveTagRoles(vaultId: string, roles: TagRoles): void {
  const normalized = normalizeTagRoles(roles);
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
