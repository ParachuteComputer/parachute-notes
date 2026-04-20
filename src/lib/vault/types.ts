export type TokenScope = "full" | "read";

export interface VaultRecord {
  id: string;
  url: string;
  name: string;
  issuer: string;
  clientId: string;
  scope: TokenScope;
  addedAt: string;
  lastUsedAt: string;
}

export interface StoredToken {
  accessToken: string;
  scope: TokenScope;
  vault: string;
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
  vaultUrl: string;
  issuer: string;
  tokenEndpoint: string;
  clientId: string;
  codeVerifier: string;
  state: string;
  redirectUri: string;
  scope: TokenScope;
  startedAt: string;
}
