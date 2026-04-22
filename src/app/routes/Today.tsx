import { formatLongDate, pad2, parseDateKey, toDateKey, todayKey } from "@/lib/dates";
import { relativeTime } from "@/lib/time";
import { useNotesForDateViews, useVaultStore } from "@/lib/vault";
import { VaultAuthError } from "@/lib/vault/client";
import type { Note } from "@/lib/vault/types";
import { useMemo } from "react";
import { Link, Navigate, useSearchParams } from "react-router";

export function Today() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const [searchParams] = useSearchParams();
  const dateParam = searchParams.get("date");
  const todayStr = todayKey();
  const targetKey = dateParam ?? todayStr;
  const parsed = parseDateKey(targetKey);

  const notes = useNotesForDateViews();

  const buckets = useMemo(() => {
    const created: Note[] = [];
    const edited: Note[] = [];
    if (!notes.data || !parsed) return { created, edited };
    for (const n of notes.data) {
      const ck = toDateKey(n.createdAt);
      const uk = toDateKey(n.updatedAt ?? n.createdAt);
      if (ck === targetKey) created.push(n);
      if (uk === targetKey && ck !== targetKey) edited.push(n);
    }
    return { created, edited };
  }, [notes.data, parsed, targetKey]);

  if (!activeVault) return <Navigate to="/" replace />;
  if (!parsed) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-red-400">Invalid date in URL: {targetKey}</p>
        <Link to="/today" className="text-sm text-accent hover:underline">
          Back to today
        </Link>
      </div>
    );
  }

  const isToday = targetKey === todayStr;
  const prev = shiftDay(targetKey, -1);
  const next = shiftDay(targetKey, 1);
  const monthKey = targetKey.slice(0, 7);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-fg-dim">{isToday ? "Today" : "On"}</p>
          <h1 className="font-serif text-3xl tracking-tight">{formatLongDate(targetKey)}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            to={`/today?date=${prev}`}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-fg-muted hover:text-accent"
            aria-label="Previous day"
          >
            ← {prev}
          </Link>
          {!isToday ? (
            <Link
              to="/today"
              className="rounded-md border border-border bg-card px-3 py-1.5 text-fg-muted hover:text-accent"
            >
              Today
            </Link>
          ) : null}
          <Link
            to={`/today?date=${next}`}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-fg-muted hover:text-accent"
            aria-label="Next day"
          >
            {next} →
          </Link>
          <Link
            to={`/calendar?month=${monthKey}`}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-fg-muted hover:text-accent"
          >
            Calendar
          </Link>
          <Link
            to="/capture"
            className="rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-hover"
          >
            + Capture
          </Link>
        </div>
      </header>

      {notes.isPending ? (
        <Skeleton />
      ) : notes.isError ? (
        <ErrorBlock error={notes.error} />
      ) : buckets.created.length === 0 && buckets.edited.length === 0 ? (
        <EmptyBlock isToday={isToday} targetKey={targetKey} />
      ) : (
        <div className="space-y-8">
          {buckets.created.length > 0 ? (
            <Section
              title={isToday ? "Created today" : `Created on ${targetKey}`}
              notes={buckets.created}
            />
          ) : null}
          {buckets.edited.length > 0 ? (
            <Section
              title={isToday ? "Edited today" : `Edited on ${targetKey}`}
              notes={buckets.edited}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function shiftDay(key: string, delta: number): string {
  const d = parseDateKey(key);
  if (!d) return key;
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function Section({ title, notes }: { title: string; notes: Note[] }) {
  return (
    <section>
      <h2 className="mb-2 text-xs uppercase tracking-wider text-fg-dim">
        {title} ({notes.length})
      </h2>
      <ol className="divide-y divide-border rounded-md border border-border bg-card">
        {notes.map((n) => (
          <li key={n.id}>
            <Link
              to={`/n/${encodeURIComponent(n.id)}`}
              className="block px-4 py-3 hover:bg-bg/60 focus:bg-bg/60 focus:outline-none"
            >
              <div className="flex items-baseline justify-between gap-4">
                <span className="truncate font-mono text-sm text-fg">{n.path ?? n.id}</span>
                <span className="shrink-0 text-xs text-fg-dim">
                  {relativeTime(n.updatedAt ?? n.createdAt)}
                </span>
              </div>
              {n.preview ? (
                <p className="mt-1 truncate text-sm text-fg-muted">{n.preview}</p>
              ) : null}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function EmptyBlock({ isToday, targetKey }: { isToday: boolean; targetKey: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-10 text-center">
      <p className="mb-4 text-fg-muted">
        {isToday ? "Nothing yet today — start capturing." : `Nothing on ${targetKey}.`}
      </p>
      {isToday ? (
        <Link
          to="/capture"
          className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Open capture
        </Link>
      ) : null}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-md bg-border/30" />
      ))}
    </div>
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
