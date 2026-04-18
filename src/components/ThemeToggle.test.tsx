import { ThemeToggle } from "@/components/ThemeToggle";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("starts from stored preference on mount", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeToggle />);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: /dark/i })).toBeInTheDocument();
  });

  it("cycles system → light → dark → system on click", () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole("button");

    // Initial state: system (no stored pref, no attribute)
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(btn).toHaveAccessibleName(/system/i);

    act(() => {
      fireEvent.click(btn);
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(btn).toHaveAccessibleName(/light/i);

    act(() => {
      fireEvent.click(btn);
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(btn).toHaveAccessibleName(/dark/i);

    act(() => {
      fireEvent.click(btn);
    });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(btn).toHaveAccessibleName(/system/i);
  });
});
