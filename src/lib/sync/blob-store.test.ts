import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIdbBlobStore, newBlobId } from "./blob-store";
import { type LensDB, openLensDB } from "./db";

async function freshDb(): Promise<LensDB> {
  indexedDB.deleteDatabase("parachute-lens");
  return openLensDB();
}

describe("IdbBlobStore (fallback path)", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => {
    db.close();
  });

  it("reports the 'idb' backend", () => {
    const store = createIdbBlobStore(db);
    expect(store.backend).toBe("idb");
  });

  it("round-trips bytes + mime type", async () => {
    const store = createIdbBlobStore(db);
    const id = newBlobId();
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    await store.put(id, buffer, "audio/wav", "v1");
    const read = await store.get(id);
    expect(read).not.toBeNull();
    expect(read!.mimeType).toBe("audio/wav");
    expect(Array.from(new Uint8Array(read!.data))).toEqual([1, 2, 3, 4]);
  });

  it("returns null for a missing blob", async () => {
    const store = createIdbBlobStore(db);
    expect(await store.get("missing")).toBeNull();
  });

  it("delete removes the blob", async () => {
    const store = createIdbBlobStore(db);
    const id = newBlobId();
    await store.put(id, new Uint8Array([1]).buffer, "application/octet-stream", "v1");
    await store.delete(id);
    expect(await store.get(id)).toBeNull();
  });

  it("newBlobId returns a fresh UUID each call", () => {
    const a = newBlobId();
    const b = newBlobId();
    expect(a).not.toBe(b);
  });
});
