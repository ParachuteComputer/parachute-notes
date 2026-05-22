/**
 * AS-metadata discovery + DCR — thin Notes wrapper over
 * `@openparachute/app-client`'s helpers.
 *
 * Phase 2 of the notes-migration-to-app arc (parachute-app#6, design doc
 * section 16) moved both functions into app-client. Notes keeps a thin
 * shim so existing call sites don't churn AND so `registerClient` keeps
 * its fixed `client_name: "Parachute Notes"` brand without making every
 * caller pass it through.
 */

import {
  type AuthorizationServerMetadata,
  type ClientRegistration,
  discoverAuthServer as appClientDiscoverAuthServer,
  registerClient as appClientRegisterClient,
} from "@openparachute/app-client";

const NOTES_CLIENT_NAME = "Parachute Notes";

export async function discoverAuthServer(
  issuerUrl: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<AuthorizationServerMetadata> {
  return appClientDiscoverAuthServer(issuerUrl, fetchImpl);
}

/**
 * Register Notes as a public OAuth client via RFC 7591 DCR. Pins the
 * `client_name` to "Parachute Notes" so callers don't have to plumb the
 * brand string through; app-client's underlying helper already sends
 * `credentials: "include"` so hub session cookies reach the endpoint for
 * hub#199 auto-approve.
 */
export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<ClientRegistration> {
  return appClientRegisterClient(
    registrationEndpoint,
    { clientName: NOTES_CLIENT_NAME, redirectUri },
    fetchImpl,
  );
}
