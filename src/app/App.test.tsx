import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // BrowserRouter is mounted with basename="/notes" (from BASE_URL).
    // Navigate the test browser into that scope so routes resolve.
    window.history.replaceState({}, "", "/notes/");
  });

  it("renders the Parachute Notes wordmark and the connect CTA when no vaults exist", () => {
    render(<App />);
    expect(screen.getByRole("link", { name: /parachute notes/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /connect a vault/i })).toBeInTheDocument();
    expect(screen.getByText(/no vault connected/i)).toBeInTheDocument();
  });
});
