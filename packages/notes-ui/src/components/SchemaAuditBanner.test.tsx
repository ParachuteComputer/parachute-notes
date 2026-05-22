// @vitest-environment jsdom
import { SchemaAuditBanner } from "@/components/SchemaAuditBanner";
import { useSchemaAuditStore } from "@/lib/vault/schema-audit-store";
import { useSchemaBannerStore } from "@/lib/vault/schema-banner-store";
import { useVaultStore } from "@/lib/vault/store";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The banner uses useActiveVaultClient for the "Set up" button. Stub.
const mockClient = {
  updateTag: vi.fn(async () => {}),
};
vi.mock("@/lib/vault/queries", () => ({
  useActiveVaultClient: () => mockClient,
}));

function seedVault() {
  useVaultStore.setState({
    vaults: {
      v: {
        id: "v",
        url: "http://localhost:1940",
        name: "dev",
        issuer: "http://localhost:1940",
        clientId: "c",
        scope: "full",
        addedAt: "2026-04-18T00:00:00.000Z",
        lastUsedAt: "2026-04-18T00:00:00.000Z",
      },
    },
    activeVaultId: "v",
  });
}

function renderBanner() {
  return render(
    <MemoryRouter>
      <SchemaAuditBanner />
    </MemoryRouter>,
  );
}

describe("SchemaAuditBanner", () => {
  beforeEach(() => {
    seedVault();
    localStorage.clear();
    useSchemaAuditStore.setState({ byVault: {} });
    useSchemaBannerStore.setState({ dismissedByVault: {} });
    mockClient.updateTag.mockClear();
  });
  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
    localStorage.clear();
    useSchemaAuditStore.setState({ byVault: {} });
    useSchemaBannerStore.setState({ dismissedByVault: {} });
  });

  it("renders nothing when no audit yet", () => {
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when audit ok", () => {
    useSchemaAuditStore.setState({
      byVault: {
        v: {
          vaultId: "v",
          result: { ok: true, missing: [], misaligned: [], rows: [] },
          loading: false,
          error: null,
          lastCheckedAt: Date.now(),
        },
      },
    });
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it("renders when audit has misalignments", () => {
    useSchemaAuditStore.setState({
      byVault: {
        v: {
          vaultId: "v",
          result: {
            ok: false,
            missing: [
              {
                name: "capture",
                status: "missing",
                expected: { name: "capture", description: "x" },
                actual: null,
                differences: [],
              },
            ],
            misaligned: [],
            rows: [],
          },
          loading: false,
          error: null,
          lastCheckedAt: Date.now(),
        },
      },
    });
    renderBanner();
    expect(screen.getByText(/vault schema needs setup/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /set up/i })).toBeInTheDocument();
  });

  it("hides when dismissed for that vault", () => {
    useSchemaAuditStore.setState({
      byVault: {
        v: {
          vaultId: "v",
          result: {
            ok: false,
            missing: [
              {
                name: "capture",
                status: "missing",
                expected: { name: "capture", description: "x" },
                actual: null,
                differences: [],
              },
            ],
            misaligned: [],
            rows: [],
          },
          loading: false,
          error: null,
          lastCheckedAt: Date.now(),
        },
      },
    });
    useSchemaBannerStore.setState({ dismissedByVault: { v: true } });
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it("Dismiss persists per-vault to localStorage", () => {
    useSchemaAuditStore.setState({
      byVault: {
        v: {
          vaultId: "v",
          result: {
            ok: false,
            missing: [
              {
                name: "capture",
                status: "missing",
                expected: { name: "capture", description: "x" },
                actual: null,
                differences: [],
              },
            ],
            misaligned: [],
            rows: [],
          },
          loading: false,
          error: null,
          lastCheckedAt: Date.now(),
        },
      },
    });
    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(useSchemaBannerStore.getState().dismissedByVault.v).toBe(true);
  });

  it("Set up calls updateTag for each declared tag, marks ok in store", async () => {
    useSchemaAuditStore.setState({
      byVault: {
        v: {
          vaultId: "v",
          result: {
            ok: false,
            missing: [
              {
                name: "capture",
                status: "missing",
                expected: { name: "capture", description: "x" },
                actual: null,
                differences: [],
              },
            ],
            misaligned: [],
            rows: [
              {
                name: "capture",
                status: "missing",
                expected: { name: "capture", description: "x" },
                actual: null,
                differences: [],
              },
              {
                name: "capture/text",
                status: "missing",
                expected: { name: "capture/text", description: "y", parent_names: ["capture"] },
                actual: null,
                differences: [],
              },
              {
                name: "capture/voice",
                status: "missing",
                expected: { name: "capture/voice", description: "z", parent_names: ["capture"] },
                actual: null,
                differences: [],
              },
            ],
          },
          loading: false,
          error: null,
          lastCheckedAt: Date.now(),
        },
      },
    });
    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: /set up/i }));

    await waitFor(() => {
      expect(useSchemaAuditStore.getState().byVault.v?.result?.ok).toBe(true);
    });
    // Three required tags → three PUTs (capture, capture/text, capture/voice).
    expect(mockClient.updateTag).toHaveBeenCalledTimes(3);
    // After fix, banner should disappear.
    expect(screen.queryByText(/vault schema needs setup/i)).not.toBeInTheDocument();
  });
});
