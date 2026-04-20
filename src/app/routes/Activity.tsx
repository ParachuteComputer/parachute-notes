import {
  type ActivityEvent,
  BUCKET_LABELS,
  BUCKET_ORDER,
  buildActivityEvents,
  groupEventsByBucket,
} from "@/lib/activity/events";
import { relativeTime } from "@/lib/time";
import { useNotesForDateViews, useVaultStore } from "@/lib/vault";
import { VaultAuthError } from "@/lib/vault/client";
import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router";

const PAGE_SIZE = 50;

export function Activity() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const notes = useNotesForDateViews();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const events = useMemo(() => {
    if (!notes.data) return [];
    return buildActivityEvents(notes.data);
  }, [notes.data]);

  const visibleEvents = useMemo(() => events.slice(0, visibleCount), [events, visibleCount]);
  const grouped = useMemo(() => groupEventsByBucket(visibleEvents), [visibleEvents]);
  const remaining = events.length - visibleEvents.length;

  if (!activeVault) return <Navigate to="/" replace />;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wider text-fg-dim">Activity</p>
        <h1 className="font-serif text-3xl tracking-tight">Recent changes</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Last 30 days, newest first. Deletions aren't tracked yet.
        </p>
      </header>

      {notes.isPending ? (
        <Skeleton />
      ) : notes.isError ? (
        <ErrorBlock error={notes.error} />
      ) : events.length === 0 ? (
        <EmptyBlock />
      ) : (
        <>
          <div className="space-y-8">
            {BUCKET_ORDER.map((bucket) =>
              grouped[bucket].length > 0 ? (
                <Section key={bucket} title={BUCKET_LABELS[bucket]} events={grouped[bucket]} />
              ) : null,
            )}
          </div>
          {remaining > 0 ? (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                className="rounded-md border border-border bg-card px-4 py-2 text-sm text-fg-muted hover:text-accent"
              >
                Load more ({remaining} remaining)
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Section({ title, events }: { title: string; events: ActivityEvent[] }) {
  return (
    <section>
      <h2 className="mb-2 text-xs uppercase tracking-wider text-fg-dim">
        {title} ({events.length})
      </h2>
      <ol className="divide-y divide-border rounded-md border border-border bg-card">
        {events.map((ev) => (
          <li key={ev.id}>
            <Link
              to={`/n/${encodeURIComponent(ev.noteId)}`}
              className="block px-4 py-3 hover:bg-bg/60 focus:bg-bg/60 focus:outline-none"
            >
              <div className="flex items-baseline justify-between gap-4">
                <div className="flex min-w-0 items-baseline gap-2">
                  <KindBadge kind={ev.kind} />
                  <span className="truncate font-mono text-sm text-fg">{ev.noteName}</span>
                </div>
                <span className="shrink-0 text-xs text-fg-dim">{relativeTime(ev.at)}</span>
              </div>
              {ev.preview ? (
                <p className="mt-1 truncate text-sm text-fg-muted">{ev.preview}</p>
              ) : null}
              {ev.tags && ev.tags.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {ev.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-border/40 px-1.5 py-0.5 text-xs text-fg-dim"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function KindBadge({ kind }: { kind: "created" | "updated" }) {
  if (kind === "created") {
    return (
      <span className="shrink-0 rounded-md bg-accent/10 px-1.5 py-0.5 text-xs text-accent">
        Created
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-md bg-border/40 px-1.5 py-0.5 text-xs text-fg-muted">
      Edited
    </span>
  );
}

function EmptyBlock() {
  return (
    <div className="rounded-md border border-border bg-card p-10 text-center">
      <p className="mb-4 text-fg-muted">No activity in the last 30 days.</p>
      <Link
        to="/capture"
        className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
      >
        Open capture
      </Link>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-md bg-border/30" />
      ))}
    </div>
  );
}

function ErrorBlock({ error }: { error: Error }) {
  const isAuth = error instanceof VaultAuthError;
  return (
    <div className="rounded-md border border-red-500/30 bg-red-500/5 p-6">
      <p className="mb-2 font-medium text-red-400">
        {isAuth ? "Session expired" : "Could not load activity"}
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
