import { enqueue } from "@/lib/sync/queue";
import { useSync } from "@/providers/SyncProvider";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type VaultClient, VaultConflictError, VaultNotFoundError } from "./client";
import { isOffline, useActiveVaultClient, withOfflineFallback } from "./queries";
import { DEFAULT_TAG_ROLES, type TagRoles, loadTagRoles, normalizeTagRoles } from "./tag-roles";
import type { Note } from "./types";

// Per-vault settings live in a single note at this path. We stash the payload
// in the note's metadata (under a `lens` key, so other modules could
// theoretically share the file) and leave the note body empty. See
// CLAUDE.md — "Tag roles" section for the motivation: without a vault-hosted
// canonical copy, per-device localStorage can't sync across Aaron's laptop /
// tablet / phone.
export const SETTINGS_NOTE_PATH = ".parachute/lens/settings";

export const SETTINGS_SCHEMA_VERSION = 1;

// The `lens` sub-object of the settings note's metadata. Namespaced so a future
// cross-module settings convention can layer on without collision.
export interface LensSettings {
  schemaVersion: number;
  tagRoles: TagRoles;
}

// Patch type mirrors LensSettings but lets callers supply only the fields
// they want to change — including a partial tagRoles (e.g. bump `pinned` only).
// Threaded through the write stack so that on a 409 we re-apply the ORIGINAL
// patch onto the refetched server state, instead of overwriting with a
// resolved-from-stale-cache `next`.
export interface LensSettingsPatch {
  schemaVersion?: number;
  tagRoles?: Partial<TagRoles>;
}

export const DEFAULT_LENS_SETTINGS: LensSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  tagRoles: { ...DEFAULT_TAG_ROLES },
};

export function normalizeLensSettings(raw: unknown): LensSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_LENS_SETTINGS, tagRoles: { ...DEFAULT_TAG_ROLES } };
  }
  const r = raw as { schemaVersion?: unknown; tagRoles?: unknown };
  const schemaVersion =
    typeof r.schemaVersion === "number" ? r.schemaVersion : SETTINGS_SCHEMA_VERSION;
  const tagRoles = normalizeTagRoles(r.tagRoles);
  return { schemaVersion, tagRoles };
}

export function extractLensSettings(note: Note | null | undefined): LensSettings {
  if (!note || !note.metadata || typeof note.metadata !== "object") {
    return { ...DEFAULT_LENS_SETTINGS, tagRoles: { ...DEFAULT_TAG_ROLES } };
  }
  const meta = note.metadata as Record<string, unknown>;
  return normalizeLensSettings(meta.lens);
}

export function applySettingsPatch(base: LensSettings, patch: LensSettingsPatch): LensSettings {
  return {
    schemaVersion: patch.schemaVersion ?? base.schemaVersion,
    tagRoles: patch.tagRoles
      ? normalizeTagRoles({ ...base.tagRoles, ...patch.tagRoles })
      : base.tagRoles,
  };
}

// Fold a newer patch into an older one. Used to accumulate successive local
// edits (e.g. the user toggles pinned, then archived, both while offline).
// Newer field values win; when both sides have a partial `tagRoles`, merge
// them key-by-key so changes on disjoint keys both survive.
export function mergeSettingsPatches(
  older: LensSettingsPatch | null,
  newer: LensSettingsPatch,
): LensSettingsPatch {
  if (!older) return { ...newer, tagRoles: newer.tagRoles ? { ...newer.tagRoles } : undefined };
  const merged: LensSettingsPatch = {};
  if (newer.schemaVersion !== undefined || older.schemaVersion !== undefined) {
    merged.schemaVersion = newer.schemaVersion ?? older.schemaVersion;
  }
  if (newer.tagRoles || older.tagRoles) {
    merged.tagRoles = { ...(older.tagRoles ?? {}), ...(newer.tagRoles ?? {}) };
  }
  return merged;
}

// ---------------------------------------------------------------------------
// localStorage cache
//
// The cache tracks (a) what the UI should render (`settings`), (b) what the
// server last showed us (`serverSettings` + `serverUpdatedAt`), and (c) any
// locally-pending edits as a patch (`dirtyPatch`). Keeping the patch around
// — instead of only "next" — lets the reconcile and drain paths re-apply the
// patch onto whatever the server currently has, preserving fields that other
// devices may have touched between our fetch and our write.
// ---------------------------------------------------------------------------

const CACHE_PREFIX = "lens:settings:";

function cacheKey(vaultId: string): string {
  return CACHE_PREFIX + vaultId;
}

export interface SettingsCacheEntry {
  // Rendered view (server ⊕ dirtyPatch). Stored directly so cold-mount paint
  // doesn't need to recompute.
  settings: LensSettings;
  // Last-known server-authored state. Null before the first successful fetch.
  serverSettings: LensSettings | null;
  // `updated_at` of the settings note as we last observed it. The `if_updated_at`
  // baseline for the next PATCH. Null when the note hasn't been written.
  serverUpdatedAt: string | null;
  // True once we've confirmed the note exists on the vault. Lets us pick POST
  // vs. PATCH for the first write without another round-trip.
  noteExists: boolean;
  // Accumulated locally-pending edits that haven't been confirmed on the
  // server. Null when clean. Persisted so a reboot-while-offline still flushes
  // on the next successful fetch.
  dirtyPatch: LensSettingsPatch | null;
}

function cleanEntry(settings: LensSettings | null): SettingsCacheEntry {
  const base = settings ?? { ...DEFAULT_LENS_SETTINGS, tagRoles: { ...DEFAULT_TAG_ROLES } };
  return {
    settings: base,
    serverSettings: settings,
    serverUpdatedAt: null,
    noteExists: false,
    dirtyPatch: null,
  };
}

export function loadCachedSettings(vaultId: string): SettingsCacheEntry | null {
  try {
    const raw = localStorage.getItem(cacheKey(vaultId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SettingsCacheEntry>;
    if (!parsed || typeof parsed !== "object") return null;
    const serverSettings =
      parsed.serverSettings === null
        ? null
        : parsed.serverSettings
          ? normalizeLensSettings(parsed.serverSettings)
          : null;
    const dirtyPatch = parsed.dirtyPatch ?? null;
    const base = serverSettings ?? { ...DEFAULT_LENS_SETTINGS, tagRoles: { ...DEFAULT_TAG_ROLES } };
    const settings = dirtyPatch
      ? applySettingsPatch(base, dirtyPatch)
      : normalizeLensSettings(parsed.settings ?? base);
    return {
      settings,
      serverSettings,
      serverUpdatedAt: typeof parsed.serverUpdatedAt === "string" ? parsed.serverUpdatedAt : null,
      noteExists: parsed.noteExists === true,
      dirtyPatch,
    };
  } catch {
    return null;
  }
}

export function saveCachedSettings(vaultId: string, entry: SettingsCacheEntry): void {
  try {
    localStorage.setItem(cacheKey(vaultId), JSON.stringify(entry));
  } catch {
    // storage unavailable — best-effort only
  }
}

export function deleteCachedSettings(vaultId: string): void {
  try {
    localStorage.removeItem(cacheKey(vaultId));
  } catch {
    // storage unavailable — best-effort only
  }
}

// One-time migration from legacy per-vault localStorage. Leaves the legacy
// `lens:tag-roles:<vaultId>` key in place so a same-device rollback still
// finds its data; a follow-up release cycle will clean it up.
function seedFromLegacyTagRoles(vaultId: string): SettingsCacheEntry | null {
  if (typeof localStorage === "undefined") return null;
  if (!localStorage.getItem(`lens:tag-roles:${vaultId}`)) return null;
  const legacyRoles = loadTagRoles(vaultId);
  const patch: LensSettingsPatch = { tagRoles: legacyRoles };
  const settings = applySettingsPatch(DEFAULT_LENS_SETTINGS, patch);
  // Seeded entries are dirty by construction: we've never pushed them up.
  return {
    settings,
    serverSettings: null,
    serverUpdatedAt: null,
    noteExists: false,
    dirtyPatch: patch,
  };
}

function resolveInitialEntry(vaultId: string): SettingsCacheEntry {
  const cached = loadCachedSettings(vaultId);
  if (cached) return cached;
  const seeded = seedFromLegacyTagRoles(vaultId);
  if (seeded) return seeded;
  return cleanEntry(null);
}

// ---------------------------------------------------------------------------
// Write path
//
// `writeSettingsToVault` takes the ORIGINAL patch, not a resolved `next`.
// First-ever write: POST. Has baseline: PATCH (`if_updated_at`). On 409, we
// refetch the note, re-apply the patch onto whatever the server now shows,
// and PATCH with a fresh baseline. Re-applying the patch (instead of sending
// a stale pre-409 `next`) keeps fields that another device may have updated
// between our last fetch and our PATCH.
// ---------------------------------------------------------------------------

export interface WriteSettingsState {
  serverSettings: LensSettings | null;
  serverUpdatedAt: string | null;
  noteExists: boolean;
}

export interface WriteSettingsResult {
  server: LensSettings;
  serverUpdatedAt: string | null;
  noteExists: true;
}

async function writeSettingsToVault(
  client: VaultClient,
  state: WriteSettingsState,
  patch: LensSettingsPatch,
  signal?: AbortSignal,
): Promise<WriteSettingsResult> {
  // First-ever write — the note doesn't exist yet. POST with the patch
  // layered onto defaults (no server state to merge against).
  if (!state.noteExists) {
    const initial = applySettingsPatch(state.serverSettings ?? DEFAULT_LENS_SETTINGS, patch);
    try {
      const created = await client.createNote(
        { path: SETTINGS_NOTE_PATH, content: "", metadata: { lens: initial } },
        { signal },
      );
      return {
        server: initial,
        serverUpdatedAt: created.updatedAt ?? created.createdAt ?? null,
        noteExists: true,
      };
    } catch (err) {
      if (err instanceof VaultConflictError || isPathTakenError(err)) {
        // Another device raced us to create. Fall through to refetch+PATCH.
        return patchWithRefetch(client, patch, signal);
      }
      throw err;
    }
  }

  // Note exists and we have a baseline — optimistic PATCH. We send the patch
  // applied to our last-known server view; if nothing changed upstream that
  // matches what's actually in the vault.
  if (state.serverUpdatedAt && state.serverSettings) {
    try {
      const optimisticMerge = applySettingsPatch(state.serverSettings, patch);
      const updated = await client.updateNote(
        SETTINGS_NOTE_PATH,
        { metadata: { lens: optimisticMerge }, if_updated_at: state.serverUpdatedAt },
        { signal },
      );
      return {
        server: optimisticMerge,
        serverUpdatedAt: updated.updatedAt ?? state.serverUpdatedAt,
        noteExists: true,
      };
    } catch (err) {
      if (err instanceof VaultConflictError) {
        return patchWithRefetch(client, patch, signal);
      }
      throw err;
    }
  }

  // Note exists but baseline or server snapshot is missing — refetch to
  // recover it, then PATCH.
  return patchWithRefetch(client, patch, signal);
}

// Fetch the current server state, merge the caller's patch into it, and
// PATCH with a fresh baseline. Handles the race where the note has been
// deleted between fetches by POSTing a new one.
async function patchWithRefetch(
  client: VaultClient,
  patch: LensSettingsPatch,
  signal?: AbortSignal,
): Promise<WriteSettingsResult> {
  let note: Note | null = null;
  try {
    note = await client.getNote(SETTINGS_NOTE_PATH);
  } catch (err) {
    if (!(err instanceof VaultNotFoundError)) throw err;
    note = null;
  }
  if (!note) {
    const initial = applySettingsPatch(DEFAULT_LENS_SETTINGS, patch);
    const created = await client.createNote(
      { path: SETTINGS_NOTE_PATH, content: "", metadata: { lens: initial } },
      { signal },
    );
    return {
      server: initial,
      serverUpdatedAt: created.updatedAt ?? created.createdAt ?? null,
      noteExists: true,
    };
  }
  const server = extractLensSettings(note);
  const merged = applySettingsPatch(server, patch);
  const baseline = note.updatedAt ?? note.createdAt;
  const updated = await client.updateNote(
    SETTINGS_NOTE_PATH,
    { metadata: { lens: merged }, if_updated_at: baseline },
    { signal },
  );
  return {
    server: merged,
    serverUpdatedAt: updated.updatedAt ?? baseline ?? null,
    noteExists: true,
  };
}

// The vault returns a descriptive error body when creating a note whose path
// is already in use. Different vault versions phrase it differently, so we
// duck-type on a substring of the server's complaint.
function isPathTakenError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("already exists") || msg.includes("duplicate") || msg.includes("conflict");
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export type SettingsStatus = "loading" | "synced" | "queued" | "offline" | "conflict";

export interface UseVaultSettingsResult {
  settings: LensSettings;
  update: (patch: LensSettingsPatch) => Promise<void>;
  status: SettingsStatus;
}

export function useVaultSettings(vaultId: string | null): UseVaultSettingsResult {
  const client = useActiveVaultClient();
  const qc = useQueryClient();
  const { db } = useSync();

  const initial = useMemo<SettingsCacheEntry>(() => {
    if (!vaultId) return cleanEntry(null);
    return resolveInitialEntry(vaultId);
  }, [vaultId]);

  const [entry, setEntry] = useState<SettingsCacheEntry>(initial);
  const [status, setStatus] = useState<SettingsStatus>(client ? "loading" : "offline");

  useEffect(() => {
    setEntry(initial);
    setStatus(client ? "loading" : "offline");
  }, [initial, client]);

  // Remote fetch. On 404 we use defaults but DO NOT eagerly create the note —
  // that happens lazily on the first `update()`. If the cache is dirty from
  // an offline edit (or from the legacy-tag-roles seed), the reconcile below
  // pushes it up on the next fetch.
  const fetchQuery = useQuery({
    queryKey: ["vault-settings", vaultId],
    enabled: !!vaultId && !!client,
    queryFn: async () => {
      try {
        const note = await client!.getNote(SETTINGS_NOTE_PATH);
        if (note) {
          return {
            server: extractLensSettings(note),
            serverUpdatedAt: note.updatedAt ?? note.createdAt ?? null,
            noteExists: true as const,
          };
        }
        return { server: null, serverUpdatedAt: null, noteExists: false as const };
      } catch (err) {
        if (err instanceof VaultNotFoundError) {
          return { server: null, serverUpdatedAt: null, noteExists: false as const };
        }
        throw err;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  // When the fetch lands, reconcile: push a pending dirty local change up, or
  // accept whatever the server has. Intentionally fires only on a fresh fetch,
  // not on every local state change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reconcile only on fresh fetch, not on every local state change
  useEffect(() => {
    if (!vaultId || !client || !fetchQuery.data) return;
    const remote = fetchQuery.data;

    if (entry.dirtyPatch) {
      // Local changes pending → push our version up. Merge our patch onto the
      // server's current state so we don't clobber fields another device
      // touched while we were offline.
      const patch = entry.dirtyPatch;
      void (async () => {
        try {
          const result = await writeSettingsToVault(
            client,
            {
              serverSettings: remote.server,
              serverUpdatedAt: remote.serverUpdatedAt,
              noteExists: remote.noteExists,
            },
            patch,
          );
          const next: SettingsCacheEntry = {
            settings: result.server,
            serverSettings: result.server,
            serverUpdatedAt: result.serverUpdatedAt,
            noteExists: true,
            dirtyPatch: null,
          };
          setEntry(next);
          saveCachedSettings(vaultId, next);
          setStatus("synced");
          qc.invalidateQueries({ queryKey: ["vault-settings", vaultId] });
        } catch {
          setStatus("offline");
        }
      })();
      return;
    }

    // No local pending change — trust the server.
    const nextEntry: SettingsCacheEntry = remote.server
      ? {
          settings: remote.server,
          serverSettings: remote.server,
          serverUpdatedAt: remote.serverUpdatedAt,
          noteExists: true,
          dirtyPatch: null,
        }
      : {
          settings: entry.settings,
          serverSettings: null,
          serverUpdatedAt: null,
          noteExists: false,
          dirtyPatch: null,
        };
    setEntry(nextEntry);
    saveCachedSettings(vaultId, nextEntry);
    setStatus("synced");
  }, [vaultId, client, fetchQuery.data]);

  useEffect(() => {
    if (fetchQuery.isError) setStatus("offline");
  }, [fetchQuery.isError]);

  const update = useCallback(
    async (patch: LensSettingsPatch) => {
      if (!vaultId) return;
      const nextDirty = mergeSettingsPatches(entry.dirtyPatch, patch);
      const nextSettings = applySettingsPatch(
        entry.serverSettings ?? DEFAULT_LENS_SETTINGS,
        nextDirty,
      );

      const optimistic: SettingsCacheEntry = {
        settings: nextSettings,
        serverSettings: entry.serverSettings,
        serverUpdatedAt: entry.serverUpdatedAt,
        noteExists: entry.noteExists,
        dirtyPatch: nextDirty,
      };
      setEntry(optimistic);
      saveCachedSettings(vaultId, optimistic);

      if (!client) {
        setStatus("offline");
        return;
      }

      // When we fall back to the sync queue, we enqueue the ACCUMULATED patch
      // (not `next`) plus our last-known baseline. The drain handler
      // re-fetches the note, re-applies the patch onto the latest server
      // state, and PATCHes with a fresh `if_updated_at`. `force: true` is a
      // last resort after N merge-retries, not the default.
      const enqueueFallback = db
        ? async () => {
            await enqueue(
              db,
              {
                kind: "update-settings",
                notePath: SETTINGS_NOTE_PATH,
                patch: nextDirty,
                baselineUpdatedAt: entry.serverUpdatedAt,
              },
              { vaultId },
            );
            return null as unknown as WriteSettingsResult;
          }
        : null;

      try {
        const result = await withOfflineFallback(
          (signal) =>
            writeSettingsToVault(
              client,
              {
                serverSettings: entry.serverSettings,
                serverUpdatedAt: entry.serverUpdatedAt,
                noteExists: entry.noteExists,
              },
              patch,
              signal,
            ),
          enqueueFallback,
        );
        if (result) {
          const next: SettingsCacheEntry = {
            settings: result.server,
            serverSettings: result.server,
            serverUpdatedAt: result.serverUpdatedAt,
            noteExists: true,
            dirtyPatch: null,
          };
          setEntry(next);
          saveCachedSettings(vaultId, next);
          setStatus("synced");
          qc.invalidateQueries({ queryKey: ["vault-settings", vaultId] });
        } else {
          // Enqueued — leave the cache dirty so a subsequent reconcile knows
          // to try again. `queued` distinguishes "we'll retry via the drain"
          // from plain "offline" (nothing in the queue).
          setStatus(isOffline() ? "offline" : "queued");
        }
      } catch (err) {
        if (err instanceof VaultConflictError) {
          setStatus("conflict");
        } else {
          setStatus("offline");
        }
      }
    },
    [vaultId, client, db, entry, qc],
  );

  return { settings: entry.settings, update, status };
}

// ---------------------------------------------------------------------------
// Tag-roles wrapper — keeps the pre-existing surface the rest of Lens uses.
// Lives here, not in tag-roles.ts, to avoid a cycle (settings imports from
// tag-roles for types and normalization helpers).
// ---------------------------------------------------------------------------

export function useTagRoles(vaultId: string | null): {
  roles: TagRoles;
  setRoles: (next: TagRoles | null) => void;
} {
  const { settings, update } = useVaultSettings(vaultId);
  const setRoles = useCallback(
    (next: TagRoles | null) => {
      if (!vaultId) return;
      const patch = next ?? { ...DEFAULT_TAG_ROLES };
      void update({ tagRoles: normalizeTagRoles(patch) });
    },
    [vaultId, update],
  );
  return { roles: settings.tagRoles, setRoles };
}
