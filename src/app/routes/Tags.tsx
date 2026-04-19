import { TagRenameDialog } from "@/components/TagRenameDialog";
import { useMergeTags, useRenameTag, useTags, useVaultStore } from "@/lib/vault";
import { VaultAuthError } from "@/lib/vault/client";
import type { TagSummary } from "@/lib/vault/types";
import { useSync } from "@/providers/SyncProvider";
import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router";

type SortMode = "count" | "alpha";

export function Tags() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const tags = useTags();
  const { isOnline } = useSync();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("count");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);

  const renameMut = useRenameTag();
  const mergeMut = useMergeTags();

  const visible = useMemo(
    () => filterAndSort(tags.data ?? [], search, sort),
    [tags.data, search, sort],
  );
  const tagNames = useMemo(() => (tags.data ?? []).map((t) => t.name), [tags.data]);

  const toggleSelected = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  if (!activeVault) return <Navigate to="/" replace />;

  const selectedCount = selected.size;
  const offline = !isOnline;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-fg-dim">{activeVault.name}</p>
          <h1 className="font-serif text-3xl tracking-tight">Tags</h1>
        </div>
        <button
          type="button"
          onClick={() => setSort((s) => (s === "count" ? "alpha" : "count"))}
          className="text-sm text-fg-muted hover:text-accent"
          aria-label="Toggle tag sort"
        >
          Sort: {sort === "count" ? "most used" : "A–Z"}
        </button>
      </header>

      <input
        type="search"
        placeholder="Filter tags…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Filter tags"
        className="mb-4 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
      />

      {selectedCount > 0 ? (
        <div
          className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-sm"
          aria-label="Tag selection actions"
        >
          <span className="text-fg-muted">
            {selectedCount} selected: {Array.from(selected).join(", ")}
          </span>
          <button
            type="button"
            onClick={() => setMergeOpen(true)}
            disabled={selectedCount < 2 || offline}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40"
          >
            Merge into…
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="text-xs text-fg-muted hover:text-accent"
          >
            Clear
          </button>
        </div>
      ) : null}

      {tags.isPending ? (
        <SkeletonRows />
      ) : tags.isError ? (
        <ErrorBlock error={tags.error} />
      ) : visible.length === 0 ? (
        <EmptyBlock filtering={search.trim().length > 0} hasAny={(tags.data ?? []).length > 0} />
      ) : (
        <ul
          className="divide-y divide-border rounded-md border border-border bg-card"
          aria-label="Tag list"
        >
          {visible.map((t) => (
            <TagRow
              key={t.name}
              tag={t}
              selected={selected.has(t.name)}
              onToggle={() => toggleSelected(t.name)}
              onRename={() => setRenameTarget(t.name)}
              offline={offline}
            />
          ))}
        </ul>
      )}

      {tags.data && tags.data.length > 0 ? (
        <p className="mt-6 text-xs text-fg-dim">
          {visible.length} / {tags.data.length} tag{tags.data.length === 1 ? "" : "s"}
        </p>
      ) : null}

      {renameTarget !== null ? (
        <TagRenameDialog
          mode="rename"
          sources={[renameTarget]}
          tagOptions={tagNames}
          onClose={() => setRenameTarget(null)}
          pending={renameMut.isPending}
          offline={offline}
          onRun={async (target) => {
            const res = await renameMut.mutateAsync({ oldName: renameTarget, newName: target });
            if (res.failed.length === 0) setRenameTarget(null);
            return res;
          }}
        />
      ) : null}

      {mergeOpen ? (
        <TagRenameDialog
          mode="merge"
          sources={Array.from(selected)}
          tagOptions={tagNames}
          onClose={() => setMergeOpen(false)}
          pending={mergeMut.isPending}
          offline={offline}
          onRun={async (target) => {
            const res = await mergeMut.mutateAsync({
              sources: Array.from(selected),
              target,
            });
            const anyFailed = res.some((r) => r.failed.length > 0);
            if (!anyFailed) {
              setMergeOpen(false);
              clearSelection();
            }
            return res;
          }}
        />
      ) : null}
    </div>
  );
}

function TagRow({
  tag,
  selected,
  onToggle,
  onRename,
  offline,
}: {
  tag: TagSummary;
  selected: boolean;
  onToggle(): void;
  onRename(): void;
  offline: boolean;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={`Select tag ${tag.name}`}
        className="accent-accent"
      />
      <Link
        to={`/notes?tag=${encodeURIComponent(tag.name)}`}
        className="flex flex-1 items-baseline gap-2 text-fg hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="font-mono">#{tag.name}</span>
        <span className="text-xs text-fg-dim">{tag.count}</span>
      </Link>
      <button
        type="button"
        onClick={onRename}
        disabled={offline}
        className="text-xs text-fg-muted hover:text-accent disabled:opacity-40"
        aria-label={`Rename tag ${tag.name}`}
      >
        Rename
      </button>
    </li>
  );
}

function filterAndSort(tags: TagSummary[], search: string, sort: SortMode): TagSummary[] {
  const needle = search.trim().toLowerCase();
  const filtered = needle ? tags.filter((t) => t.name.toLowerCase().includes(needle)) : tags;
  const sorted = [...filtered];
  if (sort === "alpha") {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    sorted.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  return sorted;
}

function SkeletonRows() {
  return (
    <div
      className="divide-y divide-border rounded-md border border-border bg-card"
      aria-busy="true"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-10 animate-pulse bg-card/60" />
      ))}
    </div>
  );
}

function ErrorBlock({ error }: { error: Error }) {
  const isAuth = error instanceof VaultAuthError;
  return (
    <div className="rounded-md border border-red-500/30 bg-red-500/5 p-6">
      <p className="mb-2 font-medium text-red-400">
        {isAuth ? "Session expired" : "Could not load tags"}
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

function EmptyBlock({ filtering, hasAny }: { filtering: boolean; hasAny: boolean }) {
  if (filtering && hasAny) {
    return (
      <div className="rounded-md border border-border bg-card p-10 text-center">
        <p className="text-fg-muted">No tags match your filter.</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-card p-10 text-center">
      <p className="mb-3 text-fg-muted">No tags in this vault yet.</p>
      <Link
        to="/new"
        className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
      >
        Create a note
      </Link>
    </div>
  );
}
