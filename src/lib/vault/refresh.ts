import { refreshAccessToken, storedFromTokenResponse } from "./oauth";
import { loadToken, saveToken } from "./storage";
import { useVaultStore } from "./store";

// In-flight refreshes keyed by vaultId. Refresh-token rotation (RFC 6749 §6
// with hub#66's implementation) means each refresh consumes the prior
// refresh_token; a second concurrent refresh would 400. We dedupe by sharing
// the in-flight Promise so concurrent 401s on parallel queries collapse into
// one rotate.
const inflight = new Map<string, Promise<string | null>>();

/**
 * Force a refresh-token exchange and persist the rotated tokens. Returns the
 * fresh access token, or `null` if refresh isn't possible (legacy `pvt_*`
 * token without refresh metadata, missing `tokenEndpoint`/`clientId`, or the
 * exchange failed).
 *
 * Wired into `VaultClient.onAuthError` so a 401 triggers exactly one refresh
 * before throwing `VaultAuthError` to the UI.
 */
export async function forceRefresh(vaultId: string): Promise<string | null> {
  const existing = inflight.get(vaultId);
  if (existing) return existing;

  const promise = doRefresh(vaultId).finally(() => {
    inflight.delete(vaultId);
  });
  inflight.set(vaultId, promise);
  return promise;
}

async function doRefresh(vaultId: string): Promise<string | null> {
  const stored = loadToken(vaultId);
  if (!stored?.refreshToken) return null;

  const vault = useVaultStore.getState().vaults[vaultId];
  if (!vault?.tokenEndpoint || !vault.clientId) return null;

  try {
    const response = await refreshAccessToken({
      tokenEndpoint: vault.tokenEndpoint,
      clientId: vault.clientId,
      refreshToken: stored.refreshToken,
    });
    const next = storedFromTokenResponse(response);
    // Carry forward the prior refresh token if the rotated response omits one
    // (defensive — hub#66 always rotates, but a future server might issue
    // long-lived bearers without rotation).
    if (!next.refreshToken && stored.refreshToken) {
      next.refreshToken = stored.refreshToken;
    }
    saveToken(vaultId, next);
    return next.accessToken;
  } catch {
    return null;
  }
}
