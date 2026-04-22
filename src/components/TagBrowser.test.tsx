import { TagBrowser } from "@/components/TagBrowser";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("TagBrowser", () => {
  const baseProps = {
    onToggle: () => {},
    onClear: () => {},
  };

  it("renders tags sorted by count descending by default", () => {
    render(
      <TagBrowser
        {...baseProps}
        tags={[
          { name: "idea", count: 2 },
          { name: "journal", count: 8 },
          { name: "project", count: 5 },
        ]}
        pinnedTags={[]}
        selected={[]}
      />,
    );
    const buttons = screen
      .getAllByRole("button")
      .filter((b) => b.title?.startsWith("#"));
    expect(buttons.map((b) => b.title)).toEqual([
      "#journal",
      "#project",
      "#idea",
    ]);
  });

  it("floats pinned tags to the top regardless of count", () => {
    render(
      <TagBrowser
        {...baseProps}
        tags={[
          { name: "big", count: 100 },
          { name: "small", count: 1 },
        ]}
        pinnedTags={["small"]}
        selected={[]}
      />,
    );
    const buttons = screen
      .getAllByRole("button")
      .filter((b) => b.title?.startsWith("#"));
    expect(buttons[0]?.title).toBe("#small");
  });

  it("groups slash-delimited tags under a collapsible parent", () => {
    render(
      <TagBrowser
        {...baseProps}
        tags={[
          { name: "summary/daily", count: 10 },
          { name: "summary/weekly", count: 3 },
        ]}
        pinnedTags={[]}
        selected={[]}
      />,
    );
    // Group is collapsed by default — children hidden.
    expect(screen.queryByTitle("#summary/daily")).toBeNull();
    const expand = screen.getByRole("button", { name: /Expand summary/i });
    fireEvent.click(expand);
    expect(screen.getByTitle("#summary/daily")).toBeInTheDocument();
    expect(screen.getByTitle("#summary/weekly")).toBeInTheDocument();
  });

  // TODO Test group-badge shows summed child count
  it("shows the summed child count on a collapsed group badge", () => {
    render(
      <TagBrowser
        {...baseProps}
        tags={[
          { name: "summary/daily", count: 10 },
          { name: "summary/weekly", count: 3 },
        ]}
        pinnedTags={[]}
        selected={[]}
      />,
    );

    expect(screen.getByText("13")).toBeInTheDocument();
  });

  it("includes the parent tag count in the collapsed group badge when parent tag exists", () => {
    render(
      <TagBrowser
        {...baseProps}
        tags={[
          { name: "summary", count: 2 },
          { name: "summary/daily", count: 10 },
          { name: "summary/weekly", count: 3 },
        ]}
        pinnedTags={[]}
        selected={[]}
      />,
    );

    expect(screen.getByText("15")).toBeInTheDocument();
  });

  it("fires onToggle with the tag name on click", () => {
    const onToggle = vi.fn();
    render(
      <TagBrowser
        {...baseProps}
        onToggle={onToggle}
        tags={[{ name: "journal", count: 3 }]}
        pinnedTags={[]}
        selected={[]}
      />,
    );
    fireEvent.click(screen.getByTitle("#journal"));
    expect(onToggle).toHaveBeenCalledWith("journal");
  });

  it("auto-expands a group when one of its children is selected", () => {
    render(
      <TagBrowser
        {...baseProps}
        tags={[
          { name: "summary/daily", count: 10 },
          { name: "summary/weekly", count: 3 },
        ]}
        pinnedTags={[]}
        selected={["summary/daily"]}
      />,
    );
    const daily = screen.getByTitle("#summary/daily");
    expect(daily).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a Clear button when selection is non-empty", () => {
    const onClear = vi.fn();
    render(
      <TagBrowser
        {...baseProps}
        onClear={onClear}
        tags={[{ name: "idea", count: 2 }]}
        pinnedTags={[]}
        selected={["idea"]}
      />,
    );
    const clear = screen.getByRole("button", { name: /clear/i });
    fireEvent.click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("renders the tag-browser nav with Tags heading at the top of the sidebar", () => {
    render(
      <TagBrowser
        {...baseProps}
        tags={[{ name: "idea", count: 2 }]}
        pinnedTags={[]}
        selected={[]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: /browse by tag/i });
    expect(within(nav).getByText(/^Tags$/)).toBeInTheDocument();
  });
});
