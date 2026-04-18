import { useEffect, useState } from "react";
import type { VaultClient } from "./client";
import type { Note } from "./types";

export interface GraphNode {
  id: string;
  path?: string;
  tags?: string[];
  summary?: string;
  isAnchor: boolean;
  linkCount: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
}

export interface NeighborhoodGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const MIN_DEPTH = 1;
export const MAX_DEPTH = 3;
export const DEFAULT_DEPTH = 2;

export function buildNeighborhoodGraph(
  anchorId: string,
  notesById: Map<string, Note>,
): NeighborhoodGraphData {
  const edges = new Map<string, GraphEdge>();
  const linkCount = new Map<string, number>();

  for (const note of notesById.values()) {
    for (const l of note.links ?? []) {
      if (l.sourceId === l.targetId) continue;
      if (!notesById.has(l.sourceId) || !notesById.has(l.targetId)) continue;
      const key = `${l.sourceId}|${l.targetId}|${l.relationship}`;
      if (edges.has(key)) continue;
      edges.set(key, {
        source: l.sourceId,
        target: l.targetId,
        relationship: l.relationship,
      });
      linkCount.set(l.sourceId, (linkCount.get(l.sourceId) ?? 0) + 1);
      linkCount.set(l.targetId, (linkCount.get(l.targetId) ?? 0) + 1);
    }
  }

  const nodes: GraphNode[] = [...notesById.values()].map((n) => ({
    id: n.id,
    path: n.path,
    tags: n.tags,
    summary: typeof n.metadata?.summary === "string" ? n.metadata.summary : undefined,
    isAnchor: n.id === anchorId,
    linkCount: linkCount.get(n.id) ?? 0,
  }));

  return { nodes, edges: [...edges.values()] };
}

export async function expandNeighborhood(
  anchor: Note,
  depth: number,
  fetchNote: (id: string) => Promise<Note | null>,
  signal?: { cancelled: boolean },
): Promise<Map<string, Note>> {
  const notes = new Map<string, Note>();
  notes.set(anchor.id, anchor);

  let frontier: Note[] = [anchor];
  for (let layer = 1; layer < depth; layer++) {
    const toFetch = new Set<string>();
    for (const note of frontier) {
      for (const l of note.links ?? []) {
        const peerId = l.sourceId === note.id ? l.targetId : l.sourceId;
        if (peerId === note.id) continue;
        if (!notes.has(peerId)) toFetch.add(peerId);
      }
    }
    if (toFetch.size === 0) break;
    const fetched = await Promise.all([...toFetch].map((id) => fetchNote(id).catch(() => null)));
    if (signal?.cancelled) return notes;
    const next: Note[] = [];
    for (const n of fetched) {
      if (n && !notes.has(n.id)) {
        notes.set(n.id, n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return notes;
}

export function useNeighborhood(
  client: VaultClient | null,
  anchor: Note | undefined,
  depth: number,
): { data: NeighborhoodGraphData | null; isLoading: boolean } {
  const [data, setData] = useState<NeighborhoodGraphData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!client || !anchor) {
      setData(null);
      setIsLoading(false);
      return;
    }
    const signal = { cancelled: false };
    setIsLoading(true);
    expandNeighborhood(anchor, depth, (id) => client.getNote(id, { includeLinks: true }), signal)
      .then((notes) => {
        if (signal.cancelled) return;
        setData(buildNeighborhoodGraph(anchor.id, notes));
        setIsLoading(false);
      })
      .catch(() => {
        if (signal.cancelled) return;
        setIsLoading(false);
      });
    return () => {
      signal.cancelled = true;
    };
  }, [client, anchor, depth]);

  return { data, isLoading };
}
