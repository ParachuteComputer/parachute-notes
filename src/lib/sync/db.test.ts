import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type LensDB, deleteMeta, getMeta, openLensDB, setMeta } from "./db";

async function freshDb(): Promise<LensDB> {
  indexedDB.deleteDatabase("parachute-lens");
  return openLensDB();
}

describe("openLensDB", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => {
    db.close();
  });

  it("creates all expected object stores on first open", () => {
    const names = Array.from(db.objectStoreNames);
    expect(names).toContain("pending");
    expect(names).toContain("id_map");
    expect(names).toContain("blob_path_map");
    expect(names).toContain("blobs");
    expect(names).toContain("meta");
  });

  it("creates pending with autoincrement + by-vault + by-status indexes", async () => {
    const tx = db.transaction("pending", "readonly");
    const store = tx.store;
    expect(store.autoIncrement).toBe(true);
    expect(store.keyPath).toBe("seq");
    expect(Array.from(store.indexNames)).toEqual(expect.arrayContaining(["by-vault", "by-status"]));
  });

  it("round-trips meta values", async () => {
    await setMeta(db, "schemaVersion", 1);
    expect(await getMeta(db, "schemaVersion")).toBe(1);
    await setMeta(db, "schemaVersion", 2);
    expect(await getMeta(db, "schemaVersion")).toBe(2);
    await deleteMeta(db, "schemaVersion");
    expect(await getMeta(db, "schemaVersion")).toBeUndefined();
  });

  it("survives reopen — data persists across handles", async () => {
    await setMeta(db, "hello", "world");
    db.close();
    const db2 = await openLensDB();
    expect(await getMeta(db2, "hello")).toBe("world");
    db2.close();
  });
});
