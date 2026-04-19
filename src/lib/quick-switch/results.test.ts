import { describe, expect, it } from "vitest";
import { COMMANDS, computeResults } from "./results";

const note = (
  id: string,
  extras: Partial<Parameters<typeof computeResults>[0]["notes"][number]> = {},
) => ({
  id,
  createdAt: "2026-04-18T00:00:00Z",
  ...extras,
});

describe("computeResults", () => {
  it("returns recent notes then commands when query is empty", () => {
    const notes = [note("n1", { path: "Canon/Aaron.md" }), note("n2", { path: "Journal/Day.md" })];
    const results = computeResults({
      query: "",
      notes,
      tags: [],
      recents: [{ id: "n1", viewedAt: 100 }],
    });
    expect(results[0]).toMatchObject({ kind: "note", id: "n1" });
    // commands after recents
    const commandIds = results
      .filter((r) => r.kind === "command")
      .map((r) => (r.kind === "command" ? r.id : null));
    expect(commandIds).toContain("new");
    expect(commandIds).toContain("capture");
  });

  it("drops recent ids whose notes are no longer in the vault", () => {
    const results = computeResults({
      query: "",
      notes: [note("n1")],
      tags: [],
      recents: [
        { id: "missing", viewedAt: 200 },
        { id: "n1", viewedAt: 100 },
      ],
    });
    const noteEntries = results.filter((r) => r.kind === "note");
    expect(noteEntries).toHaveLength(1);
    expect(noteEntries[0]?.kind === "note" && noteEntries[0].id).toBe("n1");
  });

  it("fuzzy-matches notes by title, path, and tags", () => {
    const notes = [
      note("n1", { path: "Canon/Aaron.md", content: "# Aaron" }),
      note("n2", { path: "Journal/Day.md", tags: ["daily"] }),
      note("n3", { path: "Ideas/Music.md", content: "Notes on synths" }),
    ];
    const results = computeResults({ query: "aar", notes, tags: [], recents: [] });
    expect(results[0]?.kind).toBe("note");
    expect(results[0]?.kind === "note" && results[0].id).toBe("n1");
  });

  it("ranks title matches above path-only matches when everything else is equal", () => {
    const notes = [
      note("pathOnly", { path: "alpha/daily.md", content: "# Unrelated" }),
      note("titleWins", { path: "other.md", content: "# daily" }),
    ];
    const results = computeResults({ query: "daily", notes, tags: [], recents: [] });
    expect(results[0]?.kind === "note" && results[0].id).toBe("titleWins");
  });

  it("includes tag matches below note matches", () => {
    const results = computeResults({
      query: "daily",
      notes: [note("n1", { path: "Daily.md" })],
      tags: [{ name: "daily", count: 12 }],
      recents: [],
    });
    expect(results.some((r) => r.kind === "tag" && r.name === "daily")).toBe(true);
  });

  it("in command mode (> prefix) surfaces only commands", () => {
    const results = computeResults({
      query: "> new",
      notes: [note("n1", { path: "newborn.md" })],
      tags: [],
      recents: [],
    });
    expect(results.every((r) => r.kind === "command")).toBe(true);
    expect(results[0]?.kind === "command" && results[0].id).toBe("new");
  });

  it("command mode 'g' picks graph as the top hit", () => {
    const results = computeResults({ query: ">graph", notes: [], tags: [], recents: [] });
    expect(results[0]?.kind === "command" && results[0].id).toBe("graph");
  });

  it("caps the total at 20 results", () => {
    const notes = Array.from({ length: 50 }, (_, i) => note(`n${i}`, { path: `match${i}.md` }));
    const results = computeResults({ query: "match", notes, tags: [], recents: [] });
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it("returns an empty list for a query that matches nothing", () => {
    expect(
      computeResults({
        query: "zxqwv",
        notes: [note("n1", { path: "a.md" })],
        tags: [],
        recents: [],
      }),
    ).toEqual([]);
  });

  it("exposes the static command list so tests can drive by id", () => {
    expect(COMMANDS.map((c) => c.id)).toEqual(["new", "capture", "graph", "tags", "notes"]);
  });
});
