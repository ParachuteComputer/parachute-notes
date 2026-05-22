import type { Note } from "@/lib/vault/types";
import { describe, expect, it } from "vitest";
import {
  SAVED_VIEW_KIND,
  VIEWS_PATH_PREFIX,
  decodeView,
  encodeFiltersMetadata,
  filtersToSearchParams,
  isFiltersNonEmpty,
  nameFromPath,
  pathForName,
  searchParamsToFilters,
} from "./spec";

describe("encodeFiltersMetadata", () => {
  it("emits kind and only the non-empty filter fields", () => {
    expect(encodeFiltersMetadata({ search: "  hello  ", tags: [] })).toEqual({
      kind: SAVED_VIEW_KIND,
      filters: { search: "hello" },
    });
  });

  it("includes tagMatch only when more than one tag is selected", () => {
    expect(encodeFiltersMetadata({ tags: ["a"], tagMatch: "all" })).toEqual({
      kind: SAVED_VIEW_KIND,
      filters: { tags: ["a"] },
    });
    expect(encodeFiltersMetadata({ tags: ["a", "b"], tagMatch: "all" })).toEqual({
      kind: SAVED_VIEW_KIND,
      filters: { tags: ["a", "b"], tagMatch: "all" },
    });
  });

  it("preserves sort, pathPrefix, and showArchived when set", () => {
    const out = encodeFiltersMetadata({
      pathPrefix: "Projects/",
      sort: "asc",
      showArchived: true,
    });
    expect(out.filters).toEqual({
      pathPrefix: "Projects/",
      sort: "asc",
      showArchived: true,
    });
  });
});

describe("decodeView", () => {
  const baseNote = (extras: Partial<Note> = {}): Note => ({
    id: "v1",
    path: "UI/Views/Daily.md",
    createdAt: "2026-04-19T00:00:00Z",
    metadata: { kind: SAVED_VIEW_KIND, filters: { search: "x", tags: ["a"] } },
    ...extras,
  });

  it("returns null when metadata isn't a saved view", () => {
    expect(decodeView({ ...baseNote(), metadata: undefined })).toBeNull();
    expect(decodeView({ ...baseNote(), metadata: { kind: "note" } })).toBeNull();
  });

  it("decodes a well-formed saved view", () => {
    const v = decodeView(baseNote());
    expect(v).not.toBeNull();
    expect(v?.id).toBe("v1");
    expect(v?.name).toBe("Daily");
    expect(v?.filters.search).toBe("x");
    expect(v?.filters.tags).toEqual(["a"]);
  });

  it("falls back to id when path is outside the views folder", () => {
    const v = decodeView(baseNote({ path: "Random/Note.md" }));
    expect(v?.name).toBe("v1");
  });

  it("ignores junk values for sort, tagMatch, and showArchived", () => {
    const v = decodeView(
      baseNote({
        metadata: {
          kind: SAVED_VIEW_KIND,
          filters: { sort: "bogus", tagMatch: "wat", showArchived: "yes" },
        },
      }),
    );
    expect(v?.filters.sort).toBeUndefined();
    expect(v?.filters.tagMatch).toBeUndefined();
    expect(v?.filters.showArchived).toBe(false);
  });

  it("filters non-string entries out of tags", () => {
    const v = decodeView(
      baseNote({
        metadata: { kind: SAVED_VIEW_KIND, filters: { tags: ["a", 7, null, "b"] } },
      }),
    );
    expect(v?.filters.tags).toEqual(["a", "b"]);
  });
});

describe("nameFromPath / pathForName", () => {
  it("nameFromPath strips the prefix and trailing .md", () => {
    expect(nameFromPath("UI/Views/Daily.md")).toBe("Daily");
    expect(nameFromPath("UI/Views/Untagged")).toBe("Untagged");
    expect(nameFromPath("Other/Path.md")).toBeNull();
    expect(nameFromPath(undefined)).toBeNull();
  });

  it("pathForName slots the name into the prefix and rejects slashes", () => {
    expect(pathForName("Daily")).toBe(`${VIEWS_PATH_PREFIX}Daily`);
    expect(pathForName("  Daily  ")).toBe(`${VIEWS_PATH_PREFIX}Daily`);
    expect(pathForName("a/b")).toBe(`${VIEWS_PATH_PREFIX}a-b`);
  });
});

describe("filtersToSearchParams round-trip", () => {
  it("encodes every filter dimension and parses it back identically", () => {
    const filters = {
      search: "draft",
      tags: ["alpha", "beta"],
      tagMatch: "all" as const,
      pathPrefix: "Projects/",
      sort: "asc" as const,
      showArchived: true,
    };
    const params = filtersToSearchParams(filters);
    expect(params.get("search")).toBe("draft");
    expect(params.getAll("tag")).toEqual(["alpha", "beta"]);
    expect(params.get("tag_match")).toBe("all");
    expect(params.get("path_prefix")).toBe("Projects/");
    expect(params.get("sort")).toBe("asc");
    expect(params.get("show_archived")).toBe("1");

    const back = searchParamsToFilters(params);
    expect(back).toEqual(filters);
  });

  it("omits empty fields from the URL", () => {
    expect(filtersToSearchParams({ search: "  " }).toString()).toBe("");
  });

  it("searchParamsToFilters tolerates an empty URL", () => {
    expect(searchParamsToFilters(new URLSearchParams()).tags).toBeUndefined();
  });
});

describe("isFiltersNonEmpty", () => {
  it("returns true when any of search, tags, or pathPrefix is present", () => {
    expect(isFiltersNonEmpty({ search: "x" })).toBe(true);
    expect(isFiltersNonEmpty({ tags: ["a"] })).toBe(true);
    expect(isFiltersNonEmpty({ pathPrefix: "P/" })).toBe(true);
  });

  it("returns false for sort/showArchived alone — they don't make a meaningful saved view", () => {
    expect(isFiltersNonEmpty({ sort: "asc" })).toBe(false);
    expect(isFiltersNonEmpty({ showArchived: true })).toBe(false);
    expect(isFiltersNonEmpty({})).toBe(false);
  });
});
