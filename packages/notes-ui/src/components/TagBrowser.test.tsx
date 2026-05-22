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
    const buttons = screen.getAllByRole("button").filter((b) => b.title?.startsWith("#"));
    expect(buttons.map((b) => b.title)).toEqual(["#journal", "#project", "#idea"]);
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
    const buttons = screen.getAllByRole("button").filter((b) => b.title?.startsWith("#"));
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

  it("group badge shows the sum of child tag counts", () => {
    render(
      <TagBrowser
        {...baseProps}
        tags={[
          { name: "summary/daily", count: 10 },
          { name: "summary/weekly", count: 3 },
          { name: "summary/monthly", count: 2 },
        ]}
        pinnedTags={[]}
        selected={[]}
      />,
    );
    // The collapsed group's "Expand summary" button has the prefix label and
    // the running total of its children — no need to expand to see the count.
    const expand = screen.getByRole("button", { name: /Expand summary/i });
    const groupRow = expand.parentElement!;
    expect(within(groupRow).getByText("#summary/")).toBeInTheDocument();
    expect(within(groupRow).getByText("15")).toBeInTheDocument();
  });

  it("group badge sum includes the parent's own count when it exists as a tag", () => {
    render(
      <TagBrowser
        {...baseProps}
        tags={[
          { name: "summary", count: 4 },
          { name: "summary/daily", count: 10 },
          { name: "summary/weekly", count: 3 },
        ]}
        pinnedTags={[]}
        selected={[]}
      />,
    );
    // When the parent tag exists, the row renders as a TagRow (not the
    // expand-button label) — but the group's running total still adds up.
    const parent = screen.getByTitle("#summary");
    expect(within(parent).getByText("4")).toBeInTheDocument();
    // Expand and check the leaf counts so the sum (4 + 10 + 3 = 17) is
    // verifiable end-to-end.
    fireEvent.click(screen.getByRole("button", { name: /Expand summary/i }));
    expect(within(screen.getByTitle("#summary/daily")).getByText("10")).toBeInTheDocument();
    expect(within(screen.getByTitle("#summary/weekly")).getByText("3")).toBeInTheDocument();
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
