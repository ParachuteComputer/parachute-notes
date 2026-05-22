import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { YamlRenderer } from "./YamlRenderer";

describe("YamlRenderer", () => {
  it("renders YAML without throwing", () => {
    const yaml = "name: parachute\nversion: 0.3.15\nfeatures:\n  - notes\n  - vault\n";
    const { container } = render(<YamlRenderer content={yaml} />);
    const code = container.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code?.className).toMatch(/language-yaml/);
    // textContent collapses the highlight span markup back to the source.
    expect(code?.textContent).toContain("parachute");
    expect(code?.textContent).toContain("features:");
  });
});
