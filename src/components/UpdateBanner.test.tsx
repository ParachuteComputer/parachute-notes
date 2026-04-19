import { UpdateBanner } from "@/components/UpdateBanner";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

// The `virtual:pwa-register/react` module is aliased to a test stub (see
// vitest.config.ts) that returns needRefresh=false by default. This smoke
// test proves the component imports the stub, renders without crashing,
// and correctly renders nothing when there's no pending update.
describe("UpdateBanner", () => {
  it("renders nothing when there is no pending service-worker update", () => {
    render(<UpdateBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
