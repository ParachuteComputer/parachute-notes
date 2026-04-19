import { PathTree } from "@/components/PathTree";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("PathTree", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  function setup(opts: {
    paths: string[];
    currentPrefix?: string;
    onSelect?: (p: string) => void;
  }) {
    const onSelect = opts.onSelect ?? vi.fn();
    const utils = render(
      <PathTree
        paths={opts.paths}
        vaultId="v1"
        currentPrefix={opts.currentPrefix ?? ""}
        onSelect={onSelect}
      />,
    );
    return { onSelect, ...utils };
  }

  it("renders the empty placeholder when no folders are present", () => {
    setup({ paths: ["loose.md"] });
    expect(screen.getByText(/no folders yet/i)).toBeInTheDocument();
  });

  it("clicking a folder calls onSelect with the full prefix", () => {
    const { onSelect } = setup({
      paths: ["Canon/Aaron/log.md", "Canon/Uni/origin.md"],
    });
    fireEvent.click(screen.getByRole("button", { name: /^Canon\b/ }));
    expect(onSelect).toHaveBeenCalledWith("Canon");
  });

  it("expands a folder when its chevron is clicked", () => {
    setup({
      paths: ["Canon/Aaron/log.md", "Canon/Uni/origin.md"],
    });
    // Children are not rendered until the parent is open.
    expect(screen.queryByRole("button", { name: /^Aaron\b/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /expand canon/i }));
    expect(screen.getByRole("button", { name: /^Aaron\b/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Uni\b/ })).toBeInTheDocument();
  });

  it("auto-opens ancestors of the selected prefix", () => {
    setup({
      paths: ["Canon/Aaron/Log/2026.md"],
      currentPrefix: "Canon/Aaron/Log",
    });
    // Without ancestor force-open, "Aaron" and "Log" wouldn't be visible.
    expect(screen.getByRole("button", { name: /^Aaron\b/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Log\b/ })).toBeInTheDocument();
  });

  it("highlights the selected node and shows a Clear button", () => {
    const { onSelect } = setup({
      paths: ["Canon/Aaron/log.md"],
      currentPrefix: "Canon",
    });
    const canon = screen.getByRole("button", { name: /^Canon\b/ });
    expect(canon).toHaveAttribute("aria-current", "true");

    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(onSelect).toHaveBeenCalledWith("");
  });

  it("persists expand state across re-mount via localStorage", () => {
    const first = setup({ paths: ["Canon/Aaron/log.md"] });
    fireEvent.click(screen.getByRole("button", { name: /expand canon/i }));
    expect(screen.getByRole("button", { name: /^Aaron\b/ })).toBeInTheDocument();
    first.unmount();

    setup({ paths: ["Canon/Aaron/log.md"] });
    expect(screen.getByRole("button", { name: /^Aaron\b/ })).toBeInTheDocument();
  });
});
