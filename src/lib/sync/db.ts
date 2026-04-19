import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { BlobPathMapRow, IdMapRow, MetaRow, PendingRow } from "./types";

export const DB_NAME = "parachute-lens";
// Bump on schema changes and add a case to `migrate()`. Read schemaVersion from
// `meta` if you need to introspect which migrations have run.
export const DB_VERSION = 1;

export interface LensSyncSchema extends DBSchema {
  pending: {
    key: number;
    value: PendingRow;
    indexes: { "by-vault": string; "by-status": string };
  };
  id_map: {
    key: string;
    value: IdMapRow;
    indexes: { "by-vault": string };
  };
  blob_path_map: {
    key: string;
    value: BlobPathMapRow;
    indexes: { "by-vault": string };
  };
  blobs: {
    key: string;
    value: {
      blobId: string;
      // Stored as a raw byte buffer + mimeType rather than a Blob. Some
      // runtimes (notably fake-indexeddb under vitest) don't preserve Blob
      // through structured clone; ArrayBuffer round-trips identically
      // everywhere we run.
      data: ArrayBuffer;
      mimeType: string;
      vaultId: string;
      createdAt: number;
    };
  };
  meta: {
    key: string;
    value: MetaRow;
  };
}

export type LensDB = IDBPDatabase<LensSyncSchema>;

export async function openLensDB(name = DB_NAME, version = DB_VERSION): Promise<LensDB> {
  return openDB<LensSyncSchema>(name, version, {
    upgrade(db, oldVersion) {
      migrate(db, oldVersion);
    },
  });
}

function migrate(db: LensDB, fromVersion: number): void {
  // Any migration ladder starts with v0 → v1. Add further cases as versions bump.
  if (fromVersion < 1) {
    const pending = db.createObjectStore("pending", { keyPath: "seq", autoIncrement: true });
    pending.createIndex("by-vault", "vaultId");
    pending.createIndex("by-status", "status");

    const idMap = db.createObjectStore("id_map", { keyPath: "localId" });
    idMap.createIndex("by-vault", "vaultId");

    const blobPath = db.createObjectStore("blob_path_map", { keyPath: "blobId" });
    blobPath.createIndex("by-vault", "vaultId");

    db.createObjectStore("blobs", { keyPath: "blobId" });
    db.createObjectStore("meta", { keyPath: "key" });
  }
}

export async function getMeta<T>(db: LensDB, key: string): Promise<T | undefined> {
  const row = await db.get("meta", key);
  return row?.value as T | undefined;
}

export async function setMeta(db: LensDB, key: string, value: unknown): Promise<void> {
  await db.put("meta", { key, value });
}

export async function deleteMeta(db: LensDB, key: string): Promise<void> {
  await db.delete("meta", key);
}
