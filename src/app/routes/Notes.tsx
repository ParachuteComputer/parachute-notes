import { PathTree } from "@/components/PathTree";
import { TagBrowser } from "@/components/TagBrowser";
import { normalizeTag } from "@/components/TagEditor";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { meetsAutoThreshold, usePathTreeMode } from "@/lib/path-tree";
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
  useNotesForPathTree,
  usePinnedTags,
  useTagRoles,
  useTags,
  useUpdateNote,
  useVaultStore,
} from "@/lib/vault";
import { VaultAuthError } from "@/lib/vault/client";
import type { Note, TagSummary } from "@/lib/vault/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";

export type NotesPreset = "pinned" | "archived" | "untagged" | "orphaned";

const PRESET_TITLES: Record<NotesPreset, string> = {
  pinned: "Pinned",
  archived: "Archived",
  untagged: "Untagged",
  orphaned: "Orphaned",
};

const PRESET_SUBTITLES: Partial<Record<NotesPreset, string>> = {
  untagged: "Notes without any tags. Add a tag inline to file them.",
  orphaned: "Notes with no inbound or outbound links.",
};

export function Notes({ preset }: { preset?: NotesPreset } = {}) {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const { roles } = useTagRoles(activeVault?.id ?? null);
  const { pinnedTags } = usePinnedTags(activeVault?.id ?? null);
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
  // narrowing. User can add more tags on top via TagFilter. Untagged and
  // orphaned use vault-native filters (has_tags / has_links) instead.
  const effectiveTags = useMemo(() => {
    if (preset === "pinned") return Array.from(new Set([roles.pinned, ...selectedTags]));
    if (preset === "archived") return Array.from(new Set([roles.archived, ...selectedTags]));
    return selectedTags;
  }, [preset, roles.pinned, roles.archived, selectedTags]);

  const effectiveTagMatch: "any" | "all" =
    preset === "pinned" || preset === "archived" ? "all" : tagMatch;

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
      ...(preset === "untagged" ? { hasTags: false } : {}),
      ...(preset === "orphaned" ? { hasLinks: false } : {}),
    }),
    [debouncedSearch, debouncedPrefix, effectiveTags, effectiveTagMatch, sort, offset, preset],
  );

  const notes = useNotes(queryState);
  const tags = useTags();
  const savedViews = useSavedViews(roles.view);
  const saveView = useSaveView(roles.view);
  const pushToast = useToastStore((s) => s.push);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Path tree: independent capped fetch (separate from the filtered list) so
  // the tree stays stable as the user narrows results. Disabled on preset
  // routes (no sidebar) and when the user has set the mode to `never`.
  // Only fetches once the Folders accordion is opened — demoting it into a
  // collapsed <details> would otherwise fire the 5000-note query on every
  // Notes load, which is worst-of-both-worlds (hidden but still expensive).
  const { mode: pathTreeMode } = usePathTreeMode(activeVault?.id ?? null);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const showFoldersAccordion = !preset && pathTreeMode !== "never";
  const treeEnabled = showFoldersAccordion && foldersOpen;
  const treeNotes = useNotesForPathTree(treeEnabled);
  const treePaths = useMemo(() => (treeNotes.data ?? []).map((n) => n.path), [treeNotes.data]);
  const showPathTree =
    treeEnabled &&
    (pathTreeMode === "always" || (pathTreeMode === "auto" && meetsAutoThreshold(treePaths)));

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
  const subtitle = preset ? PRESET_SUBTITLES[preset] : null;
  const pageFirst = offset + 1;
  const pageLast = offset + (displayNotes?.length ?? 0);
  const hasPrev = offset > 0;
  const hasNext = (notes.data?.length ?? 0) === DEFAULT_PAGE_SIZE;
  const filteringActive = isFiltersNonEmpty(currentFilters);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-10">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-3 md:mb-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-fg-dim">{activeVault.name}</p>
          <h1 className="font-serif text-2xl tracking-tight md:text-3xl">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-fg-muted">{subtitle}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
            className="min-h-11 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
          >
            New note
          </Link>
        </div>
      </header>

      {!preset && pinnedTags.length > 0 ? (
        <PinnedTagsStrip
          pinnedTags={pinnedTags}
          tagCounts={tags.data ?? []}
          selected={selectedTags}
          onPick={(name) => {
            setPathPrefix("");
            setSelectedTags((cur) => (cur.length === 1 && cur[0] === name ? [] : [name]));
          }}
        />
      ) : null}

      <div className={preset ? "" : "grid gap-6 md:grid-cols-[14rem_1fr]"}>
        {!preset ? (
          <div className="space-y-3 md:space-y-6">
            <button
              type="button"
              onClick={() => setSidebarOpen((o) => !o)}
              className="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-1.5 text-left text-sm text-fg-muted hover:text-accent md:hidden"
              aria-expanded={sidebarOpen}
              aria-controls="notes-sidebar"
            >
              <span>Folders & saved views</span>
              <span aria-hidden="true" className="font-mono text-xs">
                {sidebarOpen ? "▾" : "▸"}
              </span>
            </button>
            <div
              id="notes-sidebar"
              className={`space-y-6 md:sticky md:top-6 md:self-start ${sidebarOpen ? "" : "hidden md:block"}`}
            >
              <TagBrowser
                tags={tags.data ?? []}
                pinnedTags={pinnedTags}
                selected={selectedTags}
                onToggle={(name) =>
                  setSelectedTags((cur) =>
                    cur.includes(name) ? cur.filter((t) => t !== name) : [...cur, name],
                  )
                }
                onClear={() => setSelectedTags([])}
                isLoading={tags.isPending}
              />
              <BuiltInViewsSidebar />
              <SavedViewsSidebar
                views={savedViews.data}
                isPending={savedViews.isPending}
                error={savedViews.error}
              />
              {showFoldersAccordion ? (
                <details
                  className="group"
                  open={foldersOpen}
                  onToggle={(e) => setFoldersOpen(e.currentTarget.open)}
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-1 py-1 text-xs uppercase tracking-wider text-fg-dim hover:text-accent">
                    <span>Folders</span>
                    <span
                      aria-hidden="true"
                      className="font-mono text-xs transition-transform group-open:rotate-90"
                    >
                      ▸
                    </span>
                  </summary>
                  <div className="mt-2">
                    {showPathTree ? (
                      <PathTree
                        paths={treePaths}
                        vaultId={activeVault.id}
                        currentPrefix={pathPrefix}
                        onSelect={(p) => setPathPrefix(p)}
                      />
                    ) : treeNotes.isLoading ? (
                      <p className="px-1 text-xs text-fg-dim">Loading…</p>
                    ) : (
                      <p className="px-1 text-xs text-fg-dim">
                        Not enough folder variety to show a tree yet.
                      </p>
                    )}
                  </div>
                </details>
              ) : null}
            </div>
          </div>
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
              {preset !== "untagged" ? (
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
              ) : null}
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
            <ol
              aria-label="Notes"
              className="divide-y divide-border rounded-md border border-border bg-card"
            >
              {displayNotes.map((n) => (
                <NoteRow
                  key={n.id}
                  note={n}
                  pinnedTag={roles.pinned}
                  archivedTag={roles.archived}
                  quickTagSuggestions={preset === "untagged" ? (tags.data ?? []) : undefined}
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
                className="min-h-11 rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted enabled:hover:text-accent disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!hasNext}
                onClick={() => setOffset((o) => o + DEFAULT_PAGE_SIZE)}
                className="min-h-11 rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted enabled:hover:text-accent disabled:opacity-40"
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
    <aside>
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
                to={`/?${filtersToSearchParams(v.filters).toString()}`}
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
            className="min-h-11 rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => canSave && onSave(trimmed)}
            disabled={!canSave}
            className="min-h-11 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
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
  quickTagSuggestions,
}: {
  note: Note;
  pinnedTag: string;
  archivedTag: string;
  quickTagSuggestions?: TagSummary[];
}) {
  const label = note.path ?? note.id;
  const stamp = note.updatedAt ?? note.createdAt;
  const isPinned = (note.tags ?? []).includes(pinnedTag);
  const isArchived = (note.tags ?? []).includes(archivedTag);
  return (
    <li className={isArchived ? "opacity-60 italic" : undefined}>
      <div className="flex items-stretch">
        <Link
          to={`/n/${encodeURIComponent(note.id)}`}
          className="block flex-1 min-w-0 min-h-11 px-3 py-2.5 hover:bg-bg/60 focus:bg-bg/60 focus:outline-none md:min-h-0 md:px-4 md:py-3"
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
          {note.tags && note.tags.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {note.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs text-accent"
                >
                  #{t}
                </span>
              ))}
            </div>
          ) : null}
          {note.preview ? (
            <p className="mt-1.5 truncate text-sm text-fg-muted">{note.preview}</p>
          ) : null}
        </Link>
        {quickTagSuggestions ? (
          <div className="shrink-0 px-3 py-3">
            <QuickTagControl
              noteId={note.id}
              existing={note.tags ?? []}
              suggestions={quickTagSuggestions}
            />
          </div>
        ) : null}
      </div>
    </li>
  );
}

function QuickTagControl({
  noteId,
  existing,
  suggestions,
}: {
  noteId: string;
  existing: string[];
  suggestions: TagSummary[];
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const update = useUpdateNote(noteId);
  const pushToast = useToastStore((s) => s.push);

  // Focus the input when opening; close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = normalizeTag(value).toLowerCase();
    const have = new Set(existing.map((t) => t.toLowerCase()));
    const pool = suggestions.filter((t) => !have.has(t.name.toLowerCase()));
    if (!q) return pool.slice(0, 8);
    return pool.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 8);
  }, [value, suggestions, existing]);

  const apply = useCallback(
    async (raw: string) => {
      const tag = normalizeTag(raw);
      if (!tag) return;
      try {
        await update.mutateAsync({ tags: { add: [tag] } });
        pushToast(`Added #${tag}`, "success");
        setValue("");
        setOpen(false);
      } catch (err) {
        pushToast(`Could not add tag: ${(err as Error).message}`, "error");
      }
    },
    [update, pushToast],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border bg-bg/60 px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent"
        aria-label="Add tag"
      >
        + tag
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply(value);
          }
        }}
        placeholder="tag…"
        aria-label="Tag name"
        disabled={update.isPending}
        className="w-32 rounded-md border border-border bg-card px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none disabled:opacity-50"
      />
      {filtered.length > 0 ? (
        <ul
          className="absolute right-0 z-20 mt-1 max-h-48 w-44 overflow-y-auto rounded-md border border-border bg-card text-xs shadow-lg"
          aria-label="Tag suggestions"
        >
          {filtered.map((t) => (
            <li key={t.name}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  apply(t.name);
                }}
                className="flex w-full items-center justify-between px-2 py-1 text-left text-fg hover:bg-bg/60"
              >
                <span className="truncate">{t.name}</span>
                <span className="ml-2 shrink-0 text-fg-dim">{t.count}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PinnedTagsStrip({
  pinnedTags,
  tagCounts,
  selected,
  onPick,
}: {
  pinnedTags: string[];
  tagCounts: TagSummary[];
  selected: string[];
  onPick: (name: string) => void;
}) {
  const countFor = (name: string) =>
    tagCounts.find((t) => t.name.toLowerCase() === name.toLowerCase())?.count;
  return (
    <nav aria-label="Pinned tags" className="mb-6 flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-fg-dim">Pinned tags</span>
      {pinnedTags.map((name) => {
        const active = selected.length === 1 && selected[0] === name;
        const count = countFor(name);
        return (
          <button
            key={name}
            type="button"
            onClick={() => onPick(name)}
            className={
              active
                ? "inline-flex items-center gap-1 rounded-full border border-accent bg-accent px-2.5 py-1 text-xs font-medium text-white"
                : "inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs text-accent hover:border-accent hover:bg-accent/20"
            }
            aria-pressed={active}
          >
            <span>#{name}</span>
            {count !== undefined ? (
              <span className={active ? "text-white/80" : "text-accent/70"}>{count}</span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

function BuiltInViewsSidebar() {
  const items: Array<{ to: string; label: string; glyph?: string }> = [
    { to: "/pinned", label: "Pinned", glyph: "★" },
    { to: "/archived", label: "Archived" },
    { to: "/untagged", label: "Untagged" },
    { to: "/orphaned", label: "Orphaned" },
  ];
  return (
    <aside>
      <h2 className="mb-2 text-xs uppercase tracking-wider text-fg-dim">Views</h2>
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it.to}>
            <Link
              to={it.to}
              className="flex items-center gap-1.5 truncate rounded-md border border-transparent px-2 py-1 text-sm text-fg-muted hover:border-border hover:bg-card hover:text-accent"
            >
              {it.glyph ? (
                <span className="shrink-0 text-accent" aria-hidden="true">
                  {it.glyph}
                </span>
              ) : null}
              <span className="truncate">{it.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
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
