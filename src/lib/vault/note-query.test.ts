import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTE_QUERY,
  type NoteQueryState,
  buildNoteQueryParams,
  isFilteringActive,
} from "./note-query";

function state(overrides: Partial<NoteQueryState> = {}): NoteQueryState {
  return { ...DEFAULT_NOTE_QUERY, ...overrides };
}

describe("buildNoteQueryParams", () => {
  it("emits sort and limit even with no filters", () => {
    const params = buildNoteQueryParams(state());
    expect(params.get("sort")).toBe("desc");
    expect(params.get("limit")).toBe("50");
    expect(params.get("search")).toBeNull();
    expect(params.get("tag")).toBeNull();
    expect(params.get("offset")).toBeNull();
  });

  it("omits offset when zero, emits when positive", () => {
    expect(buildNoteQueryParams(state({ offset: 0 })).get("offset")).toBeNull();
    expect(buildNoteQueryParams(state({ offset: 50 })).get("offset")).toBe("50");
  });

  it("trims whitespace from search and drops when blank", () => {
    expect(buildNoteQueryParams(state({ search: "   " })).get("search")).toBeNull();
    expect(buildNoteQueryParams(state({ search: "  hello  " })).get("search")).toBe("hello");
  });

  it("joins tags comma-separated", () => {
    const params = buildNoteQueryParams(state({ tags: ["daily", "work"] }));
    expect(params.get("tag")).toBe("daily,work");
  });

  it("includes tag_match only when 2+ tags are selected", () => {
    expect(
      buildNoteQueryParams(state({ tags: ["daily"], tagMatch: "all" })).get("tag_match"),
    ).toBeNull();
    expect(
      buildNoteQueryParams(state({ tags: ["daily", "work"], tagMatch: "all" })).get("tag_match"),
    ).toBe("all");
    expect(
      buildNoteQueryParams(state({ tags: ["daily", "work"], tagMatch: "any" })).get("tag_match"),
    ).toBe("any");
  });

  it("passes path_prefix when present, trims blanks", () => {
    expect(buildNoteQueryParams(state({ pathPrefix: "   " })).get("path_prefix")).toBeNull();
    expect(buildNoteQueryParams(state({ pathPrefix: " Projects/" })).get("path_prefix")).toBe(
      "Projects/",
    );
  });

  it("respects explicit sort direction", () => {
    expect(buildNoteQueryParams(state({ sort: "asc" })).get("sort")).toBe("asc");
  });

  it("emits has_tags when set explicitly, omits when undefined", () => {
    expect(buildNoteQueryParams(state()).get("has_tags")).toBeNull();
    expect(buildNoteQueryParams(state({ hasTags: false })).get("has_tags")).toBe("false");
    expect(buildNoteQueryParams(state({ hasTags: true })).get("has_tags")).toBe("true");
  });

  it("emits has_links when set explicitly, omits when undefined", () => {
    expect(buildNoteQueryParams(state()).get("has_links")).toBeNull();
    expect(buildNoteQueryParams(state({ hasLinks: false })).get("has_links")).toBe("false");
    expect(buildNoteQueryParams(state({ hasLinks: true })).get("has_links")).toBe("true");
  });
});

describe("isFilteringActive", () => {
  it("is false by default", () => {
    expect(isFilteringActive(state())).toBe(false);
  });

  it("is true when any filter is set", () => {
    expect(isFilteringActive(state({ search: "foo" }))).toBe(true);
    expect(isFilteringActive(state({ tags: ["daily"] }))).toBe(true);
    expect(isFilteringActive(state({ pathPrefix: "Projects/" }))).toBe(true);
  });

  it("ignores trivially-blank search/prefix", () => {
    expect(isFilteringActive(state({ search: "   " }))).toBe(false);
    expect(isFilteringActive(state({ pathPrefix: "   " }))).toBe(false);
  });
});
