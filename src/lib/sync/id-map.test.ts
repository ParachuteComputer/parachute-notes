import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type LensDB, openLensDB } from "./db";
import {
  LOCAL_ID_PREFIX,
  blobIdFromRef,
  blobRef,
  isBlobRef,
  isLocalId,
  newLocalId,
  recordBlobPath,
  recordIdMap,
  resolveBlobPath,
  resolveNoteId,
} from "./id-map";

async function freshDb(): Promise<LensDB> {
  indexedDB.deleteDatabase("parachute-lens");
  return openLensDB();
}

describe("local ids", () => {
  it("newLocalId returns a stable-prefix UUID", () => {
    const id = newLocalId();
    expect(id.startsWith(LOCAL_ID_PREFIX)).toBe(true);
    expect(isLocalId(id)).toBe(true);
    expect(isLocalId("abcd-server-id")).toBe(false);
  });
});

describe("blob refs", () => {
  it("round-trips a blob id through blobRef / blobIdFromRef", () => {
    const ref = blobRef("blob-123");
    expect(isBlobRef(ref)).toBe(true);
    expect(blobIdFromRef(ref)).toBe("blob-123");
    expect(isBlobRef("/storage/foo.png")).toBe(false);
  });
});

describe("resolveNoteId / recordIdMap", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => {
    db.close();
  });

  it("passes through non-local ids", async () => {
    expect(await resolveNoteId(db, "srv-1", "v1")).toBe("srv-1");
  });

  it("returns null for an unresolved local id", async () => {
    const local = newLocalId();
    expect(await resolveNoteId(db, local, "v1")).toBeNull();
  });

  it("maps local → real after recordIdMap", async () => {
    const local = newLocalId();
    await recordIdMap(db, local, "real-42", "v1");
    expect(await resolveNoteId(db, local, "v1")).toBe("real-42");
  });

  it("scopes resolution to the vault the mapping was recorded under", async () => {
    const local = newLocalId();
    await recordIdMap(db, local, "real-42", "v1");
    expect(await resolveNoteId(db, local, "v2")).toBeNull();
  });
});

describe("resolveBlobPath / recordBlobPath", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => {
    db.close();
  });

  it("passes through non-blob refs", async () => {
    expect(await resolveBlobPath(db, "/storage/foo.png", "v1")).toBe("/storage/foo.png");
  });

  it("returns null for an unresolved blob ref", async () => {
    expect(await resolveBlobPath(db, blobRef("b1"), "v1")).toBeNull();
  });

  it("maps blob → server path after recordBlobPath", async () => {
    await recordBlobPath(db, "b1", "/storage/a1b2.png", "v1");
    expect(await resolveBlobPath(db, blobRef("b1"), "v1")).toBe("/storage/a1b2.png");
  });

  it("scopes to vault", async () => {
    await recordBlobPath(db, "b1", "/storage/a1b2.png", "v1");
    expect(await resolveBlobPath(db, blobRef("b1"), "v2")).toBeNull();
  });
});
