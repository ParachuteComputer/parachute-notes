import { describe, expect, it } from "vitest";
import { fuzzyScore } from "./fuzzy";

describe("fuzzyScore", () => {
  it("returns null when the query can't be found as a subsequence", () => {
    expect(fuzzyScore("xyz", "abc")).toBeNull();
    expect(fuzzyScore("ba", "abc")).toBeNull();
  });

  it("treats an empty query as a zero-score match", () => {
    expect(fuzzyScore("", "anything")).toEqual({ score: 0, indices: [] });
  });

  it("rewards start-of-string matches over mid-string matches", () => {
    const atStart = fuzzyScore("can", "canon/note")!;
    const inMiddle = fuzzyScore("can", "x canon/note")!;
    expect(atStart.score).toBeGreaterThan(inMiddle.score);
  });

  it("rewards word-boundary matches (after /, -, _, .)", () => {
    const afterSlash = fuzzyScore("aa", "canon/alpha")!;
    const plain = fuzzyScore("aa", "canonalpha")!;
    // "canon/alpha" — 'a' in 'canon' (ti=1), 'a' in 'alpha' after /
    // vs "canonalpha" — 'a' in 'canon' (ti=1), 'a' in 'alpha' (ti=5)
    expect(afterSlash.score).toBeGreaterThan(plain.score);
  });

  it("rewards consecutive runs over scattered matches", () => {
    const run = fuzzyScore("note", "note")!;
    const scattered = fuzzyScore("note", "n-o-t-e")!;
    expect(run.score).toBeGreaterThan(scattered.score);
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("CANON", "canon/foo")).not.toBeNull();
    expect(fuzzyScore("canon", "CANON/FOO")).not.toBeNull();
  });

  it("records the indices of the matched characters", () => {
    const m = fuzzyScore("cno", "canon")!;
    // c at 0, next n at 2, next o at 3 — greedy left-to-right.
    expect(m.indices).toEqual([0, 2, 3]);
  });

  it("lightly penalizes very long targets so shorter files bubble up", () => {
    const short = fuzzyScore("x", "x")!;
    const long = fuzzyScore("x", `x${"a".repeat(200)}`)!;
    expect(short.score).toBeGreaterThan(long.score);
  });
});
