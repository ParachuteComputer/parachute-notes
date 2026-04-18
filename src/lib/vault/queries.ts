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
import type { NoteAttachment } from "./types";

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

export function useUpdateNote(id: string | undefined) {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdateNotePayload) => {
      if (!client || !id) throw new Error("No active vault");
      return client.updateNote(id, payload);
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
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateNotePayload) => {
      if (!client) throw new Error("No active vault");
      return client.createNote(payload);
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
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: { noteId: string; attachmentId: string }) => {
      if (!client) throw new Error("No active vault");
      await client.deleteAttachment(args.noteId, args.attachmentId);
      return args;
    },
    onSuccess: (args) => {
      qc.invalidateQueries({ queryKey: ["note", activeId, args.noteId] });
    },
  });
}

export function useDeleteNote() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!client) throw new Error("No active vault");
      await client.deleteNote(id);
      return id;
    },
    onSuccess: (id) => {
      qc.removeQueries({ queryKey: ["note", activeId, id] });
      qc.invalidateQueries({ queryKey: ["notes", activeId] });
      qc.invalidateQueries({ queryKey: ["tags", activeId] });
      qc.invalidateQueries({ queryKey: ["vaultInfo", activeId] });
    },
  });
}
