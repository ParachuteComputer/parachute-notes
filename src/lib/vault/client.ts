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

export class VaultConflictError extends Error {
  readonly currentUpdatedAt: string | null;
  readonly expectedUpdatedAt: string | null;
  constructor(body: {
    current_updated_at?: string | null;
    expected_updated_at?: string | null;
    message?: string;
  }) {
    super(body.message ?? "Note was edited elsewhere");
    this.name = "VaultConflictError";
    this.currentUpdatedAt = body.current_updated_at ?? null;
    this.expectedUpdatedAt = body.expected_updated_at ?? null;
  }
}

export interface UpdateNotePayload {
  content?: string;
  path?: string;
  metadata?: Record<string, unknown>;
  tags?: { add?: string[]; remove?: string[] };
  if_updated_at?: string;
}

export interface CreateNotePayload {
  content: string;
  path?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
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
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        current_updated_at?: string | null;
        expected_updated_at?: string | null;
      };
      throw new VaultConflictError(body);
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

  async getNote(
    id: string,
    opts: { includeLinks?: boolean; includeAttachments?: boolean } = {},
  ): Promise<Note | null> {
    const params = new URLSearchParams({ id, include_content: "true" });
    if (opts.includeLinks) params.set("include_links", "true");
    if (opts.includeAttachments) params.set("include_attachments", "true");
    const rows = await this.request<Note[] | Note>(`/api/notes?${params.toString()}`);
    // The vault may return either a single note (when id is passed) or an array.
    if (Array.isArray(rows)) return rows[0] ?? null;
    return rows ?? null;
  }

  async updateNote(id: string, payload: UpdateNotePayload): Promise<Note> {
    return this.request<Note>(`/api/notes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async createNote(payload: CreateNotePayload): Promise<Note> {
    return this.request<Note>("/api/notes", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async deleteNote(id: string): Promise<void> {
    await this.request<{ deleted: boolean; id: string } | undefined>(
      `/api/notes/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }

  async listTags(): Promise<TagSummary[]> {
    return this.request<TagSummary[]>("/api/tags");
  }

  async fetchAttachmentBlob(url: string): Promise<Blob> {
    const target = url.startsWith("http")
      ? url
      : `${this.baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
    const res = await this.fetchImpl(target, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new VaultAuthError(`Vault rejected the token (${res.status})`);
    }
    if (!res.ok) {
      throw new Error(`GET ${url} failed (${res.status})`);
    }
    return res.blob();
  }
}
