// OAuth scope strings are whitespace-separated lists per RFC 6749 §3.3.
// Phase 1 used a closed set ("full" | "read"); Phase B2 (hub-as-issuer) uses
// the `<service>:<verb>` vocabulary in `parachute-patterns/oauth-scopes.md`,
// e.g. "vault:read vault:write". The type stays open because the parser is
// liberal — unknown scopes pass through and just don't match anything.
export type TokenScope = string;

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
  scope: TokenScope;
  addedAt: string;
  lastUsedAt: string;
}

export interface StoredToken {
  accessToken: string;
  scope: TokenScope;
  vault: string;
  // Hub-issued JWTs include refresh + expiry so notes can silently rotate the
  // access token without re-prompting consent. Vault-issued legacy `pvt_*`
  // tokens omit both — they don't expire and can't be refreshed.
  refreshToken?: string;
  // Absolute UTC ms (`Date.now()` baseline) computed at issuance as
  // `now + expires_in * 1000`. Easier for the 401-driven refresh path than
  // tracking `iat + expires_in` separately.
  expiresAt?: number;
}

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  response_types_supported: string[];
  code_challenge_methods_supported: string[];
  grant_types_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  scopes_supported: string[];
}

export interface ClientRegistration {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
}

// Non-standard `services` extension per hub-as-portal Phase 1: the hub, when
// it issues a token, tells the client where every ecosystem service lives so
// the client never has to ask the user for URLs. Vault-issued tokens omit it
// (standalone deployments); clients must tolerate its absence.
export interface ServiceCatalogEntry {
  url: string;
  version?: string;
}

export interface ServicesCatalog {
  vault?: ServiceCatalogEntry;
  scribe?: ServiceCatalogEntry;
  [key: string]: ServiceCatalogEntry | undefined;
}

export interface TokenResponse {
  access_token: string;
  token_type: "bearer";
  scope: TokenScope;
  vault: string;
  refresh_token?: string;
  expires_in?: number;
  services?: ServicesCatalog;
}

export interface VaultInfo {
  name: string;
  description: string;
  stats?: {
    noteCount: number;
    tagCount: number;
    linkCount: number;
  };
}

export interface Note {
  id: string;
  path?: string;
  createdAt: string;
  updatedAt?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  preview?: string;
  byteSize?: number;
  content?: string;
  links?: NoteLink[];
  attachments?: NoteAttachment[];
}

export interface NoteSummary {
  id: string;
  path?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface NoteLink {
  sourceId: string;
  targetId: string;
  relationship: string;
  createdAt?: string;
  sourceNote?: NoteSummary;
  targetNote?: NoteSummary;
}

export interface NoteAttachment {
  id: string;
  noteId?: string;
  filename?: string;
  mimeType?: string;
  path?: string;
  url?: string;
  size?: number;
  createdAt?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TagSummary {
  name: string;
  count: number;
}

export interface PendingOAuthState {
  // The OAuth issuer URL (where `/.well-known/oauth-authorization-server`
  // resolves). Under hub-as-issuer this is the hub origin; under a standalone
  // vault it's the vault URL. The token endpoint is captured separately so
  // the issuer can be a bare origin even when the AS lives at a path.
  issuerUrl: string;
  issuer: string;
  tokenEndpoint: string;
  clientId: string;
  codeVerifier: string;
  state: string;
  redirectUri: string;
  scope: TokenScope;
  startedAt: string;
}
