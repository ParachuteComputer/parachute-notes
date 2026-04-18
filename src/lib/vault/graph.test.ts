import { describe, expect, it } from "vitest";
import { buildVaultGraph, collectTopTags, matchesFilter, tagColor, titleFor } from "./graph";
import type { Note } from "./types";

function n(id: string, opts: Partial<Note> = {}): Note {
  return {
    id,
    path: `notes/${id}`,
    createdAt: "2026-04-18T00:00:00.000Z",
    tags: [],
    ...opts,
  };
}

describe("buildVaultGraph", () => {
  it("produces one node per note and dedupes edges", () => {
    const notes: Note[] = [
      n("A", {
        links: [
          { sourceId: "A", targetId: "B", relationship: "wikilink" },
          { sourceId: "A", targetId: "B", relationship: "wikilink" },
        ],
      }),
      n("B", {
        links: [{ sourceId: "A", targetId: "B", relationship: "wikilink" }],
      }),
    ];
    const g = buildVaultGraph(notes);
    expect(g.nodes.map((x) => x.id).sort()).toEqual(["A", "B"]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toEqual({ source: "A", target: "B", relationship: "wikilink" });
  });

  it("drops edges that point outside the fetched note set", () => {
    const notes: Note[] = [
      n("A", {
        links: [
          { sourceId: "A", targetId: "B", relationship: "wikilink" },
          { sourceId: "A", targetId: "Z", relationship: "wikilink" },
        ],
      }),
      n("B"),
    ];
    const g = buildVaultGraph(notes);
    expect(g.nodes.map((x) => x.id).sort()).toEqual(["A", "B"]);
    expect(g.edges).toHaveLength(1);
  });

  it("computes degree per node", () => {
    const notes: Note[] = [
      n("A", {
        links: [
          { sourceId: "A", targetId: "B", relationship: "wikilink" },
          { sourceId: "A", targetId: "C", relationship: "wikilink" },
        ],
      }),
      n("B", {
        links: [{ sourceId: "B", targetId: "C", relationship: "wikilink" }],
      }),
      n("C"),
    ];
    const g = buildVaultGraph(notes);
    const byId = Object.fromEntries(g.nodes.map((x) => [x.id, x]));
    expect(byId.A.degree).toBe(2);
    expect(byId.B.degree).toBe(2);
    expect(byId.C.degree).toBe(2);
  });

  it("captures tags, top tag, and summary", () => {
    const notes: Note[] = [
      n("A", {
        tags: ["canon", "uni"],
        metadata: { summary: "anchor summary" },
      }),
    ];
    const g = buildVaultGraph(notes);
    expect(g.nodes[0].tags).toEqual(["canon", "uni"]);
    expect(g.nodes[0].topTag).toBe("canon");
    expect(g.nodes[0].summary).toBe("anchor summary");
  });
});

describe("titleFor", () => {
  it("strips .md and returns the path basename", () => {
    expect(titleFor(n("A", { path: "Canon/Uni.md" }))).toBe("Uni");
  });
  it("falls back to id when path is missing", () => {
    expect(titleFor(n("id-only", { path: undefined }))).toBe("id-only");
  });
});

describe("matchesFilter", () => {
  const node = {
    id: "a-1",
    path: "Projects/Lens.md",
    title: "Lens",
    tags: ["project", "active"],
    degree: 3,
  };

  it("matches all nodes when filter is empty", () => {
    expect(matchesFilter(node, { search: "", tags: [] })).toBe(true);
  });

  it("matches path substring case-insensitively", () => {
    expect(matchesFilter(node, { search: "LENS", tags: [] })).toBe(true);
    expect(matchesFilter(node, { search: "projects", tags: [] })).toBe(true);
    expect(matchesFilter(node, { search: "xyz", tags: [] })).toBe(false);
  });

  it("matches any selected tag (OR semantics)", () => {
    expect(matchesFilter(node, { search: "", tags: ["project"] })).toBe(true);
    expect(matchesFilter(node, { search: "", tags: ["project", "canon"] })).toBe(true);
    expect(matchesFilter(node, { search: "", tags: ["canon"] })).toBe(false);
  });

  it("combines search and tags with AND", () => {
    expect(matchesFilter(node, { search: "Lens", tags: ["project"] })).toBe(true);
    expect(matchesFilter(node, { search: "Lens", tags: ["canon"] })).toBe(false);
    expect(matchesFilter(node, { search: "xyz", tags: ["project"] })).toBe(false);
  });
});

describe("collectTopTags", () => {
  it("orders by count desc, then alpha", () => {
    const nodes = [
      { id: "1", title: "1", tags: ["a", "b"], degree: 0 },
      { id: "2", title: "2", tags: ["a"], degree: 0 },
      { id: "3", title: "3", tags: ["c"], degree: 0 },
    ];
    expect(collectTopTags(nodes)).toEqual(["a", "b", "c"]);
  });
});

describe("tagColor", () => {
  it("is stable for the same input", () => {
    expect(tagColor("canon")).toBe(tagColor("canon"));
  });
  it("returns a default when tag is undefined", () => {
    expect(tagColor(undefined)).toMatch(/^#/);
  });
});
