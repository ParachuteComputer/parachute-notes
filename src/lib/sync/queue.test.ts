import { ScribeError } from "@/lib/scribe";
import { VaultAuthError, VaultConflictError, VaultNotFoundError } from "@/lib/vault/client";
import type { VaultClient } from "@/lib/vault/client";
import type { Note, NoteAttachment } from "@/lib/vault/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIdbBlobStore, newBlobId } from "./blob-store";
import { type LensDB, getMeta, openLensDB } from "./db";
import { blobRef, newLocalId, resolveNoteId } from "./id-map";
import {
  AUTH_HALT_META,
  TRANSCRIBE_GIVE_UP_MS,
  countPending,
  drain,
  enqueue,
  listPending,
} from "./queue";

async function freshDb(): Promise<LensDB> {
  indexedDB.deleteDatabase("parachute-lens");
  return openLensDB();
}

interface ClientOverrides {
  createNote?: VaultClient["createNote"];
  updateNote?: VaultClient["updateNote"];
  deleteNote?: VaultClient["deleteNote"];
  uploadStorageFile?: VaultClient["uploadStorageFile"];
  linkAttachment?: VaultClient["linkAttachment"];
  deleteAttachment?: VaultClient["deleteAttachment"];
  getNote?: VaultClient["getNote"];
}

function makeClient(overrides: ClientOverrides = {}): VaultClient {
  const defaults = {
    createNote: vi.fn(async (_p: unknown) => ({ id: "srv-note", createdAt: "now" }) as Note),
    updateNote: vi.fn(async (id: string) => ({ id, createdAt: "now", updatedAt: "now" }) as Note),
    deleteNote: vi.fn(async () => {}),
    uploadStorageFile: vi.fn(async (_f: File) => ({
      path: "/storage/new.dat",
      size: 1,
      mimeType: "application/octet-stream",
    })),
    linkAttachment: vi.fn(async () => ({ id: "att-1" }) as NoteAttachment),
    deleteAttachment: vi.fn(async () => {}),
    getNote: vi.fn(async (id: string) => ({ id, createdAt: "now", content: "" }) as Note),
  };
  return { ...defaults, ...overrides } as unknown as VaultClient;
}

describe("enqueue", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => db.close());

  it("persists a row with autoincrement seq", async () => {
    const a = await enqueue(db, { kind: "delete-note", targetId: "n1" }, { vaultId: "v1" });
    const b = await enqueue(db, { kind: "delete-note", targetId: "n2" }, { vaultId: "v1" });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(await countPending(db, "v1")).toBe(2);
  });

  it("survives close + reopen (restart resilience)", async () => {
    await enqueue(db, { kind: "delete-note", targetId: "n1" }, { vaultId: "v1" });
    db.close();
    const db2 = await openLensDB();
    expect(await countPending(db2, "v1")).toBe(1);
    db2.close();
  });
});

describe("drain — happy path", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => db.close());

  it("calls createNote, records id-map, deletes row", async () => {
    const localId = newLocalId();
    await enqueue(
      db,
      {
        kind: "create-note",
        localId,
        payload: { content: "# Hello", path: "Inbox/Hello" },
      },
      { vaultId: "v1" },
    );
    const created = { id: "srv-42", path: "Inbox/Hello", createdAt: "now" } as Note;
    const createNote = vi.fn(async () => created);
    const client = makeClient({ createNote });
    const out = await drain({
      db,
      client,
      vaultId: "v1",
      blobStore: createIdbBlobStore(db),
    });
    expect(out.drained).toBe(1);
    expect(createNote).toHaveBeenCalledOnce();
    expect(await resolveNoteId(db, localId, "v1")).toBe("srv-42");
    expect(await countPending(db)).toBe(0);
  });

  it("drains FIFO: create → update → delete resolves local id at each step", async () => {
    const localId = newLocalId();
    await enqueue(
      db,
      { kind: "create-note", localId, payload: { content: "x" } },
      { vaultId: "v1" },
    );
    await enqueue(
      db,
      { kind: "update-note", targetId: localId, payload: { content: "y" } },
      { vaultId: "v1" },
    );
    await enqueue(db, { kind: "delete-note", targetId: localId }, { vaultId: "v1" });

    const createNote = vi.fn(async () => ({ id: "srv-1", createdAt: "now" }) as Note);
    const updateNote = vi.fn(async (id: string) => ({ id, createdAt: "now" }) as Note);
    const deleteNote = vi.fn(async () => {});
    const client = makeClient({ createNote, updateNote, deleteNote });

    const out = await drain({
      db,
      client,
      vaultId: "v1",
      blobStore: createIdbBlobStore(db),
    });
    expect(out.drained).toBe(3);
    expect(createNote).toHaveBeenCalledOnce();
    expect(updateNote).toHaveBeenCalledWith("srv-1", { content: "y" });
    expect(deleteNote).toHaveBeenCalledWith("srv-1");
  });

  it("resolves a blob ref through upload-attachment + link-attachment", async () => {
    const blobId = newBlobId();
    const blobStore = createIdbBlobStore(db);
    await blobStore.put(blobId, new Uint8Array([1, 2, 3]).buffer, "audio/wav", "v1");

    await enqueue(
      db,
      { kind: "upload-attachment", blobId, filename: "a.wav", mimeType: "audio/wav" },
      { vaultId: "v1" },
    );
    await enqueue(
      db,
      {
        kind: "link-attachment",
        noteId: "srv-n",
        pathRef: blobRef(blobId),
        mimeType: "audio/wav",
      },
      { vaultId: "v1" },
    );

    const uploadStorageFile = vi.fn(async () => ({
      path: "/storage/abc.wav",
      size: 5,
      mimeType: "audio/wav",
    }));
    const linkAttachment = vi.fn(async () => ({ id: "att-1" }) as NoteAttachment);
    const client = makeClient({ uploadStorageFile, linkAttachment });

    const out = await drain({ db, client, vaultId: "v1", blobStore });
    expect(out.drained).toBe(2);
    expect(uploadStorageFile).toHaveBeenCalledOnce();
    expect(linkAttachment).toHaveBeenCalledWith("srv-n", {
      path: "/storage/abc.wav",
      mimeType: "audio/wav",
    });
    // Blob cleaned up after upload.
    expect(await blobStore.get(blobId)).toBeNull();
  });
});

describe("drain — error classification", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => db.close());

  it("stashes conflict as needs-human and continues past it", async () => {
    await enqueue(
      db,
      { kind: "update-note", targetId: "srv-1", payload: { content: "x" } },
      { vaultId: "v1" },
    );
    await enqueue(db, { kind: "delete-note", targetId: "srv-2" }, { vaultId: "v1" });

    const updateNote = vi.fn(async () => {
      throw new VaultConflictError({ current_updated_at: "now", expected_updated_at: "then" });
    });
    const deleteNote = vi.fn(async () => {});
    const client = makeClient({ updateNote, deleteNote });
    const out = await drain({ db, client, vaultId: "v1", blobStore: createIdbBlobStore(db) });
    expect(out.stashed).toBe(1);
    expect(out.drained).toBe(1);
    const rows = await listPending(db, "v1");
    expect(rows.map((r) => r.status)).toEqual(["needs-human"]);
    expect(deleteNote).toHaveBeenCalledOnce();
  });

  it("halts drain on auth error and persists the auth-halt meta marker", async () => {
    await enqueue(
      db,
      { kind: "update-note", targetId: "srv-1", payload: { content: "x" } },
      { vaultId: "v1" },
    );
    await enqueue(db, { kind: "delete-note", targetId: "srv-2" }, { vaultId: "v1" });

    const updateNote = vi.fn(async () => {
      throw new VaultAuthError("no good");
    });
    const deleteNote = vi.fn(async () => {});
    const client = makeClient({ updateNote, deleteNote });
    const out = await drain({ db, client, vaultId: "v1", blobStore: createIdbBlobStore(db) });
    expect(out.authHalted).toBe(true);
    expect(deleteNote).not.toHaveBeenCalled();
    expect(await countPending(db, "v1")).toBe(2);
    const halt = await getMeta<{ vaultId: string }>(db, AUTH_HALT_META);
    expect(halt?.vaultId).toBe("v1");
  });

  it("drops the row on 404 (target is gone)", async () => {
    await enqueue(db, { kind: "delete-note", targetId: "srv-missing" }, { vaultId: "v1" });
    const deleteNote = vi.fn(async () => {
      throw new VaultNotFoundError("nope");
    });
    const client = makeClient({ deleteNote });
    const out = await drain({ db, client, vaultId: "v1", blobStore: createIdbBlobStore(db) });
    expect(out.drained).toBe(1);
    expect(await countPending(db)).toBe(0);
  });

  it("backs off transient errors and leaves the row for next tick", async () => {
    await enqueue(db, { kind: "delete-note", targetId: "srv-1" }, { vaultId: "v1" });
    const deleteNote = vi.fn(async () => {
      throw new Error("Network boom");
    });
    const client = makeClient({ deleteNote });
    const t0 = 1_000_000;
    const out = await drain({
      db,
      client,
      vaultId: "v1",
      blobStore: createIdbBlobStore(db),
      now: () => t0,
    });
    expect(out.deferred).toBe(1);
    expect(out.drained).toBe(0);
    const rows = await listPending(db, "v1");
    expect(rows[0].attemptCount).toBe(1);
    expect(rows[0].nextAttemptAt).toBeGreaterThan(t0);
    expect(rows[0].lastError).toContain("Network boom");
  });

  it("skips rows whose nextAttemptAt is in the future", async () => {
    await enqueue(db, { kind: "delete-note", targetId: "srv-1" }, { vaultId: "v1" });
    // Force the backoff.
    const client1 = makeClient({
      deleteNote: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await drain({
      db,
      client: client1,
      vaultId: "v1",
      blobStore: createIdbBlobStore(db),
      now: () => 1_000,
    });
    // Immediate re-drain: row is still deferred, not attempted.
    const deleteNote = vi.fn(async () => {});
    const client2 = makeClient({ deleteNote });
    const out = await drain({
      db,
      client: client2,
      vaultId: "v1",
      blobStore: createIdbBlobStore(db),
      now: () => 1_001,
    });
    expect(deleteNote).not.toHaveBeenCalled();
    expect(out.drained).toBe(0);
  });
});

describe("drain — upload-attachment retention", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => db.close());

  it("deletes the blob after a normal upload-attachment", async () => {
    const blobId = newBlobId();
    const blobStore = createIdbBlobStore(db);
    await blobStore.put(blobId, new Uint8Array([9]).buffer, "audio/webm", "v1");
    await enqueue(
      db,
      { kind: "upload-attachment", blobId, filename: "a.webm", mimeType: "audio/webm" },
      { vaultId: "v1" },
    );
    await drain({ db, client: makeClient(), vaultId: "v1", blobStore });
    expect(await blobStore.get(blobId)).toBeNull();
  });

  it("retains the blob when retain=true is set", async () => {
    const blobId = newBlobId();
    const blobStore = createIdbBlobStore(db);
    await blobStore.put(blobId, new Uint8Array([9]).buffer, "audio/webm", "v1");
    await enqueue(
      db,
      {
        kind: "upload-attachment",
        blobId,
        filename: "a.webm",
        mimeType: "audio/webm",
        retain: true,
      },
      { vaultId: "v1" },
    );
    await drain({ db, client: makeClient(), vaultId: "v1", blobStore });
    const stored = await blobStore.get(blobId);
    expect(stored).not.toBeNull();
    expect(stored!.mimeType).toBe("audio/webm");
  });
});

describe("drain — transcribe-memo", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => db.close());

  async function seedBlob(blobId: string): Promise<ReturnType<typeof createIdbBlobStore>> {
    const blobStore = createIdbBlobStore(db);
    await blobStore.put(blobId, new Uint8Array([1, 2, 3]).buffer, "audio/webm", "v1");
    return blobStore;
  }

  const settings = { url: "http://scribe.local", cleanup: false };

  it("PATCHes the note with the transcript and deletes the blob on success", async () => {
    const blobId = newBlobId();
    const blobStore = await seedBlob(blobId);
    const stubContent = "# 🎙️ Voice memo\n\n_Transcript pending._\n";
    await enqueue(
      db,
      {
        kind: "transcribe-memo",
        noteId: "srv-1",
        blobId,
        filename: "memo.webm",
        mimeType: "audio/webm",
        marker: "_Transcript pending._",
      },
      { vaultId: "v1" },
    );

    const getNote = vi.fn(
      async (id: string) =>
        ({
          id,
          createdAt: "now",
          content: stubContent,
        }) as Note,
    );
    const updateNote = vi.fn(
      async (id: string) => ({ id, createdAt: "now", updatedAt: "now" }) as Note,
    );
    const transcribeImpl = vi.fn(async () => ({ text: "hello world" }));
    const client = makeClient({ getNote, updateNote });

    const out = await drain({
      db,
      client,
      vaultId: "v1",
      blobStore,
      scribeSettings: settings,
      transcribeImpl,
    });

    expect(out.drained).toBe(1);
    expect(transcribeImpl).toHaveBeenCalledOnce();
    expect(updateNote).toHaveBeenCalledWith("srv-1", {
      content: expect.stringContaining("## Transcript\n\nhello world"),
    });
    expect(await blobStore.get(blobId)).toBeNull();
  });

  it("stashes as needs-human when the user has edited the note (marker gone)", async () => {
    const blobId = newBlobId();
    const blobStore = await seedBlob(blobId);
    await enqueue(
      db,
      {
        kind: "transcribe-memo",
        noteId: "srv-1",
        blobId,
        filename: "memo.webm",
        mimeType: "audio/webm",
        marker: "_Transcript pending._",
      },
      { vaultId: "v1" },
    );
    const getNote = vi.fn(
      async (id: string) =>
        ({
          id,
          createdAt: "now",
          content: "# 🎙️ Voice memo\n\nI already rewrote this.",
        }) as Note,
    );
    const transcribeImpl = vi.fn(async () => ({ text: "not used" }));
    const client = makeClient({ getNote });

    const out = await drain({
      db,
      client,
      vaultId: "v1",
      blobStore,
      scribeSettings: settings,
      transcribeImpl,
    });

    expect(out.stashed).toBe(1);
    expect(transcribeImpl).not.toHaveBeenCalled();
    const rows = await listPending(db, "v1");
    expect(rows[0].status).toBe("needs-human");
    // Blob stays so the user can re-run transcription later.
    expect(await blobStore.get(blobId)).not.toBeNull();
  });

  it("backs off and retains the row when scribe is unavailable", async () => {
    const blobId = newBlobId();
    const blobStore = await seedBlob(blobId);
    await enqueue(
      db,
      {
        kind: "transcribe-memo",
        noteId: "srv-1",
        blobId,
        filename: "memo.webm",
        mimeType: "audio/webm",
        marker: "_Transcript pending._",
      },
      { vaultId: "v1" },
    );
    const getNote = vi.fn(
      async (id: string) =>
        ({
          id,
          createdAt: "now",
          content: "# 🎙️ Voice memo\n\n_Transcript pending._\n",
        }) as Note,
    );
    const transcribeImpl = vi.fn(async () => {
      throw new ScribeError("unavailable", "offline");
    });
    const client = makeClient({ getNote });

    const out = await drain({
      db,
      client,
      vaultId: "v1",
      blobStore,
      scribeSettings: settings,
      transcribeImpl,
      now: () => 1_000_000,
    });

    expect(out.deferred).toBe(1);
    const rows = await listPending(db, "v1");
    expect(rows[0].attemptCount).toBe(1);
    expect(rows[0].nextAttemptAt).toBeGreaterThan(1_000_000);
    // Blob preserved across retry.
    expect(await blobStore.get(blobId)).not.toBeNull();
  });

  it("drops the row and leaves an 'unavailable' footnote after 24h", async () => {
    const blobId = newBlobId();
    const blobStore = await seedBlob(blobId);
    const t0 = 1_000_000;
    await enqueue(
      db,
      {
        kind: "transcribe-memo",
        noteId: "srv-1",
        blobId,
        filename: "memo.webm",
        mimeType: "audio/webm",
        marker: "_Transcript pending._",
      },
      { vaultId: "v1" },
    );
    // Fix the row's createdAt retroactively so the age check trips.
    const rows0 = await listPending(db);
    await db.put("pending", { ...rows0[0], createdAt: t0 });

    const getNote = vi.fn(
      async (id: string) =>
        ({
          id,
          createdAt: "now",
          content: "# 🎙️ Voice memo\n\n_Transcript pending._\n",
        }) as Note,
    );
    const updateNote = vi.fn(
      async (id: string) => ({ id, createdAt: "now", updatedAt: "now" }) as Note,
    );
    const transcribeImpl = vi.fn(async () => ({ text: "never runs" }));
    const client = makeClient({ getNote, updateNote });

    const out = await drain({
      db,
      client,
      vaultId: "v1",
      blobStore,
      scribeSettings: settings,
      transcribeImpl,
      now: () => t0 + TRANSCRIBE_GIVE_UP_MS + 1,
    });

    expect(out.drained).toBe(1);
    expect(transcribeImpl).not.toHaveBeenCalled();
    expect(updateNote).toHaveBeenCalledWith("srv-1", {
      content: expect.stringContaining("_Transcription unavailable._"),
    });
    expect(await blobStore.get(blobId)).toBeNull();
    expect(await countPending(db, "v1")).toBe(0);
  });

  it("drops the row and cleans up the blob when scribe settings are missing", async () => {
    const blobId = newBlobId();
    const blobStore = await seedBlob(blobId);
    await enqueue(
      db,
      {
        kind: "transcribe-memo",
        noteId: "srv-1",
        blobId,
        filename: "memo.webm",
        mimeType: "audio/webm",
        marker: "_Transcript pending._",
      },
      { vaultId: "v1" },
    );

    const client = makeClient();
    const out = await drain({
      db,
      client,
      vaultId: "v1",
      blobStore,
      scribeSettings: null,
    });

    expect(out.drained).toBe(1);
    expect(await blobStore.get(blobId)).toBeNull();
    expect(await countPending(db, "v1")).toBe(0);
  });
});

describe("drain — vault isolation", () => {
  let db: LensDB;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => db.close());

  it("leaves rows for other vaults untouched", async () => {
    await enqueue(db, { kind: "delete-note", targetId: "A1" }, { vaultId: "vA" });
    await enqueue(db, { kind: "delete-note", targetId: "B1" }, { vaultId: "vB" });
    const deleteNote = vi.fn(async () => {});
    const client = makeClient({ deleteNote });
    const out = await drain({
      db,
      client,
      vaultId: "vA",
      blobStore: createIdbBlobStore(db),
    });
    expect(out.drained).toBe(1);
    expect(deleteNote).toHaveBeenCalledWith("A1");
    expect(await countPending(db, "vB")).toBe(1);
  });
});
