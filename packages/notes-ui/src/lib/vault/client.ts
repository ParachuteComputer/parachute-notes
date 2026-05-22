/**
 * Notes' vault REST client.
 *
 * Phase 2 of the notes-migration-to-app arc (parachute-app#6, design doc
 * section 16) moved the canonical `VaultClient` (with structured errors,
 * auto-refresh on 401/403, cursor pagination, reachability signals) into
 * `@openparachute/app-client`. notes#153 adopted those re-exports but
 * kept a near-clone of the request loop here because app-client's
 * `request*` methods were still `private`.
 *
 * app-client 0.1.0-rc.3 lifted `request`, `requestWithRetry`, and
 * `requestCursorWithRetry` to `protected` (parachute-app#10). This file
 * now subclasses cleanly. Notes' subclass only adds the methods app-
 * client's surface doesn't carry because Notes is the only consumer
 * today:
 *
 *   - `renameTag` / `mergeTags` / `deleteTag` — tag-curation endpoints
 *     (`/api/tags/:name/rename`, `/api/tags/merge`, `DELETE
 *     /api/tags/:name`). Not in app-client's surface; Notes' Tags page
 *     is the only caller.
 *   - `listTagsWithSchema` — `/api/tags?include_schema=true`, used by
 *     the schema-audit runner (notes#129) to diff vault state against
 *     `NOTES_REQUIRED_SCHEMA`.
 *   - `linkAttachment` — Notes-only alias of base `addAttachment` (same
 *     wire shape: POST `/api/notes/:id/attachments`). Kept because
 *     callers throughout Notes use the `linkAttachment` name + semantic.
 *   - `fetchAttachmentBlob` — retry-aware GET of an attachment blob URL
 *     (audio/image render). The base class's `request*` loop parses
 *     JSON; this method needs the raw Blob, so it carries its own thin
 *     retry loop. The auth callbacks (`onAuthError` / `onAuthRevoked` /
 *     `onReachability`) and token rotation are mirrored on the subclass
 *     during construction so the blob path can drive them without
 *     reaching into the base's private fields. The shared JSON request
 *     loop on the base class is no longer duplicated.
 */

import {
  VaultAuthError as AppClientVaultAuthError,
  VaultConflictError as AppClientVaultConflictError,
  VaultNotFoundError as AppClientVaultNotFoundError,
  VaultTargetExistsError as AppClientVaultTargetExistsError,
  VaultUnreachableError as AppClientVaultUnreachableError,
  VaultUploadError as AppClientVaultUploadError,
  VaultClient as BaseVaultClient,
  type VaultClientOptions as BaseVaultClientOptions,
} from "@openparachute/app-client";
import type {
  CreateNotePayload,
  NoteAttachment,
  ReachabilitySignal,
  StorageUploadResult,
  UpdateNotePayload,
  UploadProgress,
} from "./types";

// Error classes + payload types are re-exports from app-client — Phase 2
// of the migration arc lifted the implementations there. Notes imports
// these from `@/lib/vault/client` in many places; the re-exports keep
// every consumer working without per-file edits.
export const VaultAuthError = AppClientVaultAuthError;
export type VaultAuthError = InstanceType<typeof AppClientVaultAuthError>;
export const VaultNotFoundError = AppClientVaultNotFoundError;
export type VaultNotFoundError = InstanceType<typeof AppClientVaultNotFoundError>;
export const VaultUnreachableError = AppClientVaultUnreachableError;
export type VaultUnreachableError = InstanceType<typeof AppClientVaultUnreachableError>;
export const VaultConflictError = AppClientVaultConflictError;
export type VaultConflictError = InstanceType<typeof AppClientVaultConflictError>;
export const VaultTargetExistsError = AppClientVaultTargetExistsError;
export type VaultTargetExistsError = InstanceType<typeof AppClientVaultTargetExistsError>;
export const VaultUploadError = AppClientVaultUploadError;
export type VaultUploadError = InstanceType<typeof AppClientVaultUploadError>;

export type { CreateNotePayload, UpdateNotePayload, UploadProgress, StorageUploadResult };

// File-upload guardrails. Kept Notes-side because they're UX-level (the
// add-attachment flow surfaces them in error messages); app-client's
// VaultClient leaves enforcement to the vault.
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

export type VaultClientOptions = BaseVaultClientOptions;

/**
 * Notes' VaultClient — subclasses app-client's canonical implementation
 * and adds the handful of Notes-only endpoints (tag curation,
 * `linkAttachment`, blob fetch).
 *
 * Every method on the base class (`vaultInfo`, `queryNotes`, `getNote`,
 * `createNote`, `updateNote`, `deleteNote`, `listTags`, `addAttachment`,
 * `listAttachments`, `deleteAttachment`, `uploadStorageFile`,
 * `storageUrl`, `setAccessToken`, `vaultBaseUrl`) is inherited unchanged
 * — no per-method re-declaration here.
 */
export class VaultClient extends BaseVaultClient {
  // Mirror of the base class's private blob-loop dependencies. The base
  // exposes `request*` as protected so JSON paths inherit cleanly, but
  // the underlying `token` / `fetchImpl` / `onAuth*` / `onReachability`
  // remain private — the blob path can't reach them. We capture the
  // same fields on the subclass at construction so `fetchAttachmentBlob`
  // can run its own retry loop without re-exposing private base state.
  //
  // `currentToken` shadows the base's token. The base rotates its own
  // copy on a refresh, and `setAccessToken` (inherited) rotates the
  // base; we override `setAccessToken` to keep both in sync. The blob
  // path's own 401 handler also rotates this field directly.
  private currentToken: string;
  private readonly currentFetchImpl: typeof fetch;
  private readonly currentOnAuthError?: () => Promise<string | null>;
  private readonly currentOnAuthRevoked?: (
    status: number,
    detail?: { errorType?: string; message?: string },
  ) => void;
  private readonly currentOnReachability?: (signal: ReachabilitySignal, reason?: string) => void;

  constructor(opts: VaultClientOptions) {
    super(opts);
    this.currentToken = opts.accessToken;
    this.currentFetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    if (opts.onAuthError !== undefined) this.currentOnAuthError = opts.onAuthError;
    if (opts.onAuthRevoked !== undefined) this.currentOnAuthRevoked = opts.onAuthRevoked;
    if (opts.onReachability !== undefined) this.currentOnReachability = opts.onReachability;
  }

  /**
   * Keep the subclass's shadow token in sync with the base's so the
   * blob path uses the latest credential on the next call. Inherited
   * `setAccessToken` already rotates the base's copy; we override to
   * also rotate ours.
   */
  override setAccessToken(token: string): void {
    super.setAccessToken(token);
    this.currentToken = token;
  }

  // ---------- Notes-only tag-curation endpoints ----------

  // `listTags` but with the full tag-identity record per row
  // (description, parent_names, etc). Used by the schema-audit path
  // (notes#129) to diff vault state against `NOTES_REQUIRED_SCHEMA`.
  async listTagsWithSchema(): Promise<
    Array<{
      name: string;
      count: number;
      description: string | null;
      parent_names: string[] | null;
    }>
  > {
    return this.request("/api/tags?include_schema=true");
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

  // ---------- Notes-only attachment helpers ----------

  /**
   * Notes-only alias of the base's `addAttachment` (same wire shape:
   * POST `/api/notes/:id/attachments`). Callers throughout Notes use
   * the `linkAttachment` name; preserving the alias avoids a sweeping
   * rename and keeps the semantic distinction (link an already-uploaded
   * blob to a note, vs. "add" which the base names generically).
   *
   * Thin delegation to `addAttachment` so any future wire-shape change
   * on the base (extra fields, header additions) carries through
   * automatically rather than drifting between the two implementations.
   */
  async linkAttachment(
    noteIdOrPath: string,
    body: { path: string; mimeType: string; transcribe?: boolean },
  ): Promise<NoteAttachment> {
    return this.addAttachment(noteIdOrPath, body);
  }

  /**
   * Retry-aware GET of an attachment blob URL — used by audio/image
   * render paths (NoteView, VaultImage). Mirrors the base class's
   * refresh-on-401 behavior on the blob path: a 401/403 triggers
   * `onAuthError` once, and the retry uses the rotated token.
   *
   * Carries its own retry loop because the base's `request*` always
   * `res.json()`s the body — which would corrupt an audio/image Blob.
   * The shape is identical to `requestWithRetry`'s auth/reachability
   * branches; the auth callbacks and token state are captured on the
   * subclass at construction (see field declarations above).
   */
  async fetchAttachmentBlob(url: string): Promise<Blob> {
    const target = url.startsWith("http")
      ? url
      : `${this.vaultBaseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
    return this.fetchBlobWithRetry(target, url, true);
  }

  private async fetchBlobWithRetry(
    target: string,
    originalUrl: string,
    allowRetry: boolean,
  ): Promise<Blob> {
    let res: Response;
    try {
      res = await this.currentFetchImpl(target, {
        headers: { Authorization: `Bearer ${this.currentToken}` },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.currentOnReachability?.("unreachable", message);
      throw new VaultUnreachableError(`GET ${originalUrl} failed: ${message}`, 0);
    }
    if (res.status >= 500) {
      this.currentOnReachability?.("unreachable", `HTTP ${res.status}`);
      throw new VaultUnreachableError(`GET ${originalUrl} → ${res.status}`, res.status);
    }
    this.currentOnReachability?.("healthy");
    if (res.status === 401 || res.status === 403) {
      // Mirror the base's requestWithRetry: parse the body BEFORE the
      // refresh-and-retry branch so the detail attached to
      // `onAuthRevoked` matches notes#150's enhanced-error shape
      // (`error_type` + `message`).
      const bodyText = await res.text().catch(() => "");
      let errorType: string | undefined;
      let serverMessage: string | undefined;
      if (bodyText) {
        try {
          const parsed = JSON.parse(bodyText) as { error_type?: unknown; message?: unknown };
          if (typeof parsed.error_type === "string") errorType = parsed.error_type;
          if (typeof parsed.message === "string") serverMessage = parsed.message;
        } catch {
          // Non-JSON body — leave detail undefined.
        }
      }
      if (allowRetry && this.currentOnAuthError) {
        const fresh = await this.currentOnAuthError();
        if (fresh) {
          this.currentToken = fresh;
          // Keep the base's token in sync so subsequent inherited JSON
          // calls also see the rotated token.
          super.setAccessToken(fresh);
          return this.fetchBlobWithRetry(target, originalUrl, false);
        }
        // onAuthError returned null — refresh.ts owns the halt path.
      } else {
        // No refresh path, or post-refresh retry still 401/403. Mirror
        // requestWithRetry so attachment loads also surface the banner
        // with the same `{ errorType, message }` detail shape.
        this.currentOnAuthRevoked?.(res.status, { errorType, message: serverMessage });
      }
      throw new VaultAuthError(`Vault rejected the token (${res.status})`, res.status);
    }
    if (!res.ok) {
      throw new Error(`GET ${originalUrl} failed (${res.status})`);
    }
    return res.blob();
  }
}
