import { describe, expect, it } from "vitest";
import {
  AUTO_FOLDERED_NOTES_MIN,
  AUTO_TOP_LEVEL_MIN,
  buildPathTree,
  meetsAutoThreshold,
} from "./tree";

describe("buildPathTree", () => {
  it("derives a nested tree from folder paths", () => {
    const tree = buildPathTree([
      "Canon/Aaron/Log/2026.md",
      "Canon/Aaron/Draft.md",
      "Canon/Uni/Origin.md",
      "Corpus/Ideas/Seeds.md",
    ]);
    expect(tree.map((n) => n.name)).toEqual(["Canon", "Corpus"]);
    const canon = tree[0]!;
    expect(canon.fullPath).toBe("Canon");
    expect(canon.count).toBe(3);
    expect(canon.children.map((c) => c.name)).toEqual(["Aaron", "Uni"]);
    const aaron = canon.children[0]!;
    expect(aaron.fullPath).toBe("Canon/Aaron");
    expect(aaron.count).toBe(2);
    expect(aaron.children.map((c) => c.name)).toEqual(["Log"]);
    expect(aaron.children[0]!.fullPath).toBe("Canon/Aaron/Log");
    expect(aaron.children[0]!.count).toBe(1);
  });

  it("skips notes with no path or no folder segment", () => {
    const tree = buildPathTree([undefined, "loose-note.md", "", "Canon/draft.md"]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBe("Canon");
    expect(tree[0]!.count).toBe(1);
  });

  it("sorts children alphabetically at every level", () => {
    const tree = buildPathTree(["Zed/a.md", "Alpha/b.md", "Mid/z.md", "Mid/a/x.md"]);
    expect(tree.map((n) => n.name)).toEqual(["Alpha", "Mid", "Zed"]);
    expect(tree[1]!.children.map((c) => c.name)).toEqual(["a"]);
  });

  it("returns an empty tree for empty input", () => {
    expect(buildPathTree([])).toEqual([]);
  });
});

describe("meetsAutoThreshold", () => {
  it("returns true once the top-level folder count reaches the minimum", () => {
    const paths = Array.from({ length: AUTO_TOP_LEVEL_MIN }, (_, i) => `F${i}/n.md`);
    expect(meetsAutoThreshold(paths)).toBe(true);
  });

  it("returns true when foldered-note count reaches the minimum even from a single root", () => {
    const paths = Array.from({ length: AUTO_FOLDERED_NOTES_MIN }, (_, i) => `One/n${i}.md`);
    expect(meetsAutoThreshold(paths)).toBe(true);
  });

  it("returns false for sparse tag-flat vaults", () => {
    expect(meetsAutoThreshold(["a.md", "b.md", "One/x.md", "Two/y.md"])).toBe(false);
  });

  it("ignores notes without folder segments", () => {
    // AUTO_TOP_LEVEL_MIN distinct flat files do not meet the threshold.
    const flat = Array.from({ length: AUTO_TOP_LEVEL_MIN }, (_, i) => `file${i}.md`);
    expect(meetsAutoThreshold(flat)).toBe(false);
  });
});
