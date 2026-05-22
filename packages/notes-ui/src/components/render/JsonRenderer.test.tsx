import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JsonRenderer } from "./JsonRenderer";

describe("JsonRenderer", () => {
  it("pretty-prints valid JSON", () => {
    const { container } = render(<JsonRenderer content={'{"a":1,"b":[2,3]}'} />);
    const code = container.querySelector("pre code");
    expect(code).not.toBeNull();
    // Pretty-printed output contains newlines + 2-space indent.
    const text = code?.textContent ?? "";
    expect(text).toMatch(/"a": 1/);
    expect(text).toMatch(/"b": \[/);
    expect(text.includes("\n")).toBe(true);
  });

  it("emits a hljs language-json class for highlighting", () => {
    const { container } = render(<JsonRenderer content={'{"a":1}'} />);
    const code = container.querySelector("pre code");
    expect(code?.className).toMatch(/language-json/);
    expect(code?.className).toMatch(/hljs/);
  });

  it("falls back to plain pre on invalid JSON", () => {
    const { container } = render(<JsonRenderer content="{ not json" />);
    const code = container.querySelector("pre code");
    expect(code?.textContent).toBe("{ not json");
    // No language- class on the fallback path.
    expect(code?.className ?? "").not.toMatch(/language-json/);
  });
});
