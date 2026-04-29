import { useActiveVaultClient } from "@/lib/vault/queries";
import { useVaultStore } from "@/lib/vault/store";
import type { Note } from "@/lib/vault/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type SavedView,
  type SavedViewFilters,
  VIEWS_PATH_PREFIX,
  decodeView,
  encodeFiltersMetadata,
  pathForName,
} from "./spec";

function invalidateAll(qc: ReturnType<typeof useQueryClient>, activeId: string | null): void {
  qc.invalidateQueries({ queryKey: ["savedViews", activeId] });
  qc.invalidateQueries({ queryKey: ["notes", activeId] });
  qc.invalidateQueries({ queryKey: ["tags", activeId] });
  qc.invalidateQueries({ queryKey: ["vaultInfo", activeId] });
}

// Listing strategy: ask the vault for notes tagged with the role's view tag,
// then filter to the conventional UI/Views/ prefix and decode metadata. The
// path filter is the safety net — a stray "view"-tagged note outside that
// folder shouldn't crash the sidebar.
export function useSavedViews(viewTag: string) {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);

  return useQuery({
    queryKey: ["savedViews", activeId, viewTag],
    enabled: !!client && !!viewTag,
    queryFn: async (): Promise<SavedView[]> => {
      const params = new URLSearchParams();
      params.set("tag", viewTag);
      params.set("path_prefix", VIEWS_PATH_PREFIX);
      params.set("sort", "asc");
      const notes = await client!.queryNotes(params);
      return notes
        .map((n) => decodeView(n))
        .filter((v): v is SavedView => v !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: 30_000,
  });
}

interface SaveArgs {
  name: string;
  filters: SavedViewFilters;
  description?: string;
}

// Creates a fresh saved-view note. Existing-name conflicts surface as the
// vault's normal create error; this PR doesn't auto-overwrite — the dialog
// asks the user for a different name.
export function useSaveView(viewTag: string) {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: SaveArgs): Promise<Note> => {
      if (!client) throw new Error("No active vault");
      return client.createNote({
        path: pathForName(args.name),
        content: args.description ?? "",
        tags: [viewTag],
        metadata: encodeFiltersMetadata(args.filters),
      });
    },
    onSuccess: () => invalidateAll(qc, activeId),
  });
}

interface RenameArgs {
  view: SavedView;
  newName: string;
}

// Rename = move the note to a new `UI/Views/<name>` path. The vault's PATCH
// endpoint accepts `path` for moves. We send `if_updated_at` when the view
// carries a baseline so concurrent edits from another tab/device surface as
// 428, not silent overwrite.
export function useRenameView() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ view, newName }: RenameArgs): Promise<Note> => {
      if (!client) throw new Error("No active vault");
      return client.updateNote(view.id, {
        path: pathForName(newName),
        ...(view.updatedAt ? { if_updated_at: view.updatedAt } : { force: true }),
      });
    },
    onSuccess: () => invalidateAll(qc, activeId),
  });
}

interface UpdateArgs {
  view: SavedView;
  filters: SavedViewFilters;
}

// "Update with current filters" — overwrite the saved-view metadata so the
// existing entry now points at whatever the user has filtered to right now.
// Same baseline semantics as rename.
export function useUpdateView() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ view, filters }: UpdateArgs): Promise<Note> => {
      if (!client) throw new Error("No active vault");
      return client.updateNote(view.id, {
        metadata: encodeFiltersMetadata(filters),
        ...(view.updatedAt ? { if_updated_at: view.updatedAt } : { force: true }),
      });
    },
    onSuccess: () => invalidateAll(qc, activeId),
  });
}

export function useDeleteView() {
  const client = useActiveVaultClient();
  const activeId = useVaultStore((s) => s.activeVaultId);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (view: SavedView): Promise<void> => {
      if (!client) throw new Error("No active vault");
      await client.deleteNote(view.id);
    },
    onSuccess: () => invalidateAll(qc, activeId),
  });
}
