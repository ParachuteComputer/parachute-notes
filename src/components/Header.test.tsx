import { Header } from "@/components/Header";
import { useVaultStore } from "@/lib/vault/store";
import type { VaultRecord } from "@/lib/vault/types";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function makeVault(partial: Partial<VaultRecord> & Pick<VaultRecord, "id" | "url">): VaultRecord {
  return {
    name: "",
    issuer: partial.url,
    clientId: "client-test",
    scope: "full",
    addedAt: "2026-04-18T00:00:00.000Z",
    lastUsedAt: "2026-04-18T00:00:00.000Z",
    ...partial,
  };
}

function renderHeader() {
  return render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>,
  );
}

describe("Header vault label fallback", () => {
  beforeEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  afterEach(() => {
    useVaultStore.setState({ vaults: {}, activeVaultId: null });
  });

  it("renders the vault name when present", () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "http://localhost:1940", name: "default" }) },
      activeVaultId: "a",
    });
    renderHeader();
    expect(screen.getByRole("combobox", { name: /active vault/i })).toHaveTextContent("default");
  });

  it("falls back to the URL host when name is empty", () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "https://vault.example.com:8443/api", name: "" }) },
      activeVaultId: "a",
    });
    renderHeader();
    expect(screen.getByRole("combobox", { name: /active vault/i })).toHaveTextContent(
      "vault.example.com:8443",
    );
  });

  it("falls back to the raw URL when both name and URL are unparseable", () => {
    useVaultStore.setState({
      vaults: { a: makeVault({ id: "a", url: "not a url", name: "" }) },
      activeVaultId: "a",
    });
    renderHeader();
    expect(screen.getByRole("combobox", { name: /active vault/i })).toHaveTextContent("not a url");
  });
});
