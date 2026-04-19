import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useSaveView, useSavedViews } from "@/lib/saved-views/queries";
import {
  type SavedView,
  type SavedViewFilters,
  filtersToSearchParams,
  isFiltersNonEmpty,
  searchParamsToFilters,
} from "@/lib/saved-views/spec";
import { relativeTime } from "@/lib/time";
import { useToastStore } from "@/lib/toast/store";
import {
  DEFAULT_NOTE_QUERY,
  DEFAULT_PAGE_SIZE,
  type NoteQueryState,
  isFilteringActive,
  useNotes,
  useTagRoles,
  useTags,
  useVaultStore,
} from "@/lib/vault";
import { VaultAuthError } from "@/lib/vault/client";
import type { Note, TagSummary } from "@/lib/vault/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";

export type NotesPreset = "pinned" | "archived";

const PRESET_TITLES: Record<NotesPreset, string> = {
  pinned: "Pinned",
  archived: "Archived",
};

export function Notes({ preset }: { preset?: NotesPreset } = {}) {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const { roles } = useTagRoles(activeVault?.id ?? null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Hydrate filter state from URL on mount and when the URL changes
  // externally (clicking a saved view rewrites params). Sync direction is
  // local-state → URL; we track the last-known URL signature to avoid an
  // immediate echo loop after a user edit.
  const initial = useMemo(() => searchParamsToFilters(searchParams), [searchParams]);
  const [search, setSearch] = useState(initial.search ?? "");
  const [pathPrefix, setPathPrefix] = useState(initial.pathPrefix ?? "");
  const [selectedTags, setSelectedTags] = useState<string[]>(initial.tags ?? []);
  const [tagMatch, setTagMatch] = useState<"any" | "all">(initial.tagMatch ?? "any");
  const [sort, setSort] = useState<"asc" | "desc">(initial.sort ?? "desc");
  const [showArchived, setShowArchived] = useState(initial.showArchived ?? false);
  const [offset, setOffset] = useState(0);

  // Re-sync from URL when navigating between saved views without remount.
  // Keyed on the params signature so updates from local state (which write
  // back to the URL) don't loop.
  const urlSignature = useMemo(() => searchParams.toString(), [searchParams]);
  useEffect(() => {
    const f = searchParamsToFilters(new URLSearchParams(urlSignature));
    setSearch(f.search ?? "");
    setPathPrefix(f.pathPrefix ?? "");
    setSelectedTags(f.tags ?? []);
    setTagMatch(f.tagMatch ?? "any");
    setSort(f.sort ?? "desc");
    setShowArchived(f.showArchived ?? false);
  }, [urlSignature]);

  const debouncedSearch = useDebouncedValue(search, 300);
  const debouncedPrefix = useDebouncedValue(pathPrefix, 300);

  // Push the current filter state back to the URL so it's shareable and so
  // saved-view linking is symmetric. Skip on preset routes (/pinned,
  // /archived) — those have their own canonical URL.
  // biome-ignore lint/correctness/useExhaustiveDependencies: writes only when filter dimensions change
  useEffect(() => {
    if (preset) return;
    const next: SavedViewFilters = {
      search: debouncedSearch,
      tags: selectedTags,
      tagMatch,
      pathPrefix: debouncedPrefix,
      sort,
      showArchived,
    };
    const desired = filtersToSearchParams(next).toString();
    if (desired !== urlSignature) {
      setSearchParams(filtersToSearchParams(next), { replace: true });
    }
  }, [preset, debouncedSearch, debouncedPrefix, selectedTags, tagMatch, sort, showArchived]);

  // Merge the preset role tag into the query so vault-side filter does the
  // narrowing. User can add more tags on top via TagFilter.
  const effectiveTags = useMemo(() => {
    if (preset === "pinned") return Array.from(new Set([roles.pinned, ...selectedTags]));
    if (preset === "archived") return Array.from(new Set([roles.archived, ...selectedTags]));
    return selectedTags;
  }, [preset, roles.pinned, roles.archived, selectedTags]);

  const effectiveTagMatch: "any" | "all" = preset ? "all" : tagMatch;

  // Any filter change resets pagination.
  // biome-ignore lint/correctness/useExhaustiveDependencies: offset is the target, not a trigger
  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, debouncedPrefix, effectiveTags, effectiveTagMatch, sort, showArchived]);

  const queryState: NoteQueryState = useMemo(
    () => ({
      ...DEFAULT_NOTE_QUERY,
      search: debouncedSearch,
      pathPrefix: debouncedPrefix,
      tags: effectiveTags,
      tagMatch: effectiveTagMatch,
      sort,
      offset,
    }),
    [debouncedSearch, debouncedPrefix, effectiveTags, effectiveTagMatch, sort, offset],
  );

  const notes = useNotes(queryState);
  const tags = useTags();
  const savedViews = useSavedViews(roles.view);
  const saveView = useSaveView(roles.view);
  const pushToast = useToastStore((s) => s.push);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const currentFilters: SavedViewFilters = useMemo(
    () => ({
      search: debouncedSearch,
      tags: selectedTags,
      tagMatch,
      pathPrefix: debouncedPrefix,
      sort,
      showArchived,
    }),
    [debouncedSearch, debouncedPrefix, selectedTags, tagMatch, sort, showArchived],
  );

  const onSaveView = useCallback(
    async (name: string) => {
      try {
        await saveView.mutateAsync({ name, filters: currentFilters });
        pushToast(`Saved view "${name}".`, "success");
        setShowSaveDialog(false);
      } catch (err) {
        pushToast(`Could not save view: ${(err as Error).message}`, "error");
      }
    },
    [saveView, currentFilters, pushToast],
  );

  // Client-side post-process: hide archived on default list unless toggled, and
  // pinned-first stable sort on default list. Preset views skip both.
  const displayNotes = useMemo(() => {
    if (!notes.data) return notes.data;
    let list = notes.data;
    if (!preset && !showArchived) {
      list = list.filter((n) => !(n.tags ?? []).includes(roles.archived));
    }
    if (!preset) {
      const pinnedTag = roles.pinned;
      list = [...list].sort((a, b) => {
        const ap = (a.tags ?? []).includes(pinnedTag) ? 0 : 1;
        const bp = (b.tags ?? []).includes(pinnedTag) ? 0 : 1;
        return ap - bp;
      });
    }
    return list;
  }, [notes.data, preset, showArchived, roles.archived, roles.pinned]);

  if (!activeVault) return <Navigate to="/" replace />;

  const title = preset ? PRESET_TITLES[preset] : "Notes";
  const pageFirst = offset + 1;
  const pageLast = offset + (displayNotes?.length ?? 0);
  const hasPrev = offset > 0;
  const hasNext = (notes.data?.length ?? 0) === DEFAULT_PAGE_SIZE;
  const filteringActive = isFiltersNonEmpty(currentFilters);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-fg-dim">{activeVault.name}</p>
          <h1 className="font-serif text-3xl tracking-tight">{title}</h1>
        </div>
        <div className="flex items-center gap-4">
          {!preset ? (
            <label className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-accent">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Show archived
            </label>
          ) : null}
          <button
            type="button"
            onClick={() => setSort((s) => (s === "desc" ? "asc" : "desc"))}
            className="text-sm text-fg-muted hover:text-accent"
            aria-label="Toggle sort direction"
          >
            Sort: {sort === "desc" ? "newest" : "oldest"} first
          </button>
          <Link
            to="/new"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
          >
            New note
          </Link>
        </div>
      </header>

      <div className={preset ? "" : "grid gap-6 md:grid-cols-[14rem_1fr]"}>
        {!preset ? (
          <SavedViewsSidebar
            views={savedViews.data}
            isPending={savedViews.isPending}
            error={savedViews.error}
          />
        ) : null}

        <div>
          <div className="mb-6 space-y-3">
            <input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
              aria-label="Search notes"
            />
            <div className="flex flex-wrap items-start gap-3">
              <input
                type="text"
                placeholder="Path starts with…"
                value={pathPrefix}
                onChange={(e) => setPathPrefix(e.target.value)}
                className="flex-1 min-w-48 rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-fg focus:border-accent focus:outline-none"
                aria-label="Filter by path prefix"
              />
              <TagFilter
                tags={tags.data ?? []}
                selected={selectedTags}
                onToggle={(name) =>
                  setSelectedTags((cur) =>
                    cur.includes(name) ? cur.filter((t) => t !== name) : [...cur, name],
                  )
                }
                tagMatch={tagMatch}
                onTagMatchChange={setTagMatch}
                onClear={() => setSelectedTags([])}
              />
              {!preset && filteringActive ? (
                <button
                  type="button"
                  onClick={() => setShowSaveDialog(true)}
                  className="rounded-md border border-accent/60 bg-accent/10 px-3 py-2 text-sm text-accent hover:bg-accent/20"
                >
                  Save view…
                </button>
              ) : null}
            </div>
          </div>

          {notes.isPending ? (
            <SkeletonRows />
          ) : notes.isError ? (
            <ErrorBlock error={notes.error} />
          ) : displayNotes && displayNotes.length > 0 ? (
            <ol className="divide-y divide-border rounded-md border border-border bg-card">
              {displayNotes.map((n) => (
                <NoteRow
                  key={n.id}
                  note={n}
                  pinnedTag={roles.pinned}
                  archivedTag={roles.archived}
                />
              ))}
            </ol>
          ) : (
            <EmptyBlock filtering={isFilteringActive(queryState) || !!preset} />
          )}

          <div className="mt-6 flex items-center justify-between text-sm text-fg-dim">
            <span>
              {notes.data && notes.data.length > 0
                ? `Showing ${pageFirst}–${pageLast}`
                : notes.isFetching
                  ? "Loading…"
                  : ""}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!hasPrev}
                onClick={() => setOffset((o) => Math.max(0, o - DEFAULT_PAGE_SIZE))}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted enabled:hover:text-accent disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!hasNext}
                onClick={() => setOffset((o) => o + DEFAULT_PAGE_SIZE)}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted enabled:hover:text-accent disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      {showSaveDialog ? (
        <SaveViewDialog
          existing={savedViews.data ?? []}
          isSaving={saveView.isPending}
          onCancel={() => setShowSaveDialog(false)}
          onSave={onSaveView}
        />
      ) : null}
    </div>
  );
}

function SavedViewsSidebar({
  views,
  isPending,
  error,
}: {
  views: SavedView[] | undefined;
  isPending: boolean;
  error: Error | null;
}) {
  return (
    <aside className="md:sticky md:top-6 md:self-start">
      <h2 className="mb-2 text-xs uppercase tracking-wider text-fg-dim">Saved views</h2>
      {isPending ? (
        <p className="text-xs text-fg-dim">Loading…</p>
      ) : error ? (
        <p className="text-xs text-red-400">Could not load views.</p>
      ) : !views || views.length === 0 ? (
        <p className="text-xs text-fg-dim">
          None yet. Apply a filter and click “Save view” to add one.
        </p>
      ) : (
        <ul className="space-y-1" aria-label="Saved views">
          {views.map((v) => (
            <li key={v.id}>
              <Link
                to={`/notes?${filtersToSearchParams(v.filters).toString()}`}
                className="block truncate rounded-md border border-transparent px-2 py-1 text-sm text-fg-muted hover:border-border hover:bg-card hover:text-accent"
              >
                {v.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function SaveViewDialog({
  existing,
  isSaving,
  onCancel,
  onSave,
}: {
  existing: SavedView[];
  isSaving: boolean;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const collides = existing.some((v) => v.name.toLowerCase() === trimmed.toLowerCase());
  const canSave = trimmed.length > 0 && !collides && !isSaving;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> requires imperative showModal()/close(); we want declarative open=showSaveDialog
      role="dialog"
      aria-modal="true"
      aria-label="Save view"
    >
      <div className="w-full max-w-sm rounded-md border border-border bg-card p-5">
        <h3 className="mb-3 font-serif text-lg text-fg">Save view</h3>
        <label className="block text-sm">
          <span className="mb-1 block text-fg-muted">Name</span>
          <input
            type="text"
            value={name}
            // biome-ignore lint/a11y/noAutofocus: dialog focus
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) onSave(trimmed);
              if (e.key === "Escape") onCancel();
            }}
            placeholder="e.g. Daily journal"
            aria-label="View name"
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
          />
        </label>
        {collides ? (
          <p className="mt-2 text-xs text-red-400">A view with that name already exists.</p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => canSave && onSave(trimmed)}
            disabled={!canSave}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NoteRow({
  note,
  pinnedTag,
  archivedTag,
}: { note: Note; pinnedTag: string; archivedTag: string }) {
  const label = note.path ?? note.id;
  const stamp = note.updatedAt ?? note.createdAt;
  const isPinned = (note.tags ?? []).includes(pinnedTag);
  const isArchived = (note.tags ?? []).includes(archivedTag);
  return (
    <li className={isArchived ? "opacity-60 italic" : undefined}>
      <Link
        to={`/notes/${encodeURIComponent(note.id)}`}
        className="block px-4 py-3 hover:bg-bg/60 focus:bg-bg/60 focus:outline-none"
      >
        <div className="flex items-baseline justify-between gap-4">
          <span className="flex min-w-0 items-baseline gap-1.5">
            {isPinned ? (
              <span className="shrink-0 text-accent" aria-label="pinned" title="pinned">
                ★
              </span>
            ) : null}
            <span className="truncate font-mono text-sm text-fg">{label}</span>
          </span>
          <span className="shrink-0 text-xs text-fg-dim">{relativeTime(stamp)}</span>
        </div>
        {note.preview ? (
          <p className="mt-1 truncate text-sm text-fg-muted">{note.preview}</p>
        ) : null}
        {note.tags && note.tags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {note.tags.map((t) => (
              <span
                key={t}
                className="rounded-full border border-border bg-bg/60 px-2 py-0.5 text-xs text-fg-dim"
              >
                {t}
              </span>
            ))}
          </div>
        ) : null}
      </Link>
    </li>
  );
}

function TagFilter({
  tags,
  selected,
  onToggle,
  tagMatch,
  onTagMatchChange,
  onClear,
}: {
  tags: TagSummary[];
  selected: string[];
  onToggle: (name: string) => void;
  tagMatch: "any" | "all";
  onTagMatchChange: (mode: "any" | "all") => void;
  onClear: () => void;
}) {
  return (
    <details className="rounded-md border border-border bg-card text-sm">
      <summary className="cursor-pointer list-none px-3 py-2 text-fg-muted hover:text-accent">
        Tags{selected.length > 0 ? ` (${selected.length})` : ""}
      </summary>
      <div className="border-t border-border p-3">
        {selected.length > 1 ? (
          <fieldset className="mb-3 flex items-center gap-3 text-xs">
            <legend className="sr-only">Match mode</legend>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="tag-match"
                value="any"
                checked={tagMatch === "any"}
                onChange={() => onTagMatchChange("any")}
              />
              Any
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="tag-match"
                value="all"
                checked={tagMatch === "all"}
                onChange={() => onTagMatchChange("all")}
              />
              All
            </label>
            <button
              type="button"
              onClick={onClear}
              className="ml-auto text-xs text-fg-dim hover:text-accent"
            >
              Clear
            </button>
          </fieldset>
        ) : null}
        {tags.length === 0 ? (
          <p className="text-xs text-fg-dim">No tags in this vault.</p>
        ) : (
          <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {tags.map((t) => (
              <li key={t.name}>
                <label className="flex items-center gap-2 text-sm text-fg hover:text-accent">
                  <input
                    type="checkbox"
                    checked={selected.includes(t.name)}
                    onChange={() => onToggle(t.name)}
                  />
                  <span className="flex-1 truncate">{t.name}</span>
                  <span className="text-xs text-fg-dim">{t.count}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function SkeletonRows() {
  return (
    <ol className="divide-y divide-border rounded-md border border-border bg-card" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="px-4 py-3">
          <div className="h-4 w-1/3 animate-pulse rounded bg-border/60" />
          <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-border/40" />
        </li>
      ))}
    </ol>
  );
}

function ErrorBlock({ error }: { error: Error }) {
  const isAuth = error instanceof VaultAuthError;
  return (
    <div className="rounded-md border border-red-500/30 bg-red-500/5 p-6">
      <p className="mb-2 font-medium text-red-400">
        {isAuth ? "Session expired" : "Could not load notes"}
      </p>
      <p className="mb-4 text-sm text-fg-muted">{error.message}</p>
      {isAuth ? (
        <Link
          to="/add"
          className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Reconnect vault
        </Link>
      ) : null}
    </div>
  );
}

function EmptyBlock({ filtering }: { filtering: boolean }) {
  return (
    <div className="rounded-md border border-border bg-card p-10 text-center">
      {filtering ? (
        <p className="text-fg-muted">No notes match these filters.</p>
      ) : (
        <>
          <p className="mb-3 text-fg-muted">This vault has no notes yet.</p>
          <Link
            to="/new"
            className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Create one
          </Link>
        </>
      )}
    </div>
  );
}
