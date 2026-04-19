import { describe, expect, it } from "vitest";
import { noteTitle } from "./title";

describe("noteTitle", () => {
  it("uses the first non-empty line of content", () => {
    expect(noteTitle({ id: "a", content: "Hello world\n\nmore text" })).toBe("Hello world");
  });

  it("strips leading markdown heading hashes", () => {
    expect(noteTitle({ id: "a", content: "# Canon/Aaron" })).toBe("Canon/Aaron");
    expect(noteTitle({ id: "a", content: "### Deep" })).toBe("Deep");
  });

  it("skips leading blank lines", () => {
    expect(noteTitle({ id: "a", content: "\n\n\nfirst real line" })).toBe("first real line");
  });

  it("falls back to the last path segment without .md", () => {
    expect(noteTitle({ id: "abc", path: "Canon/Aaron.md" })).toBe("Aaron");
    expect(noteTitle({ id: "abc", path: "notes/journal/day.md" })).toBe("day");
  });

  it("strips .md case-insensitively", () => {
    expect(noteTitle({ id: "abc", path: "Foo.MD" })).toBe("Foo");
  });

  it("falls back to id when there is nothing else", () => {
    expect(noteTitle({ id: "abc" })).toBe("abc");
  });

  it("prefers content over path when both exist", () => {
    expect(noteTitle({ id: "x", path: "Some/Path.md", content: "Content wins" })).toBe(
      "Content wins",
    );
  });
});
