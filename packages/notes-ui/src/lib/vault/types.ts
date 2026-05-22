/**
 * Notes-side OAuth/vault types.
 *
 * Phase 2 of the notes-migration-to-app arc (parachute-app#6, design doc
 * section 16): the OAuth + vault REST shapes that used to live here moved
 * to `@openparachute/app-client` so other hosted apps don't re-roll them.
 * This module now re-exports the canonical types from app-client and
 * holds the small handful of Notes-specific extensions:
 *
 *   - `VaultRecord` — Notes' per-vault catalog row (URL + name + issuer +
 *     token-endpoint + client_id + scope + addedAt/lastUsedAt). Multi-
 *     vault is a Notes UX, not a general-purpose pattern; the record
 *     stays out of app-client.
 *   - `PendingOAuthState` — extends app-client's base shape with
 *     `priorHaltedVaultId`, the notes#148 round-trip channel that lets
 *     OAuthCallback clear an originally-halted vault's halt entry even
 *     when the new vault URL resolves to a different vaultIdFromUrl.
 *   - `isLegacyVaultUrl` — Notes-only guard for pre-PR-7 vault URLs (the
 *     vault project migrated `/vaults/<name>/` → `/vault/<name>/`; Notes
 *     still has old VaultRecords lying in localStorage that need to be
 *     re-added).
 */

import type { PendingOAuthState as BasePendingOAuthState } from "@openparachute/app-client";

// Canonical OAuth + vault shapes live in app-client — re-export so existing
// import sites (`import type { Note, TagSummary, ... } from "@/lib/vault/types"`)
// keep working without per-file churn.
export type {
  AuthorizationServerMetadata,
  ClientRegistration,
  CreateNotePayload,
  Note,
  NoteAttachment,
  NoteLink,
  NoteSummary,
  ReachabilitySignal,
  ServiceCatalogEntry,
  ServicesCatalog,
  StorageUploadResult,
  StoredToken,
  TagSummary,
  TokenResponse,
  TokenScope,
  UpdateNotePayload,
  UploadProgress,
  VaultInfo,
} from "@openparachute/app-client";

export interface VaultRecord {
  id: string;
  url: string;
  name: string;
  issuer: string;
  // Captured at connect time so refreshAccessToken doesn't have to re-run AS
  // discovery on every silent rotate. Optional only for forward-compat with
  // pre-hub-as-issuer records that may live in localStorage on first upgrade —
  // those records are pvt_*-token-only and won't refresh anyway.
  tokenEndpoint?: string;
  clientId: string;
  scope: string;
  addedAt: string;
  lastUsedAt: string;
}

/**
 * Notes' pending OAuth state — app-client's base shape plus
 * `priorHaltedVaultId` (notes#148). When the reconnect-from-banner path
 * begins an OAuth flow, it stashes the currently-halted vault id here so
 * OAuthCallback can clear THAT vault's halt entry on success, even when
 * the hub's token catalog now resolves the vault to a different URL
 * (different vaultIdFromUrl) — which would otherwise leave the original
 * halt orphaned in localStorage and the banner stuck on the next active
 * vault switch. Omitted for the cold connect flow from /add.
 */
export interface PendingOAuthState extends BasePendingOAuthState {
  priorHaltedVaultId?: string;
}

// Vault PR 7 moved every endpoint under `/vault/<name>/`. Older stored
// VaultRecords whose URL is origin-only (or the previous `/vaults/<name>/`
// plural) won't reach the new endpoints and their tokens are invalid because
// vault's issuer changed. Detect them so the Vaults page can prompt re-add.
export function isLegacyVaultUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  return !(segments.length >= 2 && segments[0] === "vault");
}
