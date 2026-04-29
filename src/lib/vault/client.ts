import type { Note, NoteAttachment, TagSummary, VaultInfo } from "./types";

export const STORAGE_MAX_BYTES = 100 * 1024 * 1024;
export const STORAGE_ALLOWED_EXTENSIONS = new Set([
  "wav",
  "mp3",
  "m4a",
  "ogg",
  "webm",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
]);

export interface VaultClientOptions {
  vaultUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  xhrFactory?: () => XMLHttpRequest;
  // Invoked when the vault returns 401/403. Should attempt a refresh-token
  // exchange and return the fresh access token, or `null` if refresh is not
  // possible (legacy `pvt_*` token, no refresh token, or refresh failed).
  // Without this, the first 401 throws immediately — same behaviour as before
  // hub-as-issuer landed.
  onAuthError?: () => Promise<string | null>;
  // Invoked when a 401/403 ultimately can't be recovered: either there was no
  // refresh callback, or the post-refresh retry also got a 401/403 (the new
  // token is dead too). Lets callers mark the vault as needing reconnect —
  // distinct from `onAuthError`'s job, which is to attempt refresh. Skipped
  // when `onAuthError` returned null because that path is expected to record
  // its own halt with a more specific reason (see refresh.ts).
  onAuthRevoked?: (status: number) => void;
}

export interface StorageUploadResult {
  path: string;
  size: number;
  mimeType: string;
}

export interface UploadProgress {
  loaded: number;
  total: number;
}

export class VaultUploadError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "VaultUploadError";
    this.status = status;
  }
}

export class VaultAuthError extends Error {
  constructor(message = "Vault rejected the token") {
    super(message);
    this.name = "VaultAuthError";
  }
}

export class VaultNotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "VaultNotFoundError";
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

// Thrown by `renameTag` when the vault refuses because a tag with the target
// name already exists. Callers (e.g. the rename dialog) surface this as an
// affordance to merge into the existing tag instead.
export class VaultTargetExistsError extends Error {
  readonly target: string;
  constructor(target: string, message?: string) {
    super(message ?? `A tag named "${target}" already exists`);
    this.name = "VaultTargetExistsError";
    this.target = target;
  }
}

export interface UpdateNotePayload {
  content?: string;
  path?: string;
  metadata?: Record<string, unknown>;
  tags?: { add?: string[]; remove?: string[] };
  if_updated_at?: string;
  // The vault's PATCH /api/notes/:idOrPath enforces optimistic concurrency by
  // default: either `if_updated_at` or `force: true` is required. `force` is
  // the opt-out for writes where we genuinely don't have a baseline (e.g.
  // offline-queued settings writes that drain long after we last fetched).
  force?: boolean;
}

export interface CreateNotePayload {
  content: string;
  path?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export class VaultClient {
  private readonly baseUrl: string;
  // Mutable so a successful refresh-on-401 retry can rotate the in-memory
  // token without requiring callers to rebuild the client.
  private token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly xhrFactory: () => XMLHttpRequest;
  private readonly onAuthError?: () => Promise<string | null>;
  private readonly onAuthRevoked?: (status: number) => void;

  constructor(opts: VaultClientOptions) {
    this.baseUrl = opts.vaultUrl.replace(/\/$/, "");
    this.token = opts.accessToken;
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    this.xhrFactory = opts.xhrFactory ?? (() => new XMLHttpRequest());
    this.onAuthError = opts.onAuthError;
    this.onAuthRevoked = opts.onAuthRevoked;
  }

  get vaultBaseUrl(): string {
    return this.baseUrl;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.requestWithRetry<T>(path, init, true);
  }

  private async requestWithRetry<T>(
    path: string,
    init: RequestInit,
    allowRetry: boolean,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });

    if (res.status === 401 || res.status === 403) {
      if (allowRetry && this.onAuthError) {
        const fresh = await this.onAuthError();
        if (fresh) {
          this.token = fresh;
          return this.requestWithRetry<T>(path, init, false);
        }
        // onAuthError returned null — refresh.ts will already have recorded
        // its own halt with a specific reason if appropriate; don't double-mark.
      } else {
        // No refresh path, or we're on the post-refresh retry and the new
        // token also failed. Either way, the credentials we have are dead.
        this.onAuthRevoked?.(res.status);
      }
      throw new VaultAuthError(`Vault rejected the token (${res.status})`);
    }
    if (res.status === 404) {
      throw new VaultNotFoundError(`${init.method ?? "GET"} ${path} → 404`);
    }
    if (res.status === 409 || res.status === 428) {
      // 409 = baseline mismatch (sent stale `if_updated_at`); 428 = baseline
      // missing (didn't send `if_updated_at` and `force` wasn't set). Both
      // recover the same way — refetch the note for a fresh baseline and
      // retry — so we collapse them into one error class.
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        target?: string;
        message?: string;
        current_updated_at?: string | null;
        expected_updated_at?: string | null;
      };
      // The vault's tag-rename endpoint returns `{error:"target_exists",...}`
      // for name-collision; the note PATCH endpoint returns the
      // current_updated_at/expected_updated_at shape. Different failure modes,
      // same HTTP status — distinguish by body shape.
      if (body.error === "target_exists" && typeof body.target === "string") {
        throw new VaultTargetExistsError(body.target, body.message);
      }
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

  async updateNote(
    id: string,
    payload: UpdateNotePayload,
    opts: { signal?: AbortSignal } = {},
  ): Promise<Note> {
    return this.request<Note>(`/api/notes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      signal: opts.signal,
    });
  }

  async createNote(payload: CreateNotePayload, opts: { signal?: AbortSignal } = {}): Promise<Note> {
    return this.request<Note>("/api/notes", {
      method: "POST",
      body: JSON.stringify(payload),
      signal: opts.signal,
    });
  }

  async deleteNote(id: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
    await this.request<{ deleted: boolean; id: string } | undefined>(
      `/api/notes/${encodeURIComponent(id)}`,
      { method: "DELETE", signal: opts.signal },
    );
  }

  async listTags(): Promise<TagSummary[]> {
    return this.request<TagSummary[]>("/api/tags");
  }

  async deleteTag(name: string): Promise<void> {
    await this.request<undefined>(`/api/tags/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }

  async renameTag(oldName: string, newName: string): Promise<{ renamed: number }> {
    return this.request<{ renamed: number }>(`/api/tags/${encodeURIComponent(oldName)}/rename`, {
      method: "POST",
      body: JSON.stringify({ new_name: newName }),
    });
  }

  async mergeTags(
    sources: string[],
    target: string,
  ): Promise<{ merged: Record<string, number>; target: string }> {
    return this.request<{ merged: Record<string, number>; target: string }>("/api/tags/merge", {
      method: "POST",
      body: JSON.stringify({ sources, target }),
    });
  }

  uploadStorageFile(
    file: File,
    opts: {
      onProgress?: (p: UploadProgress) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<StorageUploadResult> {
    return new Promise((resolve, reject) => {
      const xhr = this.xhrFactory();
      const form = new FormData();
      form.append("file", file);

      xhr.open("POST", `${this.baseUrl}/api/storage/upload`);
      xhr.setRequestHeader("Authorization", `Bearer ${this.token}`);
      xhr.setRequestHeader("Accept", "application/json");

      if (opts.onProgress && xhr.upload) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) opts.onProgress?.({ loaded: e.loaded, total: e.total });
        };
      }

      xhr.onload = () => {
        if (xhr.status === 401 || xhr.status === 403) {
          reject(new VaultAuthError(`Vault rejected the token (${xhr.status})`));
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          let message = `Upload failed (${xhr.status})`;
          try {
            const body = JSON.parse(xhr.responseText) as { error?: string };
            if (body.error) message = body.error;
          } catch {}
          reject(new VaultUploadError(message, xhr.status));
          return;
        }
        try {
          resolve(JSON.parse(xhr.responseText) as StorageUploadResult);
        } catch (e) {
          reject(e instanceof Error ? e : new Error("Invalid upload response"));
        }
      };

      xhr.onerror = () => reject(new VaultUploadError("Network error during upload", 0));
      xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));

      if (opts.signal) {
        if (opts.signal.aborted) {
          xhr.abort();
          return;
        }
        opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
      }

      xhr.send(form);
    });
  }

  async linkAttachment(
    noteIdOrPath: string,
    body: { path: string; mimeType: string; transcribe?: boolean },
  ): Promise<NoteAttachment> {
    return this.request<NoteAttachment>(
      `/api/notes/${encodeURIComponent(noteIdOrPath)}/attachments`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  async listAttachments(noteIdOrPath: string): Promise<NoteAttachment[]> {
    return this.request<NoteAttachment[]>(
      `/api/notes/${encodeURIComponent(noteIdOrPath)}/attachments`,
    );
  }

  async deleteAttachment(noteIdOrPath: string, attachmentId: string): Promise<void> {
    await this.request<undefined>(
      `/api/notes/${encodeURIComponent(noteIdOrPath)}/attachments/${encodeURIComponent(attachmentId)}`,
      { method: "DELETE" },
    );
  }

  storageUrl(path: string): string {
    const trimmed = path.startsWith("/") ? path.slice(1) : path;
    return `${this.baseUrl}/api/storage/${trimmed}`;
  }

  async fetchAttachmentBlob(url: string): Promise<Blob> {
    const target = url.startsWith("http")
      ? url
      : `${this.baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
    return this.fetchBlobWithRetry(target, url, true);
  }

  private async fetchBlobWithRetry(
    target: string,
    originalUrl: string,
    allowRetry: boolean,
  ): Promise<Blob> {
    const res = await this.fetchImpl(target, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (res.status === 401 || res.status === 403) {
      if (allowRetry && this.onAuthError) {
        const fresh = await this.onAuthError();
        if (fresh) {
          this.token = fresh;
          return this.fetchBlobWithRetry(target, originalUrl, false);
        }
        // onAuthError returned null — refresh.ts owns the halt path.
      } else {
        // No refresh path, or post-refresh retry still 401/403. Mirror
        // requestWithRetry so attachment loads also surface the banner.
        this.onAuthRevoked?.(res.status);
      }
      throw new VaultAuthError(`Vault rejected the token (${res.status})`);
    }
    if (!res.ok) {
      throw new Error(`GET ${originalUrl} failed (${res.status})`);
    }
    return res.blob();
  }
}
