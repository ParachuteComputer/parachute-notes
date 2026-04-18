import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { relativeTime } from "@/lib/time";
import {
  DEFAULT_NOTE_QUERY,
  DEFAULT_PAGE_SIZE,
  type NoteQueryState,
  isFilteringActive,
  useNotes,
  useTags,
  useVaultStore,
} from "@/lib/vault";
import { VaultAuthError } from "@/lib/vault/client";
import type { Note, TagSummary } from "@/lib/vault/types";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";

export function Notes() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState("");
  const [pathPrefix, setPathPrefix] = useState("");
  const initialTags = useMemo(() => searchParams.getAll("tag"), [searchParams]);
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTags);
  const [tagMatch, setTagMatch] = useState<"any" | "all">("any");
  const [sort, setSort] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);

  const debouncedSearch = useDebouncedValue(search, 300);
  const debouncedPrefix = useDebouncedValue(pathPrefix, 300);

  // Any filter change resets pagination.
  // biome-ignore lint/correctness/useExhaustiveDependencies: offset is the target, not a trigger
  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, debouncedPrefix, selectedTags, tagMatch, sort]);

  const queryState: NoteQueryState = useMemo(
    () => ({
      ...DEFAULT_NOTE_QUERY,
      search: debouncedSearch,
      pathPrefix: debouncedPrefix,
      tags: selectedTags,
      tagMatch,
      sort,
      offset,
    }),
    [debouncedSearch, debouncedPrefix, selectedTags, tagMatch, sort, offset],
  );

  const notes = useNotes(queryState);
  const tags = useTags();

  if (!activeVault) return <Navigate to="/" replace />;

  const pageFirst = offset + 1;
  const pageLast = offset + (notes.data?.length ?? 0);
  const hasPrev = offset > 0;
  const hasNext = (notes.data?.length ?? 0) === DEFAULT_PAGE_SIZE;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-fg-dim">{activeVault.name}</p>
          <h1 className="font-serif text-3xl tracking-tight">Notes</h1>
        </div>
        <button
          type="button"
          onClick={() => setSort((s) => (s === "desc" ? "asc" : "desc"))}
          className="text-sm text-fg-muted hover:text-accent"
          aria-label="Toggle sort direction"
        >
          Sort: {sort === "desc" ? "newest" : "oldest"} first
        </button>
      </header>

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
        </div>
      </div>

      {notes.isPending ? (
        <SkeletonRows />
      ) : notes.isError ? (
        <ErrorBlock error={notes.error} />
      ) : notes.data && notes.data.length > 0 ? (
        <ol className="divide-y divide-border rounded-md border border-border bg-card">
          {notes.data.map((n) => (
            <NoteRow key={n.id} note={n} />
          ))}
        </ol>
      ) : (
        <EmptyBlock filtering={isFilteringActive(queryState)} />
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
  );
}

function NoteRow({ note }: { note: Note }) {
  const label = note.path ?? note.id;
  const stamp = note.updatedAt ?? note.createdAt;
  return (
    <li>
      <Link
        to={`/notes/${encodeURIComponent(note.id)}`}
        className="block px-4 py-3 hover:bg-bg/60 focus:bg-bg/60 focus:outline-none"
      >
        <div className="flex items-baseline justify-between gap-4">
          <span className="truncate font-mono text-sm text-fg">{label}</span>
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
          <p className="mb-1 text-fg-muted">This vault has no notes yet.</p>
          <p className="text-sm text-fg-dim">Creating notes lands in a later PR.</p>
        </>
      )}
    </div>
  );
}
