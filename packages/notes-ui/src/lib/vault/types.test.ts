import { describe, expect, it } from "vitest";
import { isLegacyVaultUrl } from "./types";

// `normalizeVaultUrl` and `vaultIdFromUrl` tests live in
// `@openparachute/app-client`'s own suite — those helpers were lifted out
// during Phase 2 (parachute-app#6). What remains here is the Notes-
// specific guard for pre-PR-7 vault URLs (`/vaults/<name>/` plural or
// origin-only). The Vaults page reads `isLegacyVaultUrl` to mark stored
// records as "needs re-add" — vault PR 7 moved every endpoint under
// `/vault/<name>/` and changed the issuer, invalidating prior tokens.
describe("isLegacyVaultUrl", () => {
  it("flags origin-only URLs (pre-PR-7 default)", () => {
    expect(isLegacyVaultUrl("https://vault.example.com")).toBe(true);
    expect(isLegacyVaultUrl("http://localhost:1940")).toBe(true);
  });

  it("flags the previous `/vaults/<name>/` plural scheme", () => {
    expect(isLegacyVaultUrl("https://vault.example.com/vaults/work")).toBe(true);
  });

  it("accepts current `/vault/<name>` URLs", () => {
    expect(isLegacyVaultUrl("https://vault.example.com/vault/default")).toBe(false);
    expect(isLegacyVaultUrl("http://localhost:1940/vault/work")).toBe(false);
  });

  it("returns false for unparseable input rather than misclassifying", () => {
    expect(isLegacyVaultUrl("not-a-url")).toBe(false);
  });
});
