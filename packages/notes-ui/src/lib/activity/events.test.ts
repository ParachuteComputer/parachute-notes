import type { Note } from "@/lib/vault/types";
import { describe, expect, it } from "vitest";
import { bucketOf, buildActivityEvents, groupEventsByBucket } from "./events";

// All ISO timestamps in this file are local-time built from `new Date(...)`
// then `.toISOString()` so bucketing matches the test clock regardless of
// the host timezone.
function localIso(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour).toISOString();
}

const NOW = new Date(2026, 3, 18, 12, 0, 0);

describe("buildActivityEvents", () => {
  it("returns an empty list for no notes", () => {
    expect(buildActivityEvents([], 30, NOW)).toEqual([]);
  });

  it("emits a `created` event for a note inside the window", () => {
    const notes: Note[] = [{ id: "n1", path: "Morning.md", createdAt: localIso(2026, 4, 18, 9) }];
    const events = buildActivityEvents(notes, 30, NOW);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "n1:created",
      noteId: "n1",
      noteName: "Morning.md",
      kind: "created",
    });
  });

  it("emits both `created` and `updated` when updated is later than created", () => {
    const notes: Note[] = [
      {
        id: "n1",
        path: "Edited.md",
        createdAt: localIso(2026, 4, 15, 10),
        updatedAt: localIso(2026, 4, 18, 14),
      },
    ];
    const events = buildActivityEvents(notes, 30, NOW);
    expect(events.map((e) => e.kind)).toEqual(["updated", "created"]);
    expect(events[0]?.id).toBe("n1:updated");
    expect(events[1]?.id).toBe("n1:created");
  });

  it("collapses near-simultaneous create+update into a single `created` event", () => {
    // Vault PR 6 sets updated_at = created_at on insert; a follow-up edit
    // within 5 seconds is treated as part of the same capture.
    const created = localIso(2026, 4, 18, 9);
    const updated = new Date(Date.parse(created) + 1_000).toISOString();
    const notes: Note[] = [{ id: "n1", path: "Quick.md", createdAt: created, updatedAt: updated }];
    const events = buildActivityEvents(notes, 30, NOW);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("created");
  });

  it("drops events outside the window", () => {
    const notes: Note[] = [
      { id: "old", path: "Old.md", createdAt: localIso(2026, 1, 1, 10) },
      { id: "new", path: "New.md", createdAt: localIso(2026, 4, 17, 10) },
    ];
    const events = buildActivityEvents(notes, 30, NOW);
    expect(events.map((e) => e.noteId)).toEqual(["new"]);
  });

  it("sorts events newest-first by timestamp", () => {
    const notes: Note[] = [
      { id: "a", path: "A.md", createdAt: localIso(2026, 4, 10, 10) },
      { id: "b", path: "B.md", createdAt: localIso(2026, 4, 17, 10) },
      { id: "c", path: "C.md", createdAt: localIso(2026, 4, 15, 10) },
    ];
    const events = buildActivityEvents(notes, 30, NOW);
    expect(events.map((e) => e.noteId)).toEqual(["b", "c", "a"]);
  });

  it("falls back to id when path is missing", () => {
    const notes: Note[] = [{ id: "n1", createdAt: localIso(2026, 4, 18, 9) }];
    const events = buildActivityEvents(notes, 30, NOW);
    expect(events[0]?.noteName).toBe("n1");
  });

  it("carries preview and tags onto each event", () => {
    const notes: Note[] = [
      {
        id: "n1",
        path: "Tagged.md",
        createdAt: localIso(2026, 4, 18, 9),
        preview: "first line",
        tags: ["work", "urgent"],
      },
    ];
    const events = buildActivityEvents(notes, 30, NOW);
    expect(events[0]?.preview).toBe("first line");
    expect(events[0]?.tags).toEqual(["work", "urgent"]);
  });
});

describe("bucketOf", () => {
  it("classifies same-day timestamps as today", () => {
    expect(bucketOf(localIso(2026, 4, 18, 8), NOW)).toBe("today");
    expect(bucketOf(localIso(2026, 4, 18, 23), NOW)).toBe("today");
  });

  it("classifies prior-day as yesterday", () => {
    expect(bucketOf(localIso(2026, 4, 17, 9), NOW)).toBe("yesterday");
  });

  it("classifies days 2–6 ago as thisWeek", () => {
    expect(bucketOf(localIso(2026, 4, 16, 9), NOW)).toBe("thisWeek");
    expect(bucketOf(localIso(2026, 4, 12, 9), NOW)).toBe("thisWeek");
  });

  it("classifies anything 7+ days ago as older", () => {
    expect(bucketOf(localIso(2026, 4, 11, 9), NOW)).toBe("older");
    expect(bucketOf(localIso(2026, 1, 1, 9), NOW)).toBe("older");
  });

  it("returns null for unparseable timestamps", () => {
    expect(bucketOf("not-a-date", NOW)).toBeNull();
  });
});

describe("groupEventsByBucket", () => {
  it("places events in the right bucket and preserves order within each", () => {
    const notes: Note[] = [
      { id: "today1", path: "T1.md", createdAt: localIso(2026, 4, 18, 11) },
      { id: "today2", path: "T2.md", createdAt: localIso(2026, 4, 18, 8) },
      { id: "yest", path: "Y.md", createdAt: localIso(2026, 4, 17, 10) },
      { id: "wk", path: "W.md", createdAt: localIso(2026, 4, 14, 10) },
      { id: "old", path: "O.md", createdAt: localIso(2026, 4, 1, 10) },
    ];
    const events = buildActivityEvents(notes, 30, NOW);
    const groups = groupEventsByBucket(events, NOW);
    expect(groups.today.map((e) => e.noteId)).toEqual(["today1", "today2"]);
    expect(groups.yesterday.map((e) => e.noteId)).toEqual(["yest"]);
    expect(groups.thisWeek.map((e) => e.noteId)).toEqual(["wk"]);
    expect(groups.older.map((e) => e.noteId)).toEqual(["old"]);
  });
});
