import type { Note, TagSummary } from "@/lib/vault/types";
import { fuzzyScore } from "./fuzzy";
import type { RecentEntry } from "./recents";
import { noteTitle } from "./title";

// The switcher returns a heterogeneous list: commands first when a query
// matches one, then notes by score, then a trailing tag section for pure-tag
// jumps. Keeping all three in one ordered list (rather than separate sections
// on the same view) keeps keyboard nav with ↑/↓/Enter trivial — the selected
// index always points at a real entry.

export type QuickSwitchEntry =
  | { kind: "note"; id: string; title: string; path?: string; score: number }
  | { kind: "tag"; name: string; count: number; score: number }
  | {
      kind: "command";
      id: string;
      label: string;
      description: string;
      action: { type: "navigate"; to: string };
      score: number;
    };

export const MAX_RESULTS = 20;

export const COMMANDS: Array<{
  id: string;
  label: string;
  description: string;
  keywords: string[];
  action: { type: "navigate"; to: string };
}> = [
  {
    id: "new",
    label: "New note",
    description: "Open the note editor",
    keywords: ["new", "create", "compose"],
    action: { type: "navigate", to: "/new" },
  },
  {
    id: "capture",
    label: "Capture",
    description: "Voice or typed quick note",
    keywords: ["capture", "voice", "memo"],
    action: { type: "navigate", to: "/capture" },
  },
  {
    id: "graph",
    label: "Graph",
    description: "Full-vault graph view",
    keywords: ["graph", "map", "visualize"],
    action: { type: "navigate", to: "/graph" },
  },
  {
    id: "tags",
    label: "Tags",
    description: "Browse all tags",
    keywords: ["tags"],
    action: { type: "navigate", to: "/tags" },
  },
  {
    id: "notes",
    label: "Notes",
    description: "All notes list",
    keywords: ["notes", "all"],
    action: { type: "navigate", to: "/notes" },
  },
];

function matchesAny(keywords: string[], q: string): number | null {
  let best: number | null = null;
  for (const k of keywords) {
    const m = fuzzyScore(q, k);
    if (m && (best === null || m.score > best)) best = m.score;
  }
  return best;
}

// Score a note against the query using the best of (title, path, tags).
// Path counts too so "daily/2026" jumps directly.
function scoreNote(note: Note, q: string): number | null {
  const title = noteTitle(note);
  const titleMatch = fuzzyScore(q, title);
  const pathMatch = note.path ? fuzzyScore(q, note.path) : null;
  let best: number | null = null;
  if (titleMatch) best = titleMatch.score + 2; // small title bias
  if (pathMatch && (best === null || pathMatch.score > best)) best = pathMatch.score;
  for (const tag of note.tags ?? []) {
    const m = fuzzyScore(q, tag);
    if (m && (best === null || m.score > best)) best = m.score;
  }
  return best;
}

interface Inputs {
  query: string;
  notes: Note[];
  tags: TagSummary[];
  recents: RecentEntry[];
}

export function computeResults(inputs: Inputs): QuickSwitchEntry[] {
  const rawQuery = inputs.query.trim();
  const isCommandMode = rawQuery.startsWith(">");
  const q = (isCommandMode ? rawQuery.slice(1) : rawQuery).trim();

  // Empty-query empty state: recent notes, then commands.
  if (rawQuery.length === 0) {
    const byId = new Map(inputs.notes.map((n) => [n.id, n]));
    const recentEntries: QuickSwitchEntry[] = [];
    for (const r of inputs.recents) {
      const n = byId.get(r.id);
      if (!n) continue;
      recentEntries.push({
        kind: "note",
        id: n.id,
        title: noteTitle(n),
        path: n.path,
        score: 0,
      });
    }
    const commandEntries: QuickSwitchEntry[] = COMMANDS.map((c) => ({
      kind: "command",
      id: c.id,
      label: c.label,
      description: c.description,
      action: c.action,
      score: 0,
    }));
    return [...recentEntries, ...commandEntries].slice(0, MAX_RESULTS);
  }

  const commandMatches: QuickSwitchEntry[] = COMMANDS.flatMap((c) => {
    const s = matchesAny([c.label, ...c.keywords], q);
    if (s === null) return [];
    return [
      {
        kind: "command" as const,
        id: c.id,
        label: c.label,
        description: c.description,
        action: c.action,
        score: s + (isCommandMode ? 1000 : 0),
      },
    ];
  });

  // In command mode, show only commands.
  if (isCommandMode) {
    return commandMatches.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
  }

  const noteMatches: QuickSwitchEntry[] = inputs.notes.flatMap((n) => {
    const s = scoreNote(n, q);
    if (s === null) return [];
    return [
      {
        kind: "note" as const,
        id: n.id,
        title: noteTitle(n),
        path: n.path,
        score: s,
      },
    ];
  });

  const tagMatches: QuickSwitchEntry[] = inputs.tags.flatMap((t) => {
    const m = fuzzyScore(q, t.name);
    if (!m) return [];
    return [
      {
        kind: "tag" as const,
        name: t.name,
        count: t.count,
        score: m.score,
      },
    ];
  });

  return [...commandMatches, ...noteMatches, ...tagMatches]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);
}
