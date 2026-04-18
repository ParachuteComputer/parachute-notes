import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the Lens wordmark and pre-alpha marker", () => {
    render(<App />);
    expect(screen.getByRole("link", { name: /parachute lens/i })).toBeInTheDocument();
    expect(screen.getByText(/pre-alpha/i)).toBeInTheDocument();
  });

  it("explains the scaffold state to visitors", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /not connected yet/i })).toBeInTheDocument();
  });
});
