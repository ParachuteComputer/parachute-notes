import {
  currentMonthKey,
  formatLongMonth,
  monthGrid,
  pad2,
  parseMonthKey,
  shiftMonth,
  toDateKey,
  todayKey,
} from "@/lib/dates";
import { useNotesForDateViews, useVaultStore } from "@/lib/vault";
import { VaultAuthError } from "@/lib/vault/client";
import { useMemo } from "react";
import { Link, Navigate, useSearchParams } from "react-router";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Cap visible dots per cell; overflow shows as "+N more".
const MAX_DOTS_PER_DAY = 5;

export function Calendar() {
  const activeVault = useVaultStore((s) => s.getActiveVault());
  const [searchParams] = useSearchParams();
  const monthParam = searchParams.get("month");
  const parsed = parseMonthKey(monthParam) ?? parseMonthKey(currentMonthKey())!;
  const notes = useNotesForDateViews();
  const today = todayKey();

  const days = useMemo(() => monthGrid(parsed.year, parsed.month), [parsed.year, parsed.month]);

  // Bucket notes by local date key. We tally by createdAt; if you want edited
  // activity instead, switch to updatedAt — but for a calendar, "when was this
  // authored" reads more naturally than "when was it last touched".
  const countsByDay = useMemo(() => {
    const map = new Map<string, number>();
    if (!notes.data) return map;
    for (const n of notes.data) {
      const k = toDateKey(n.createdAt);
      if (!k) continue;
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }, [notes.data]);

  if (!activeVault) return <Navigate to="/" replace />;

  const prev = shiftMonth(parsed.year, parsed.month, -1);
  const next = shiftMonth(parsed.year, parsed.month, 1);
  const prevKey = `${prev.year}-${pad2(prev.month)}`;
  const nextKey = `${next.year}-${pad2(next.month)}`;
  const currentKey = currentMonthKey();
  const isCurrent = `${parsed.year}-${pad2(parsed.month)}` === currentKey;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-fg-dim">Calendar</p>
          <h1 className="font-serif text-3xl tracking-tight">
            {formatLongMonth(parsed.year, parsed.month)}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            to={`/calendar?month=${prevKey}`}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-fg-muted hover:text-accent"
            aria-label="Previous month"
          >
            ← {prevKey}
          </Link>
          {!isCurrent ? (
            <Link
              to="/calendar"
              className="rounded-md border border-border bg-card px-3 py-1.5 text-fg-muted hover:text-accent"
            >
              This month
            </Link>
          ) : null}
          <Link
            to={`/calendar?month=${nextKey}`}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-fg-muted hover:text-accent"
            aria-label="Next month"
          >
            {nextKey} →
          </Link>
          <Link
            to={`/today?date=${today}`}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-fg-muted hover:text-accent"
          >
            Today
          </Link>
        </div>
      </header>

      {notes.isError ? (
        <ErrorBlock error={notes.error} />
      ) : (
        <div className="rounded-md border border-border bg-card" aria-busy={notes.isPending}>
          <div className="grid grid-cols-7 border-b border-border text-xs uppercase tracking-wider text-fg-dim">
            {WEEKDAYS.map((w) => (
              <div key={w} className="px-2 py-2 text-center">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
              const inMonth = d.getMonth() + 1 === parsed.month;
              const count = countsByDay.get(key) ?? 0;
              const isToday = key === today;
              return (
                <Link
                  key={key}
                  to={`/today?date=${key}`}
                  className={`flex min-h-20 flex-col border-b border-r border-border p-1.5 text-xs hover:bg-bg/60 focus:bg-bg/60 focus:outline-none ${
                    inMonth ? "" : "opacity-40"
                  }`}
                  aria-label={`${key} — ${count} notes`}
                >
                  <span
                    className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full ${
                      isToday ? "bg-accent text-white" : "text-fg"
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  {count > 0 ? (
                    <DayDots count={count} />
                  ) : (
                    <span className="sr-only">no notes</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-fg-dim">
        Each dot is a note created on that day. Click any day to open /today.
      </p>
    </div>
  );
}

function DayDots({ count }: { count: number }) {
  const dots = Math.min(count, MAX_DOTS_PER_DAY);
  const more = count > MAX_DOTS_PER_DAY ? count - MAX_DOTS_PER_DAY : 0;
  return (
    <span className="flex flex-wrap items-center gap-0.5">
      {Array.from({ length: dots }).map((_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: dot count only, no identity
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-accent"
          aria-hidden="true"
        />
      ))}
      {more > 0 ? <span className="ml-0.5 text-[10px] text-fg-dim">+{more}</span> : null}
    </span>
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
