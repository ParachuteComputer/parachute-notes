import { describe, expect, it } from "vitest";
import { buildNeighborhoodGraph, expandNeighborhood } from "./neighborhood";
import type { Note } from "./types";

function note(id: string, links: Array<[string, string]> = [], extras: Partial<Note> = {}): Note {
  return {
    id,
    path: `notes/${id}`,
    createdAt: "2026-04-18T00:00:00.000Z",
    metadata: { summary: `summary for ${id}` },
    tags: ["t"],
    links: links.map(([source, target]) => ({
      sourceId: source,
      targetId: target,
      relationship: "wikilink",
    })),
    ...extras,
  };
}

describe("buildNeighborhoodGraph", () => {
  it("marks the anchor and dedupes edges", () => {
    const anchor = note("A", [
      ["A", "B"],
      ["A", "B"],
      ["C", "A"],
    ]);
    const b = note("B", [["A", "B"]]);
    const c = note("C", [["C", "A"]]);
    const notes = new Map([
      ["A", anchor],
      ["B", b],
      ["C", c],
    ]);

    const graph = buildNeighborhoodGraph("A", notes);

    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.find((n) => n.id === "A")?.isAnchor).toBe(true);
    expect(graph.nodes.find((n) => n.id === "B")?.isAnchor).toBe(false);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges).toContainEqual({ source: "A", target: "B", relationship: "wikilink" });
    expect(graph.edges).toContainEqual({ source: "C", target: "A", relationship: "wikilink" });
  });

  it("skips edges where an endpoint is not in the notes map", () => {
    const anchor = note("A", [
      ["A", "B"],
      ["A", "Z"], // Z is out of neighborhood
    ]);
    const b = note("B");
    const notes = new Map([
      ["A", anchor],
      ["B", b],
    ]);
    const graph = buildNeighborhoodGraph("A", notes);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toEqual({ source: "A", target: "B", relationship: "wikilink" });
  });

  it("counts links per node for sizing", () => {
    const a = note("A", [
      ["A", "B"],
      ["A", "C"],
    ]);
    const b = note("B");
    const c = note("C");
    const graph = buildNeighborhoodGraph(
      "A",
      new Map([
        ["A", a],
        ["B", b],
        ["C", c],
      ]),
    );
    expect(graph.nodes.find((n) => n.id === "A")?.linkCount).toBe(2);
    expect(graph.nodes.find((n) => n.id === "B")?.linkCount).toBe(1);
    expect(graph.nodes.find((n) => n.id === "C")?.linkCount).toBe(1);
  });

  it("exposes summary and tags for tooltip use", () => {
    const a = note("A", [], { metadata: { summary: "about A" }, tags: ["x", "y"] });
    const graph = buildNeighborhoodGraph("A", new Map([["A", a]]));
    const node = graph.nodes[0];
    expect(node.summary).toBe("about A");
    expect(node.tags).toEqual(["x", "y"]);
  });
});

describe("expandNeighborhood", () => {
  it("returns just the anchor at depth 1", async () => {
    const anchor = note("A", [["A", "B"]]);
    const fetched: string[] = [];
    const result = await expandNeighborhood(anchor, 1, async (id) => {
      fetched.push(id);
      return null;
    });
    expect(fetched).toEqual([]);
    expect([...result.keys()]).toEqual(["A"]);
  });

  it("fetches 1-hop neighbors at depth 2", async () => {
    const anchor = note("A", [
      ["A", "B"],
      ["C", "A"],
    ]);
    const fetched: string[] = [];
    const fetchNote = async (id: string): Promise<Note | null> => {
      fetched.push(id);
      return note(id);
    };
    const result = await expandNeighborhood(anchor, 2, fetchNote);
    expect(fetched.sort()).toEqual(["B", "C"]);
    expect([...result.keys()].sort()).toEqual(["A", "B", "C"]);
  });

  it("fetches 2-hop neighbors at depth 3", async () => {
    const anchor = note("A", [["A", "B"]]);
    const neighbors = new Map<string, Note>([
      ["B", note("B", [["B", "C"]])],
      ["C", note("C")],
    ]);
    const fetched: string[] = [];
    const fetchNote = async (id: string) => {
      fetched.push(id);
      return neighbors.get(id) ?? null;
    };
    const result = await expandNeighborhood(anchor, 3, fetchNote);
    expect(fetched).toEqual(["B", "C"]);
    expect([...result.keys()].sort()).toEqual(["A", "B", "C"]);
  });

  it("stops early if a layer has no new ids to fetch", async () => {
    const anchor = note("A", [["A", "A"]]);
    const fetchNote = async () => null;
    const result = await expandNeighborhood(anchor, 3, fetchNote);
    expect([...result.keys()]).toEqual(["A"]);
  });

  it("swallows per-node fetch errors and keeps the others", async () => {
    const anchor = note("A", [
      ["A", "B"],
      ["A", "C"],
    ]);
    const fetchNote = async (id: string) => {
      if (id === "B") throw new Error("boom");
      return note(id);
    };
    const result = await expandNeighborhood(anchor, 2, fetchNote);
    expect([...result.keys()].sort()).toEqual(["A", "C"]);
  });

  it("abandons a layer's fetched notes when cancellation is observed", async () => {
    const anchor = note("A", [["A", "B"]]);
    const signal = { cancelled: false };
    const fetchNote = async (id: string) => {
      if (id === "B") {
        signal.cancelled = true;
        return note(id);
      }
      return note(id);
    };
    const result = await expandNeighborhood(anchor, 3, fetchNote, signal);
    // Cancellation observed after layer 1's Promise.all — B is discarded.
    expect([...result.keys()]).toEqual(["A"]);
  });
});
