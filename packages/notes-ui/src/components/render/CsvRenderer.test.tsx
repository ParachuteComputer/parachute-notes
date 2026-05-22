import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CsvRenderer } from "./CsvRenderer";

describe("CsvRenderer", () => {
  it("renders a basic CSV as a table with first row as headers", () => {
    const { container } = render(<CsvRenderer content={"name,age\nAaron,40\nBert,32\n"} />);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    const ths = container.querySelectorAll("th");
    expect(Array.from(ths).map((th) => th.textContent)).toEqual(["name", "age"]);
    const tds = container.querySelectorAll("tbody td");
    expect(Array.from(tds).map((td) => td.textContent)).toEqual(["Aaron", "40", "Bert", "32"]);
  });

  it("matches snapshot for the basic case", () => {
    const { container } = render(<CsvRenderer content={"a,b\n1,2\n3,4\n"} />);
    // Snapshot the table only — the wrapper div has Tailwind classes we
    // don't care to lock down.
    expect(container.querySelector("table")?.outerHTML).toMatchInlineSnapshot(
      `"<table><thead><tr><th scope="col">a</th><th scope="col">b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>"`,
    );
  });

  it("preserves quoted commas + escaped quotes", () => {
    const { container } = render(
      <CsvRenderer content={'title,note\n"hello, world","he said ""hi"""\n'} />,
    );
    const tds = container.querySelectorAll("tbody td");
    expect(tds[0]?.textContent).toBe("hello, world");
    expect(tds[1]?.textContent).toBe('he said "hi"');
  });

  it("surfaces an inline warning when CSV is truncated", () => {
    const { container } = render(<CsvRenderer content={'a,b\n"unterminated'} />);
    expect(container.textContent).toMatch(/malformed/i);
  });

  it("falls back to plain pre when there are zero rows", () => {
    const { container } = render(<CsvRenderer content="" />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("pre")).not.toBeNull();
  });
});
