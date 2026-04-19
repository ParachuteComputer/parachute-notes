import type { ScribeSettings } from "@/lib/scribe";
import type { VaultClient } from "@/lib/vault/client";
import type { BlobStore } from "./blob-store";
import type { LensDB } from "./db";
import { drain } from "./queue";
import type { DrainOutcome } from "./types";

export interface EngineDrainContext {
  client: VaultClient;
  vaultId: string;
  // Per-vault scribe settings — passed through to drain so transcribe-memo
  // rows have somewhere to POST. `null` (or missing) drops transcribe rows
  // rather than retrying forever.
  scribeSettings?: ScribeSettings | null;
}

export interface EngineOptions {
  db: LensDB;
  blobStore: BlobStore;
  // Resolves the client + vault-id to drain against on each tick. Returning
  // null (no active vault / no token) pauses the engine — the timer keeps
  // running in case state changes.
  resolveContext: () => EngineDrainContext | null;
  tickIntervalMs?: number;
  // Fires right before a drain starts — UI can flip "syncing" on.
  onDrainStart?: () => void;
  onDrain?: (outcome: DrainOutcome) => void;
}

const DEFAULT_TICK_MS = 30_000;

export class SyncEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private draining = false;
  private readonly tickMs: number;
  private readonly onlineListener: () => void;
  // The in-flight promise kicked off by start(); tests can await it to observe
  // the initial drain.
  public lastRun: Promise<unknown> | null = null;

  constructor(private readonly opts: EngineOptions) {
    this.tickMs = opts.tickIntervalMs ?? DEFAULT_TICK_MS;
    this.onlineListener = () => {
      this.lastRun = this.runOnce();
    };
  }

  start(): void {
    if (this.timer) return;
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onlineListener);
    }
    this.timer = setInterval(() => {
      this.lastRun = this.runOnce();
    }, this.tickMs);
    // Run immediately on start so queued rows drain without waiting for the
    // first tick. Callers/tests can await `lastRun` to sequence against the
    // initial drain.
    this.lastRun = this.runOnce();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onlineListener);
    }
  }

  get isDraining(): boolean {
    return this.draining;
  }

  async runOnce(): Promise<DrainOutcome | null> {
    if (this.draining) return null;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
    const ctx = this.opts.resolveContext();
    if (!ctx) return null;
    this.draining = true;
    this.opts.onDrainStart?.();
    try {
      const outcome = await drain({
        db: this.opts.db,
        client: ctx.client,
        vaultId: ctx.vaultId,
        blobStore: this.opts.blobStore,
        scribeSettings: ctx.scribeSettings ?? null,
      });
      this.opts.onDrain?.(outcome);
      return outcome;
    } finally {
      this.draining = false;
    }
  }
}
