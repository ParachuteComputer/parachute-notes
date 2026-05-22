import { TextSizeControl, TextSizeShortcutsMount } from "@/components/TextSizeControl";
import { TEXT_SIZE_STORAGE_KEY } from "@/lib/text-size";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("TextSizeControl button + popover", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-text-size");
  });
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-text-size");
  });

  it("renders the 'Aa' button labeled with the current size", () => {
    render(<TextSizeControl />);
    expect(
      screen.getByRole("button", { name: /text size: default. click to change/i }),
    ).toBeInTheDocument();
  });

  it("starts from stored preference on mount", () => {
    localStorage.setItem(TEXT_SIZE_STORAGE_KEY, "larger");
    render(<TextSizeControl />);
    expect(screen.getByRole("button", { name: /text size: larger/i })).toBeInTheDocument();
  });

  it("opens the popover on click and lists the three options", () => {
    render(<TextSizeControl />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /text size:/i }));
    });
    expect(screen.getByRole("dialog", { name: /text size/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^default$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^larger$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^largest$/i })).toBeInTheDocument();
  });

  it("clicking an option applies + persists + closes the popover", () => {
    render(<TextSizeControl />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /text size:/i }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^larger$/i }));
    });
    expect(document.documentElement.getAttribute("data-text-size")).toBe("larger");
    expect(localStorage.getItem(TEXT_SIZE_STORAGE_KEY)).toBe("larger");
    expect(screen.queryByRole("dialog", { name: /text size/i })).not.toBeInTheDocument();
  });

  it("clicking 'Default' removes the attribute + storage key", () => {
    localStorage.setItem(TEXT_SIZE_STORAGE_KEY, "largest");
    document.documentElement.setAttribute("data-text-size", "largest");
    render(<TextSizeControl />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /text size:/i }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^default$/i }));
    });
    expect(document.documentElement.hasAttribute("data-text-size")).toBe(false);
    expect(localStorage.getItem(TEXT_SIZE_STORAGE_KEY)).toBeNull();
  });
});

describe("TextSizeShortcutsMount keyboard handlers", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-text-size");
  });
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-text-size");
  });

  function dispatchKey(key: string, opts: { meta?: boolean; ctrl?: boolean } = { meta: true }) {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        metaKey: opts.meta ?? false,
        ctrlKey: opts.ctrl ?? false,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  it("Cmd+= steps default → larger → largest → default", () => {
    render(<TextSizeShortcutsMount />);
    act(() => {
      dispatchKey("=");
    });
    expect(document.documentElement.getAttribute("data-text-size")).toBe("larger");
    act(() => {
      dispatchKey("=");
    });
    expect(document.documentElement.getAttribute("data-text-size")).toBe("largest");
    act(() => {
      dispatchKey("=");
    });
    expect(document.documentElement.hasAttribute("data-text-size")).toBe(false);
  });

  it("Cmd+Plus also steps up (some keyboards send +)", () => {
    render(<TextSizeShortcutsMount />);
    act(() => {
      dispatchKey("+");
    });
    expect(document.documentElement.getAttribute("data-text-size")).toBe("larger");
  });

  it("Cmd+- steps backward", () => {
    localStorage.setItem(TEXT_SIZE_STORAGE_KEY, "larger");
    document.documentElement.setAttribute("data-text-size", "larger");
    render(<TextSizeShortcutsMount />);
    act(() => {
      dispatchKey("-");
    });
    expect(document.documentElement.hasAttribute("data-text-size")).toBe(false);
  });

  it("Cmd+0 resets to default", () => {
    localStorage.setItem(TEXT_SIZE_STORAGE_KEY, "largest");
    document.documentElement.setAttribute("data-text-size", "largest");
    render(<TextSizeShortcutsMount />);
    act(() => {
      dispatchKey("0");
    });
    expect(document.documentElement.hasAttribute("data-text-size")).toBe(false);
    expect(localStorage.getItem(TEXT_SIZE_STORAGE_KEY)).toBeNull();
  });

  it("ignores key presses without Cmd/Ctrl", () => {
    render(<TextSizeShortcutsMount />);
    act(() => {
      dispatchKey("=", { meta: false, ctrl: false });
    });
    expect(document.documentElement.hasAttribute("data-text-size")).toBe(false);
  });

  it("ignores Cmd+= with Shift (the literal Plus glyph with Shift held)", () => {
    // Plus typed via Shift+= on a US keyboard is the actual `+` key event,
    // but the handler explicitly skips shift to avoid stepping the ramp
    // every time the user types `+` in a markdown table. Verify by
    // dispatching the shifted form.
    render(<TextSizeShortcutsMount />);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "+",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(document.documentElement.hasAttribute("data-text-size")).toBe(false);
  });

  it("popover mirror updates in same tab when shortcut fires", () => {
    // The popover starts open showing "default" as active. A shortcut step
    // up should flip the `aria-pressed` to the new value without a
    // re-render of the popover button — proves the same-tab custom event
    // wiring works.
    render(
      <>
        <TextSizeShortcutsMount />
        <TextSizeControl />
      </>,
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /text size: default/i }));
    });
    expect(screen.getByRole("button", { name: /^default$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    act(() => {
      dispatchKey("=");
    });
    // Popover should still be open, and the active row should now be Larger.
    expect(screen.getByRole("button", { name: /^larger$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^default$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
