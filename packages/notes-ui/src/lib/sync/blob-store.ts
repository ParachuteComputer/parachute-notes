import type { LensDB } from "./db";

// OPFS gives us a much larger quota (and streaming writes) than IndexedDB, but
// it's not universally supported yet. When unavailable we fall back to the
// `blobs` object store in IndexedDB.

const OPFS_DIR = "lens-blobs";

function hasOPFS(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage !== "undefined" &&
    typeof navigator.storage.getDirectory === "function"
  );
}

async function opfsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create: true });
}

export interface StoredBlob {
  data: ArrayBuffer;
  mimeType: string;
}

export interface BlobStore {
  readonly backend: "opfs" | "idb";
  put(blobId: string, data: ArrayBuffer, mimeType: string, vaultId: string): Promise<void>;
  get(blobId: string): Promise<StoredBlob | null>;
  delete(blobId: string): Promise<void>;
}

// Convenience helper for callers holding a Blob from e.g. MediaRecorder. Wraps
// the Response trick, which is the most portable way to read bytes across
// environments (real browsers, jsdom, node).
export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Response(blob).arrayBuffer();
}

export function newBlobId(): string {
  return crypto.randomUUID();
}

class OpfsBlobStore implements BlobStore {
  readonly backend = "opfs" as const;
  async put(blobId: string, data: ArrayBuffer, mimeType: string): Promise<void> {
    const dir = await opfsDir();
    const handle = await dir.getFileHandle(blobId, { create: true });
    // createSyncAccessHandle is faster but only available in workers; writable
    // stream works on the main thread. We also need the mimeType later, so
    // stash it in a sidecar file — OPFS has no metadata channel of its own.
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
    const metaHandle = await dir.getFileHandle(`${blobId}.meta`, { create: true });
    const metaWritable = await metaHandle.createWritable();
    await metaWritable.write(mimeType);
    await metaWritable.close();
  }
  async get(blobId: string): Promise<StoredBlob | null> {
    try {
      const dir = await opfsDir();
      const handle = await dir.getFileHandle(blobId);
      const file = await handle.getFile();
      const buffer = await file.arrayBuffer();
      let mimeType = "application/octet-stream";
      try {
        const metaHandle = await dir.getFileHandle(`${blobId}.meta`);
        const metaFile = await metaHandle.getFile();
        mimeType = (await metaFile.text()) || mimeType;
      } catch {
        // No sidecar — use the default.
      }
      return { data: buffer, mimeType };
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotFoundError") return null;
      throw e;
    }
  }
  async delete(blobId: string): Promise<void> {
    const dir = await opfsDir();
    for (const name of [blobId, `${blobId}.meta`]) {
      try {
        await dir.removeEntry(name);
      } catch (e) {
        if (e instanceof DOMException && e.name === "NotFoundError") continue;
        throw e;
      }
    }
  }
}

class IdbBlobStore implements BlobStore {
  readonly backend = "idb" as const;
  constructor(private readonly db: LensDB) {}
  async put(blobId: string, data: ArrayBuffer, mimeType: string, vaultId: string): Promise<void> {
    await this.db.put("blobs", {
      blobId,
      data,
      mimeType,
      vaultId,
      createdAt: Date.now(),
    });
  }
  async get(blobId: string): Promise<StoredBlob | null> {
    const row = await this.db.get("blobs", blobId);
    if (!row) return null;
    return { data: row.data, mimeType: row.mimeType };
  }
  async delete(blobId: string): Promise<void> {
    await this.db.delete("blobs", blobId);
  }
}

export function createBlobStore(db: LensDB): BlobStore {
  return hasOPFS() ? new OpfsBlobStore() : new IdbBlobStore(db);
}

// Exported for tests — allows forcing the IDB fallback path even when OPFS is
// available (e.g., to exercise it in a browser that has OPFS).
export function createIdbBlobStore(db: LensDB): BlobStore {
  return new IdbBlobStore(db);
}
