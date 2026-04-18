import { useTags, useVaultStore } from "@/lib/vault";
import { VaultAuthError } from "@/lib/vault/client";
import type { TagSummary } from "@/lib/vault/types";
import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router";

type SortMode = "count" | "alpha";

export function Tags() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const tags = useTags();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("count");

  const visible = useMemo(
    () => filterAndSort(tags.data ?? [], search, sort),
    [tags.data, search, sort],
  );

  if (!activeVault) return <Navigate to="/" replace />;

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
        className="mb-6 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
      />

      {tags.isPending ? (
        <SkeletonChips />
      ) : tags.isError ? (
        <ErrorBlock error={tags.error} />
      ) : visible.length === 0 ? (
        <EmptyBlock filtering={search.trim().length > 0} hasAny={(tags.data ?? []).length > 0} />
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="Tag list">
          {visible.map((t) => (
            <li key={t.name}>
              <Link
                to={`/notes?tag=${encodeURIComponent(t.name)}`}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-fg hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span>{t.name}</span>
                <span className="text-xs text-fg-dim">{t.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {tags.data && tags.data.length > 0 ? (
        <p className="mt-6 text-xs text-fg-dim">
          {visible.length} / {tags.data.length} tag{tags.data.length === 1 ? "" : "s"}
        </p>
      ) : null}
    </div>
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

function SkeletonChips() {
  return (
    <div className="flex flex-wrap gap-2" aria-busy="true">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div
          key={i}
          className="h-8 w-24 animate-pulse rounded-full border border-border bg-card/60"
        />
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
