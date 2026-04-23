import type { TagSummary } from "@/lib/vault/types";
import { useMemo, useState } from "react";

// Tag-primary browser for the Notes sidebar. Shows all tags in the vault
// with per-tag counts, groups slash-delimited tags under a collapsible
// parent (e.g. `summary/daily`, `summary/weekly` → "summary" group), and
// drives the existing `selectedTags` multi-select used by the notes list
// query. Pinned tags float to the top; everything else is sorted by count
// descending so the biggest buckets are most discoverable.

interface Props {
  tags: TagSummary[];
  pinnedTags: string[];
  selected: string[];
  onToggle: (name: string) => void;
  onClear: () => void;
  isLoading?: boolean;
}

interface GroupedTag {
  kind: "leaf";
  name: string;
  label: string;
  count: number;
  pinned: boolean;
}

interface GroupedTagNode {
  kind: "group";
  prefix: string;
  totalCount: number;
  // The parent tag itself, if it exists as a concrete tag (e.g. "summary").
  selfTag?: TagSummary & { pinned: boolean };
  children: Array<TagSummary & { pinned: boolean }>;
}

type Entry = GroupedTag | GroupedTagNode;

function groupAndRank(tags: TagSummary[], pinnedSet: Set<string>): Entry[] {
  // Partition into slash-prefixed vs flat. A slash-prefixed tag contributes
  // to a group only if at least 2 tags share its first segment (so we don't
  // wrap a single `summary/daily` into a pointless "summary" group of one).
  const firstSegmentIndex = new Map<string, TagSummary[]>();
  for (const t of tags) {
    const slash = t.name.indexOf("/");
    if (slash > 0) {
      const head = t.name.slice(0, slash);
      const bucket = firstSegmentIndex.get(head) ?? [];
      bucket.push(t);
      firstSegmentIndex.set(head, bucket);
    }
  }

  const groupedHeads = new Set<string>();
  for (const [head, members] of firstSegmentIndex) {
    if (members.length >= 2) groupedHeads.add(head);
  }

  const groups = new Map<string, GroupedTagNode>();
  const leaves: GroupedTag[] = [];

  for (const t of tags) {
    const slash = t.name.indexOf("/");
    const head = slash > 0 ? t.name.slice(0, slash) : t.name;
    const isGroupMember = slash > 0 && groupedHeads.has(head);

    if (isGroupMember) {
      let group = groups.get(head);
      if (!group) {
        group = { kind: "group", prefix: head, totalCount: 0, children: [] };
        groups.set(head, group);
      }
      group.children.push({ ...t, pinned: pinnedSet.has(t.name) });
      group.totalCount += t.count;
    } else if (groupedHeads.has(t.name)) {
      // This tag is the concrete parent of a group (e.g. `summary` itself
      // exists as a tag, and so do `summary/daily`, `summary/weekly`).
      let group = groups.get(t.name);
      if (!group) {
        group = { kind: "group", prefix: t.name, totalCount: 0, children: [] };
        groups.set(t.name, group);
      }
      group.selfTag = { ...t, pinned: pinnedSet.has(t.name) };
      group.totalCount += t.count;
    } else {
      leaves.push({
        kind: "leaf",
        name: t.name,
        label: t.name,
        count: t.count,
        pinned: pinnedSet.has(t.name),
      });
    }
  }

  // Sort children of each group by count desc, with pinned first.
  for (const g of groups.values()) {
    g.children.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.count - a.count || a.name.localeCompare(b.name);
    });
  }

  // Merge + rank top-level entries. Use max child count (or self count) as
  // the group's ranking signal rather than total — a group with many tiny
  // children shouldn't jump above a single heavy tag.
  const entries: Entry[] = [...leaves, ...Array.from(groups.values())];

  const rankOf = (e: Entry): { pinned: boolean; count: number; label: string } => {
    if (e.kind === "leaf") return { pinned: e.pinned, count: e.count, label: e.label };
    const anyPinned = (e.selfTag?.pinned ?? false) || e.children.some((c) => c.pinned);
    const heaviest = Math.max(e.selfTag?.count ?? 0, ...e.children.map((c) => c.count)) || 0;
    return { pinned: anyPinned, count: heaviest, label: e.prefix };
  };

  entries.sort((a, b) => {
    const ra = rankOf(a);
    const rb = rankOf(b);
    if (ra.pinned !== rb.pinned) return ra.pinned ? -1 : 1;
    return rb.count - ra.count || ra.label.localeCompare(rb.label);
  });

  return entries;
}

export function TagBrowser({ tags, pinnedTags, selected, onToggle, onClear, isLoading }: Props) {
  const pinnedSet = useMemo(() => new Set(pinnedTags.map((p) => p.toLowerCase())), [pinnedTags]);
  const selectedSet = useMemo(() => new Set(selected.map((s) => s.toLowerCase())), [selected]);
  const entries = useMemo(() => groupAndRank(tags, pinnedSet), [tags, pinnedSet]);

  // Per-group open state. Default all groups to collapsed so the sidebar
  // stays scannable at a glance — users expand what they care about.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (head: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(head)) next.delete(head);
      else next.add(head);
      return next;
    });
  };

  return (
    <nav aria-label="Browse by tag">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs uppercase tracking-wider text-fg-dim">Tags</h2>
        {selected.length > 0 ? (
          <button type="button" onClick={onClear} className="text-xs text-fg-dim hover:text-accent">
            Clear
          </button>
        ) : null}
      </div>

      {isLoading ? (
        <p className="text-xs text-fg-dim">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-fg-dim">No tags in this vault.</p>
      ) : (
        <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto pr-1">
          {entries.map((entry) =>
            entry.kind === "leaf" ? (
              <li key={entry.name}>
                <TagRow
                  name={entry.name}
                  label={entry.label}
                  count={entry.count}
                  pinned={entry.pinned}
                  active={selectedSet.has(entry.name.toLowerCase())}
                  onToggle={() => onToggle(entry.name)}
                />
              </li>
            ) : (
              <li key={entry.prefix}>
                <TagGroup
                  group={entry}
                  isOpen={openGroups.has(entry.prefix)}
                  onToggleOpen={() => toggleGroup(entry.prefix)}
                  selectedSet={selectedSet}
                  onToggleTag={onToggle}
                />
              </li>
            ),
          )}
        </ul>
      )}
    </nav>
  );
}

function TagRow({
  name,
  label,
  count,
  pinned,
  active,
  onToggle,
}: {
  name: string;
  label: string;
  count: number;
  pinned: boolean;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      title={`#${name}`}
      className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm ${
        active ? "bg-accent/15 text-accent" : "text-fg-muted hover:bg-bg/60 hover:text-accent"
      }`}
    >
      {pinned ? (
        <span aria-hidden="true" className="shrink-0 text-accent">
          ★
        </span>
      ) : null}
      <span className="flex-1 truncate">#{label}</span>
      <span className="shrink-0 text-xs text-fg-dim">{count}</span>
    </button>
  );
}

function TagGroup({
  group,
  isOpen,
  onToggleOpen,
  selectedSet,
  onToggleTag,
}: {
  group: GroupedTagNode;
  isOpen: boolean;
  onToggleOpen: () => void;
  selectedSet: Set<string>;
  onToggleTag: (name: string) => void;
}) {
  const anyChildSelected = group.children.some((c) => selectedSet.has(c.name.toLowerCase()));
  const selfSelected = group.selfTag ? selectedSet.has(group.selfTag.name.toLowerCase()) : false;
  // Force open whenever a descendant (or the self-tag) is selected, so the
  // user can see what's active without having to manually expand.
  const effectiveOpen = isOpen || anyChildSelected || selfSelected;
  const groupPinned = (group.selfTag?.pinned ?? false) || group.children.some((c) => c.pinned);

  return (
    <div>
      <div className="flex items-center gap-1 rounded-md px-1 py-0.5">
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={effectiveOpen}
          aria-label={`${effectiveOpen ? "Collapse" : "Expand"} ${group.prefix}`}
          className="flex h-5 w-5 shrink-0 items-center justify-center text-fg-dim hover:text-accent"
        >
          <span aria-hidden="true" className="font-mono text-xs">
            {effectiveOpen ? "▾" : "▸"}
          </span>
        </button>
        {group.selfTag ? (
          <TagRow
            name={group.selfTag.name}
            label={group.prefix}
            count={group.selfTag.count}
            pinned={group.selfTag.pinned}
            active={selfSelected}
            onToggle={() => onToggleTag(group.selfTag!.name)}
          />
        ) : (
          <button
            type="button"
            onClick={onToggleOpen}
            className="flex flex-1 items-center gap-1.5 truncate rounded-md px-2 py-1 text-left text-sm text-fg-muted hover:bg-bg/60 hover:text-accent"
          >
            {groupPinned ? (
              <span aria-hidden="true" className="shrink-0 text-accent">
                ★
              </span>
            ) : null}
            <span className="flex-1 truncate">#{group.prefix}/</span>
            <span className="shrink-0 text-xs text-fg-dim">{group.totalCount}</span>
          </button>
        )}
      </div>
      {effectiveOpen ? (
        <ul className="ml-4 space-y-0.5 border-l border-border pl-2">
          {group.children.map((c) => {
            const leafLabel = c.name.slice(group.prefix.length + 1) || c.name;
            return (
              <li key={c.name}>
                <TagRow
                  name={c.name}
                  label={leafLabel}
                  count={c.count}
                  pinned={c.pinned}
                  active={selectedSet.has(c.name.toLowerCase())}
                  onToggle={() => onToggleTag(c.name)}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
