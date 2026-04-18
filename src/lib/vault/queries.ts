import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { VaultClient } from "./client";
import { type NoteQueryState, buildNoteQueryParams } from "./note-query";
import { loadToken } from "./storage";
import { useVaultStore } from "./store";

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
