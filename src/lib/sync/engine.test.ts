import type { VaultClient } from "@/lib/vault/client";
import type { Note } from "@/lib/vault/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIdbBlobStore } from "./blob-store";
import { type LensDB, openLensDB } from "./db";
import { SyncEngine } from "./engine";
import { countPending, enqueue } from "./queue";

async function freshDb(): Promise<LensDB> {
  indexedDB.deleteDatabase("parachute-lens");
  return openLensDB();
}

function makeClient(): VaultClient {
  return {
    deleteNote: vi.fn(async () => {}),
    updateNote: vi.fn(async (id: string) => ({ id, createdAt: "now" }) as Note),
    createNote: vi.fn(async () => ({ id: "srv", createdAt: "now" }) as Note),
    uploadStorageFile: vi.fn(),
    linkAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
  } as unknown as VaultClient;
}

describe("SyncEngine", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => {
    db.close();
  });

  it("drains once on start() without waiting for the interval", async () => {
    await enqueue(db, { kind: "delete-note", targetId: "n1" }, { vaultId: "v1" });
    const client = makeClient();
    const onDrain = vi.fn();
    const engine = new SyncEngine({
      db,
      blobStore: createIdbBlobStore(db),
      resolveContext: () => ({ client, vaultId: "v1" }),
      tickIntervalMs: 60_000,
      onDrain,
    });
    engine.start();
    await engine.lastRun;
    expect(await countPending(db, "v1")).toBe(0);
    expect(onDrain).toHaveBeenCalled();
    engine.stop();
  });

  it("no-ops when resolveContext returns null (no active vault)", async () => {
    await enqueue(db, { kind: "delete-note", targetId: "n1" }, { vaultId: "v1" });
    const engine = new SyncEngine({
      db,
      blobStore: createIdbBlobStore(db),
      resolveContext: () => null,
    });
    const outcome = await engine.runOnce();
    expect(outcome).toBeNull();
    expect(await countPending(db)).toBe(1);
  });

  it("no-ops when navigator is offline", async () => {
    const onLineDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => false,
    });
    try {
      await enqueue(db, { kind: "delete-note", targetId: "n1" }, { vaultId: "v1" });
      const client = makeClient();
      const engine = new SyncEngine({
        db,
        blobStore: createIdbBlobStore(db),
        resolveContext: () => ({ client, vaultId: "v1" }),
      });
      expect(await engine.runOnce()).toBeNull();
      expect(await countPending(db)).toBe(1);
    } finally {
      if (onLineDesc) Object.defineProperty(navigator, "onLine", onLineDesc);
    }
  });
});
