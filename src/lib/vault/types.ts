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

export interface TokenResponse {
  access_token: string;
  token_type: "bearer";
  scope: TokenScope;
  vault: string;
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
