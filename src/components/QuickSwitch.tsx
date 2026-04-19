import { loadRecents } from "@/lib/quick-switch/recents";
import { type QuickSwitchEntry, computeResults } from "@/lib/quick-switch/results";
import { useAllNotesForSwitcher, useTags, useVaultStore } from "@/lib/vault";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

// Cmd+K spotlight. Opens via a global keydown (see useQuickSwitchHotkey),
// closes on Escape, click-outside, or selection. Modal renders inside a
// <dialog open> so native a11y semantics and focus management help.
//
// The results list is a flat array — commands + notes + tags interleaved
// and ranked. Flat keeps ↑/↓/Enter simple (one selected index, always a
// real entry). Debounce is 150ms because the compute is cheap against the
// already-fetched note list, but pressing keys in rapid succession still
// gets smoother renders.

interface Props {
  onClose(): void;
}

const DEBOUNCE_MS = 150;

export function QuickSwitch({ onClose }: Props) {
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const listboxId = useId();

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);

  const notesQuery = useAllNotesForSwitcher(true);
  const tagsQuery = useTags();
  const recents = useMemo(() => (activeVaultId ? loadRecents(activeVaultId) : []), [activeVaultId]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const results = useMemo<QuickSwitchEntry[]>(
    () =>
      computeResults({
        query: debounced,
        notes: notesQuery.data ?? [],
        tags: tagsQuery.data ?? [],
        recents,
      }),
    [debounced, notesQuery.data, tagsQuery.data, recents],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when list size changes
  useEffect(() => {
    setSelectedIdx(0);
  }, [results.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runEntry = useCallback(
    (entry: QuickSwitchEntry) => {
      if (entry.kind === "note") {
        navigate(`/notes/${encodeURIComponent(entry.id)}`);
      } else if (entry.kind === "tag") {
        navigate(`/notes?tag=${encodeURIComponent(entry.name)}`);
      } else {
        navigate(entry.action.to);
      }
      onClose();
    },
    [navigate, onClose],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(results.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const entry = results[selectedIdx];
        if (entry) runEntry(entry);
        return;
      }
    },
    [results, selectedIdx, runEntry, onClose],
  );

  useEffect(() => {
    const selectedEl = listRef.current?.querySelector<HTMLElement>(
      `[data-qs-idx="${selectedIdx}"]`,
    );
    // scrollIntoView is missing in jsdom; guard so tests don't throw.
    selectedEl?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIdx]);

  const loading = notesQuery.isPending;

  return (
    <dialog
      open
      aria-labelledby={inputId}
      className="fixed inset-0 z-50 m-0 flex h-full max-h-full w-full max-w-full items-start justify-center bg-black/60 p-4 pt-[10vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl rounded-md border border-border bg-card shadow-xl">
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Jump to… (type > for commands)"
          aria-label="Quick switch query"
          aria-controls={listboxId}
          aria-activedescendant={results[selectedIdx] ? `qs-opt-${selectedIdx}` : undefined}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-t-md border-b border-border bg-transparent px-4 py-3 text-base text-fg placeholder:text-fg-dim focus:outline-none"
        />
        <div
          id={listboxId}
          ref={listRef}
          // biome-ignore lint/a11y/useSemanticElements: combobox pattern (listbox paired with input above), not a native <select>
          role="listbox"
          tabIndex={-1}
          aria-label="Quick switch results"
          aria-live="polite"
          className="max-h-[50vh] overflow-y-auto"
        >
          {loading && results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-fg-dim">Loading notes…</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-fg-dim">
              {query.trim().length === 0 ? "Start typing to search." : "No matches."}
            </div>
          ) : (
            results.map((entry, i) => (
              <ResultRow
                key={entryKey(entry)}
                entry={entry}
                index={i}
                selected={i === selectedIdx}
                onPick={() => runEntry(entry)}
                onHover={() => setSelectedIdx(i)}
              />
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-fg-dim">
          <span>
            <kbd className="rounded bg-bg/60 px-1">↑↓</kbd> navigate{" "}
            <kbd className="rounded bg-bg/60 px-1">↵</kbd> open{" "}
            <kbd className="rounded bg-bg/60 px-1">esc</kbd> close
          </span>
          <span>
            {results.length > 0 ? `${results.length} result${results.length === 1 ? "" : "s"}` : ""}
          </span>
        </div>
      </div>
    </dialog>
  );
}

function entryKey(e: QuickSwitchEntry): string {
  if (e.kind === "note") return `note:${e.id}`;
  if (e.kind === "tag") return `tag:${e.name}`;
  return `cmd:${e.id}`;
}

function ResultRow({
  entry,
  index,
  selected,
  onPick,
  onHover,
}: {
  entry: QuickSwitchEntry;
  index: number;
  selected: boolean;
  onPick(): void;
  onHover(): void;
}) {
  const bg = selected ? "bg-accent/10 text-fg" : "text-fg-muted";
  return (
    <div
      id={`qs-opt-${index}`}
      // biome-ignore lint/a11y/useSemanticElements: option-in-listbox combobox pattern, not a native <option>
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      data-qs-idx={index}
      onMouseEnter={onHover}
      onMouseDown={(e) => {
        // mouseDown (not click) so the input doesn't lose focus and close us
        // via backdrop handling first.
        e.preventDefault();
        onPick();
      }}
      className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-sm ${bg}`}
    >
      {entry.kind === "note" ? (
        <>
          <span className="text-xs uppercase tracking-wider text-fg-dim">note</span>
          <span className="truncate font-medium">{entry.title}</span>
          {entry.path ? (
            <span className="ml-auto truncate font-mono text-xs text-fg-dim">{entry.path}</span>
          ) : null}
        </>
      ) : entry.kind === "tag" ? (
        <>
          <span className="text-xs uppercase tracking-wider text-fg-dim">tag</span>
          <span className="font-mono">#{entry.name}</span>
          <span className="ml-auto text-xs text-fg-dim">{entry.count}</span>
        </>
      ) : (
        <>
          <span className="text-xs uppercase tracking-wider text-accent">cmd</span>
          <span className="font-medium">{entry.label}</span>
          <span className="ml-auto text-xs text-fg-dim">{entry.description}</span>
        </>
      )}
    </div>
  );
}
