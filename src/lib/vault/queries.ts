import type { LensDB } from "@/lib/sync/db";
import { newLocalId } from "@/lib/sync/id-map";
import { enqueue } from "@/lib/sync/queue";
import { useSync } from "@/providers/SyncProvider";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  type CreateNotePayload,
  type StorageUploadResult,
  type UpdateNotePayload,
  type UploadProgress,
  VaultClient,
} from "./client";
import { type NoteQueryState, buildNoteQueryParams } from "./note-query";
import { loadToken } from "./storage";
import { useVaultStore } from "./store";
import type { Note, NoteAttachment } from "./types";

export function useActiveVaultClient(): VaultClient | null {
  const vault = useVaultStore((s) => s.getActiveVault());
  const activeId = useVaultStore((s) => s.activeVaultId);
  return useMemo(() => {
    if (!vault || !activeId) return null;
    const token = loadToken(activeId);
    if (!token) return null;
    return new VaultClient({ vaultUrl: vault.url, accessToken: token.accessToken });
  }, [vault, activeId]);
}

export function useVaultInfo() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);

  return useQuery({
    queryKey: ["vaultInfo", activeId],
    enabled: !!client,
    queryFn: () => client!.vaultInfo(true),
    staleTime: 30_000,
  });
}

export function useNotes(queryState: NoteQueryState) {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);

  return useQuery({
    queryKey: ["notes", activeId, queryState],
    enabled: !!client,
    queryFn: () => client!.queryNotes(buildNoteQueryParams(queryState)),
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });
}

// Cap on how many notes to pull back for the full-vault graph in v1.
// If a vault grows beyond this, the graph page will show the first N —
// pagination/sampling is a future PR.
export const VAULT_GRAPH_NOTE_CAP = 5000;

// Lightweight variant for the Cmd+K switcher: no links, no content — just
// enough to render a title/path/tags line per entry. Capped at the same N
// as the graph so huge vaults degrade gracefully (pagination is a later PR).
export function useAllNotesForSwitcher(enabled: boolean) {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);

  return useQuery({
    queryKey: ["allNotesForSwitcher", activeId],
    enabled: !!client && enabled,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("include_content", "true");
      params.set("limit", String(VAULT_GRAPH_NOTE_CAP));
      return client!.queryNotes(params);
    },
    staleTime: 60_000,
  });
}

// Fetches a capped window of recent notes (by vault's default sort, desc) for
// date-grouped surfaces like /today and /calendar. The vault has no date-range
// filter, so we client-side bucket. A vault with more than the cap gets the
// most-recent N — older days on the calendar show empty.
export function useNotesForDateViews() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);

  return useQuery({
    queryKey: ["notesForDateViews", activeId],
    enabled: !!client,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("sort", "desc");
      params.set("limit", String(VAULT_GRAPH_NOTE_CAP));
      return client!.queryNotes(params);
    },
    staleTime: 60_000,
  });
}

// Fetches a capped metadata-only window of the vault for the path-tree
// sidebar. We want a stable index of every path so the tree and threshold
// check aren't skewed by whatever filter is currently applied to the main
// list. Capped at VAULT_GRAPH_NOTE_CAP; vaults beyond that get a tree for
// the most-recent N paths (the fallback input on the filter bar still works
// for navigating outside the window).
export function useNotesForPathTree(enabled: boolean) {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);

  return useQuery({
    queryKey: ["notesForPathTree", activeId],
    enabled: !!client && enabled,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("sort", "desc");
      params.set("limit", String(VAULT_GRAPH_NOTE_CAP));
      return client!.queryNotes(params);
    },
    staleTime: 60_000,
  });
}

export function useAllNotesWithLinks() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);

  return useQuery({
    queryKey: ["allNotesWithLinks", activeId],
    enabled: !!client,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("include_links", "true");
      params.set("limit", String(VAULT_GRAPH_NOTE_CAP));
      return client!.queryNotes(params);
    },
    staleTime: 60_000,
  });
}

export function useTags() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);

  return useQuery({
    queryKey: ["tags", activeId],
    enabled: !!client,
    queryFn: () => client!.listTags(),
    staleTime: 60_000,
  });
}

export function useNote(id: string | undefined) {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);

  return useQuery({
    queryKey: ["note", activeId, id],
    enabled: !!client && !!id,
    queryFn: () => client!.getNote(id!, { includeLinks: true, includeAttachments: true }),
    staleTime: 10_000,
  });
}

// Offline policy for mutations: we don't trust `navigator.onLine` alone. In the
// installed-PWA standalone mode (caught 2026-04-21, issue #61) airplane mode
// leaves `onLine === true` on Android Chrome, and a service worker can also
// intercept the POST and never settle its fetch promise. So the policy is:
//
//   1. If we can see we're offline AND we have somewhere to enqueue, skip the
//      network attempt entirely — cheap, no-wait enqueue.
//   2. Otherwise try the network with a bounded AbortController timeout.
//   3. If the network call rejects (error, abort, or timeout) and we have the
//      sync DB available, enqueue the mutation and return the optimistic row.
//   4. If there's nowhere to enqueue, re-throw — that's a genuine config fail.
//
// Callers keep the same signature; the returned Note is optimistic (local id +
// local timestamps) and is replaced by the server-authored one when the drain
// lands.
const OFFLINE_FALLBACK_MS = 8_000;

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export async function withOfflineFallback<T>(
  online: (signal: AbortSignal) => Promise<T>,
  enqueueFallback: (() => Promise<T>) | null,
): Promise<T> {
  if (enqueueFallback && isOffline()) {
    return enqueueFallback();
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("offline-timeout")), OFFLINE_FALLBACK_MS);
  try {
    return await online(ctrl.signal);
  } catch (err) {
    if (enqueueFallback) return enqueueFallback();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function optimisticCreatedNote(payload: CreateNotePayload, localId: string): Note {
  const now = new Date().toISOString();
  return {
    id: localId,
    path: payload.path,
    createdAt: now,
    updatedAt: now,
    tags: payload.tags,
    metadata: payload.metadata,
    content: payload.content,
  };
}

async function enqueueCreate(
  db: LensDB,
  vaultId: string,
  payload: CreateNotePayload,
): Promise<Note> {
  const localId = newLocalId();
  await enqueue(db, { kind: "create-note", localId, payload }, { vaultId });
  return optimisticCreatedNote(payload, localId);
}

async function enqueueUpdate(
  db: LensDB,
  vaultId: string,
  targetId: string,
  payload: UpdateNotePayload,
  existing: Note | undefined,
): Promise<Note> {
  await enqueue(db, { kind: "update-note", targetId, payload }, { vaultId });
  const base: Note = existing ?? { id: targetId, createdAt: new Date().toISOString() };
  return {
    ...base,
    ...(payload.content !== undefined && { content: payload.content }),
    ...(payload.path !== undefined && { path: payload.path }),
    ...(payload.metadata !== undefined && { metadata: payload.metadata }),
    updatedAt: new Date().toISOString(),
  };
}

export function useUpdateNote(id: string | undefined) {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const { db } = useSync();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdateNotePayload) => {
      if (!id) throw new Error("No note id");
      const fallback =
        db && activeId
          ? () => {
              const existing = qc.getQueryData<Note>(["note", activeId, id]);
              return enqueueUpdate(db, activeId, id, payload, existing);
            }
          : null;
      return withOfflineFallback((signal) => {
        if (!client) throw new Error("No active vault");
        return client.updateNote(id, payload, { signal });
      }, fallback);
    },
    onSuccess: (updated) => {
      qc.setQueryData(["note", activeId, id], updated);
      qc.invalidateQueries({ queryKey: ["notes", activeId] });
      qc.invalidateQueries({ queryKey: ["tags", activeId] });
      // If the path changed (→ new id), also seed the new key.
      if (updated?.id && updated.id !== id) {
        qc.setQueryData(["note", activeId, updated.id], updated);
      }
    },
  });
}

export function useCreateNote() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const { db } = useSync();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateNotePayload) => {
      const fallback = db && activeId ? () => enqueueCreate(db, activeId, payload) : null;
      return withOfflineFallback((signal) => {
        if (!client) throw new Error("No active vault");
        return client.createNote(payload, { signal });
      }, fallback);
    },
    onSuccess: (created) => {
      qc.setQueryData(["note", activeId, created.id], created);
      qc.invalidateQueries({ queryKey: ["notes", activeId] });
      qc.invalidateQueries({ queryKey: ["tags", activeId] });
      qc.invalidateQueries({ queryKey: ["vaultInfo", activeId] });
    },
  });
}

export function useUploadStorageFile() {
  const client = useActiveVaultClient();
  return useMutation({
    mutationFn: async (args: {
      file: File;
      onProgress?: (p: UploadProgress) => void;
      signal?: AbortSignal;
    }): Promise<StorageUploadResult> => {
      if (!client) throw new Error("No active vault");
      return client.uploadStorageFile(args.file, {
        onProgress: args.onProgress,
        signal: args.signal,
      });
    },
  });
}

export function useLinkAttachment() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      noteId: string;
      path: string;
      mimeType: string;
    }): Promise<NoteAttachment> => {
      if (!client) throw new Error("No active vault");
      return client.linkAttachment(args.noteId, { path: args.path, mimeType: args.mimeType });
    },
    onSuccess: (_att, args) => {
      qc.invalidateQueries({ queryKey: ["note", activeId, args.noteId] });
    },
  });
}

export function useDeleteAttachment() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const { db } = useSync();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: { noteId: string; attachmentId: string }) => {
      if (isOffline() && db && activeId) {
        await enqueue(
          db,
          { kind: "delete-attachment", noteId: args.noteId, attachmentId: args.attachmentId },
          { vaultId: activeId },
        );
        return args;
      }
      if (!client) throw new Error("No active vault");
      await client.deleteAttachment(args.noteId, args.attachmentId);
      return args;
    },
    onSuccess: (args) => {
      qc.invalidateQueries({ queryKey: ["note", activeId, args.noteId] });
    },
  });
}

export function useRenameTag() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      oldName: string;
      newName: string;
    }): Promise<{ renamed: number }> => {
      if (!client) throw new Error("No active vault");
      return client.renameTag(args.oldName, args.newName);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tags", activeId] });
      qc.invalidateQueries({ queryKey: ["notes", activeId] });
      qc.invalidateQueries({ queryKey: ["vaultInfo", activeId] });
    },
  });
}

export function useMergeTags() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      sources: string[];
      target: string;
    }): Promise<{ merged: Record<string, number>; target: string }> => {
      if (!client) throw new Error("No active vault");
      return client.mergeTags(args.sources, args.target);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tags", activeId] });
      qc.invalidateQueries({ queryKey: ["notes", activeId] });
      qc.invalidateQueries({ queryKey: ["vaultInfo", activeId] });
    },
  });
}

export function useDeleteNote() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const { db } = useSync();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const fallback =
        db && activeId
          ? async () => {
              await enqueue(db, { kind: "delete-note", targetId: id }, { vaultId: activeId });
              return id;
            }
          : null;
      return withOfflineFallback(async (signal) => {
        if (!client) throw new Error("No active vault");
        await client.deleteNote(id, { signal });
        return id;
      }, fallback);
    },
    onSuccess: (id) => {
      qc.removeQueries({ queryKey: ["note", activeId, id] });
      qc.invalidateQueries({ queryKey: ["notes", activeId] });
      qc.invalidateQueries({ queryKey: ["tags", activeId] });
      qc.invalidateQueries({ queryKey: ["vaultInfo", activeId] });
    },
  });
}
