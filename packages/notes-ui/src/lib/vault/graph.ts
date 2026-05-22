import type { Note } from "./types";

export interface VaultGraphNode {
  id: string;
  path?: string;
  title: string;
  tags: string[];
  topTag?: string;
  degree: number;
  summary?: string;
}

export interface VaultGraphEdge {
  source: string;
  target: string;
  relationship: string;
}

export interface VaultGraph {
  nodes: VaultGraphNode[];
  edges: VaultGraphEdge[];
}

export interface VaultGraphFilter {
  search: string;
  tags: string[];
}

export const EMPTY_FILTER: VaultGraphFilter = { search: "", tags: [] };

export function buildVaultGraph(notes: Note[]): VaultGraph {
  const notesById = new Map<string, Note>();
  for (const n of notes) notesById.set(n.id, n);

  const edgeMap = new Map<string, VaultGraphEdge>();
  const degree = new Map<string, number>();

  for (const note of notes) {
    for (const l of note.links ?? []) {
      if (l.sourceId === l.targetId) continue;
      if (!notesById.has(l.sourceId) || !notesById.has(l.targetId)) continue;
      const key = `${l.sourceId}|${l.targetId}|${l.relationship}`;
      if (edgeMap.has(key)) continue;
      edgeMap.set(key, {
        source: l.sourceId,
        target: l.targetId,
        relationship: l.relationship,
      });
      degree.set(l.sourceId, (degree.get(l.sourceId) ?? 0) + 1);
      degree.set(l.targetId, (degree.get(l.targetId) ?? 0) + 1);
    }
  }

  const nodes: VaultGraphNode[] = notes.map((n) => {
    const tags = n.tags ?? [];
    return {
      id: n.id,
      path: n.path,
      title: titleFor(n),
      tags,
      topTag: tags[0],
      degree: degree.get(n.id) ?? 0,
      summary: typeof n.metadata?.summary === "string" ? n.metadata.summary : undefined,
    };
  });

  return { nodes, edges: [...edgeMap.values()] };
}

export function titleFor(note: Note): string {
  if (note.path) {
    const last = note.path.split("/").pop() ?? note.path;
    return last.replace(/\.md$/i, "");
  }
  return note.id;
}

export function matchesFilter(node: VaultGraphNode, filter: VaultGraphFilter): boolean {
  const q = filter.search.trim().toLowerCase();
  if (q) {
    const haystack = [node.path ?? "", node.title, node.id].join(" ").toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (filter.tags.length > 0) {
    const hasAny = filter.tags.some((t) => node.tags.includes(t));
    if (!hasAny) return false;
  }
  return true;
}

export function collectTopTags(nodes: VaultGraphNode[]): string[] {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);
}

// Stable hue from tag name so the same tag keeps its color across sessions.
export function tagColor(tag: string | undefined): string {
  if (!tag) return "#8a9a7a";
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) & 0xffffff;
  const hue = h % 360;
  return `hsl(${hue}, 40%, 55%)`;
}
