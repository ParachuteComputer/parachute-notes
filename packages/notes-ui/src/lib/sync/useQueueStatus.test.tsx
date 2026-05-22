import { type LensDB, openLensDB, setMeta } from "@/lib/sync/db";
import { AUTH_HALT_META, enqueue, useQueueStatus } from "@/lib/sync/index";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

async function freshDb(): Promise<LensDB> {
  indexedDB.deleteDatabase("parachute-lens");
  return openLensDB();
}

describe("useQueueStatus", () => {
  let db: LensDB;

  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => db.close());

  it("returns EMPTY when db or vaultId is null", () => {
    const { result } = renderHook(() => useQueueStatus(null, "v1", 50));
    expect(result.current.total).toBe(0);
    expect(result.current.rows).toEqual([]);
    expect(result.current.authHalt).toBeNull();
  });

  it("groups rows by kind and counts pending vs needs-human", async () => {
    const a = await enqueue(db, { kind: "delete-note", targetId: "n1" }, { vaultId: "v1" });
    const b = await enqueue(
      db,
      { kind: "create-note", localId: "tmp:x", payload: { content: "hi" } },
      { vaultId: "v1" },
    );
    // Force one into needs-human.
    const row = await db.get("pending", b.seq);
    if (row) await db.put("pending", { ...row, status: "needs-human" });

    const { result } = renderHook(() => useQueueStatus(db, "v1", 50));
    await waitFor(() => {
      expect(result.current.total).toBe(2);
    });
    expect(result.current.byKind["delete-note"]).toBe(1);
    expect(result.current.byKind["create-note"]).toBe(1);
    expect(result.current.pendingCount).toBe(1);
    expect(result.current.needsHumanCount).toBe(1);
    // Keep references used to silence unused-var lints.
    expect(a.seq).toBeGreaterThan(0);
  });

  it("filters auth-halt meta by vaultId (other vault's halt is ignored)", async () => {
    await setMeta(db, AUTH_HALT_META, {
      vaultId: "other",
      at: Date.now(),
      message: "not mine",
    });

    const { result } = renderHook(() => useQueueStatus(db, "v1", 50));
    await waitFor(() => {
      expect(result.current.rows).toEqual([]);
    });
    expect(result.current.authHalt).toBeNull();
  });

  it("surfaces auth-halt meta that matches the active vaultId", async () => {
    await setMeta(db, AUTH_HALT_META, {
      vaultId: "v1",
      at: 12345,
      message: "reconnect",
    });

    const { result } = renderHook(() => useQueueStatus(db, "v1", 50));
    await waitFor(() => {
      expect(result.current.authHalt).not.toBeNull();
    });
    expect(result.current.authHalt?.message).toBe("reconnect");
    expect(result.current.authHalt?.vaultId).toBe("v1");
  });
});
