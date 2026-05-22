import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a basic two-column file", () => {
    const { rows, truncated } = parseCsv("name,age\nAaron,40\nBert,32\n");
    expect(truncated).toBe(false);
    expect(rows).toEqual([
      ["name", "age"],
      ["Aaron", "40"],
      ["Bert", "32"],
    ]);
  });

  it("handles a missing trailing newline", () => {
    const { rows } = parseCsv("name,age\nAaron,40");
    expect(rows).toEqual([
      ["name", "age"],
      ["Aaron", "40"],
    ]);
  });

  it("handles quoted cells containing commas", () => {
    const { rows } = parseCsv('title,note\n"hello, world","a, b, c"\n');
    expect(rows).toEqual([
      ["title", "note"],
      ["hello, world", "a, b, c"],
    ]);
  });

  it("handles escaped quotes inside a quoted cell", () => {
    const { rows } = parseCsv('quote\n"she said ""hi"""\n');
    expect(rows).toEqual([["quote"], [`she said "hi"`]]);
  });

  it("handles newlines inside a quoted cell", () => {
    const { rows } = parseCsv('a,b\n"line one\nline two",ok\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["line one\nline two", "ok"],
    ]);
  });

  it("handles CRLF line endings", () => {
    const { rows } = parseCsv("a,b\r\n1,2\r\n3,4\r\n");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("parses a single-column file", () => {
    const { rows } = parseCsv("alpha\nbeta\ngamma\n");
    expect(rows).toEqual([["alpha"], ["beta"], ["gamma"]]);
  });

  it("returns no rows for empty input", () => {
    expect(parseCsv("")).toEqual({ rows: [], truncated: false });
  });

  it("flags truncated on an unterminated quote", () => {
    // EOF inside a quoted cell — surface what we managed to extract but mark
    // truncated so the renderer can warn.
    const { rows, truncated } = parseCsv('a,b\n"unterminated');
    expect(truncated).toBe(true);
    expect(rows[0]).toEqual(["a", "b"]);
  });

  it("preserves empty cells", () => {
    const { rows } = parseCsv("a,b,c\n,2,\n");
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["", "2", ""],
    ]);
  });
});
