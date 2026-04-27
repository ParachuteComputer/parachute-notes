import type { AuthorizationServerMetadata, ClientRegistration } from "./types";

const REQUIRED_FIELDS: (keyof AuthorizationServerMetadata)[] = [
  "issuer",
  "authorization_endpoint",
  "token_endpoint",
  "registration_endpoint",
];

/**
 * Fetch RFC 8414 OAuth 2.0 Authorization Server Metadata for the given vault URL.
 * We expect vault's issuer to equal the vault URL itself (e.g. http://localhost:1940/vaults/default).
 */
export async function discoverAuthServer(
  vaultUrl: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<AuthorizationServerMetadata> {
  const metadataUrl = `${vaultUrl.replace(/\/$/, "")}/.well-known/oauth-authorization-server`;

  let res: Response;
  try {
    res = await fetchImpl(metadataUrl, { headers: { Accept: "application/json" } });
  } catch (err) {
    throw new Error(`Could not reach vault at ${vaultUrl}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(
      `Discovery failed (${res.status}). Is this a Parachute Vault URL? Tried ${metadataUrl}`,
    );
  }

  const data = (await res.json()) as AuthorizationServerMetadata;
  for (const field of REQUIRED_FIELDS) {
    if (typeof data[field] !== "string" || !data[field]) {
      throw new Error(`Discovery response missing ${field}`);
    }
  }
  if (!data.code_challenge_methods_supported?.includes("S256")) {
    throw new Error("Vault does not advertise S256 PKCE — cannot complete OAuth safely");
  }
  return data;
}

/**
 * Register Notes as a dynamic OAuth client (RFC 7591). Vault validates the
 * client_id against its oauth_clients table at each /oauth/authorize, so
 * we must register before we can redirect the user.
 */
export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<ClientRegistration> {
  const res = await fetchImpl(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Parachute Notes",
      redirect_uris: [redirectUri],
      // Declare refresh_token so the hub can issue rotated refresh tokens
      // alongside the access token (RFC 6749 §6, hub#66).
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Client registration failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as ClientRegistration;
  if (!data.client_id) {
    throw new Error("Registration response missing client_id");
  }
  return data;
}
