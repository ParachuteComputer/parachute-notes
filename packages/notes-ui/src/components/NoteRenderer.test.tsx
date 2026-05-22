import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoteRenderer } from "./NoteRenderer";

// Wikilink resolver isn't exercised in dispatch tests — pass a no-op.
const NO_RESOLVE = () => null;

describe("NoteRenderer", () => {
  it("dispatches to markdown for no extension", () => {
    const { container } = render(
      <NoteRenderer note={{ path: "Daily/2026-05-18", content: "# Hello" }} resolve={NO_RESOLVE} />,
    );
    // Markdown rendering produces an <h1> from `# Hello`.
    expect(container.querySelector("h1")?.textContent).toBe("Hello");
  });

  it("dispatches to markdown for .md", () => {
    const { container } = render(
      <NoteRenderer note={{ path: "notes/foo.md", content: "**bold**" }} resolve={NO_RESOLVE} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });

  it("dispatches to CSV for .csv", () => {
    const { container } = render(
      <NoteRenderer
        note={{ path: "data/ledger.csv", content: "name,age\nA,1\n" }}
        resolve={NO_RESOLVE}
      />,
    );
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("dispatches to JSON for .json (and pretty-prints)", () => {
    const { container } = render(
      <NoteRenderer
        note={{ path: "config.json", content: '{"a":1,"b":2}' }}
        resolve={NO_RESOLVE}
      />,
    );
    const code = container.querySelector("pre code");
    expect(code?.className).toMatch(/language-json/);
    expect(code?.textContent).toMatch(/"a": 1/);
  });

  it("dispatches to YAML for .yml", () => {
    const { container } = render(
      <NoteRenderer note={{ path: "x.yml", content: "a: 1\n" }} resolve={NO_RESOLVE} />,
    );
    expect(container.querySelector("pre code")?.className).toMatch(/language-yaml/);
  });

  it("dispatches to code for known code extensions", () => {
    const { container } = render(
      <NoteRenderer
        note={{ path: "foo.ts", content: "const x: number = 1;" }}
        resolve={NO_RESOLVE}
      />,
    );
    expect(container.querySelector("pre code")?.className).toMatch(/language-typescript/);
  });

  it("falls back to plain text for an unknown extension", () => {
    const { container } = render(
      <NoteRenderer note={{ path: "blob.xyz", content: "weird bytes" }} resolve={NO_RESOLVE} />,
    );
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe("weird bytes");
    // No syntax highlighting on the fallback path.
    expect(pre?.querySelector("code")?.className ?? "").not.toMatch(/language-/);
  });

  it("falls back to plain on JSON parse error", () => {
    const { container } = render(
      <NoteRenderer note={{ path: "bad.json", content: "{ broken" }} resolve={NO_RESOLVE} />,
    );
    const code = container.querySelector("pre code");
    expect(code?.textContent).toBe("{ broken");
    expect(code?.className ?? "").not.toMatch(/language-json/);
  });
});
