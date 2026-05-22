/**
 * URL helpers — re-exports from `@openparachute/app-client` plus Notes'
 * legacy-vault-URL guard.
 *
 * Phase 2 of the notes-migration-to-app arc (parachute-app#6, design doc
 * section 16) moved `vaultIdFromUrl` + `normalizeVaultUrl` into
 * app-client so other hosted apps share the URL-drift fix from
 * notes#149. `isLegacyVaultUrl` stays Notes-side — it's a one-off
 * migration helper for VaultRecords that pre-date vault PR 7's
 * `/vaults/` → `/vault/` rename.
 */

export { normalizeVaultUrl, vaultIdFromUrl } from "@openparachute/app-client";
export { isLegacyVaultUrl } from "./types";
