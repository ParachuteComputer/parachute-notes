import type { Note, TagSummary, VaultInfo } from "./types";

export interface VaultClientOptions {
  vaultUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}

export class VaultAuthError extends Error {
  constructor(message = "Vault rejected the token") {
    super(message);
    this.name = "VaultAuthError";
  }
}

export class VaultClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: VaultClientOptions) {
    this.baseUrl = opts.vaultUrl.replace(/\/$/, "");
    this.token = opts.accessToken;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });

    if (res.status === 401 || res.status === 403) {
      throw new VaultAuthError(`Vault rejected the token (${res.status})`);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${init.method ?? "GET"} ${path} failed (${res.status}): ${text}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async vaultInfo(includeStats = true): Promise<VaultInfo> {
    const query = includeStats ? "?include_stats=true" : "";
    return this.request<VaultInfo>(`/api/vault${query}`);
  }

  async queryNotes(params: URLSearchParams): Promise<Note[]> {
    const qs = params.toString();
    return this.request<Note[]>(`/api/notes${qs ? `?${qs}` : ""}`);
  }

  async listTags(): Promise<TagSummary[]> {
    return this.request<TagSummary[]>("/api/tags");
  }
}
