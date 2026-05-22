import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estimate, isPersisted, requestPersistent } from "./storage-quota";

interface FakeStorage {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
  estimate?: () => Promise<StorageEstimate>;
}

function withStorage<T>(storage: FakeStorage | undefined, fn: () => Promise<T>): Promise<T> {
  const desc = Object.getOwnPropertyDescriptor(navigator, "storage");
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: storage,
  });
  return fn().finally(() => {
    if (desc) Object.defineProperty(navigator, "storage", desc);
    else
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        value: undefined,
      });
  });
}

describe("storage-quota", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requestPersistent returns false when storage API is missing", async () => {
    await withStorage(undefined, async () => {
      expect(await requestPersistent()).toBe(false);
    });
  });

  it("requestPersistent returns the value persist() resolves to", async () => {
    await withStorage({ persist: async () => true }, async () => {
      expect(await requestPersistent()).toBe(true);
    });
    await withStorage({ persist: async () => false }, async () => {
      expect(await requestPersistent()).toBe(false);
    });
  });

  it("requestPersistent returns false when persist() throws", async () => {
    await withStorage(
      {
        persist: async () => {
          throw new Error("boom");
        },
      },
      async () => {
        expect(await requestPersistent()).toBe(false);
      },
    );
  });

  it("isPersisted is false when missing; passes through otherwise", async () => {
    await withStorage(undefined, async () => {
      expect(await isPersisted()).toBe(false);
    });
    await withStorage({ persisted: async () => true }, async () => {
      expect(await isPersisted()).toBe(true);
    });
  });

  it("estimate reports supported:false when API is missing", async () => {
    await withStorage(undefined, async () => {
      const r = await estimate();
      expect(r).toEqual({ persisted: false, usage: null, quota: null, supported: false });
    });
  });

  it("estimate reports usage + quota when API present", async () => {
    await withStorage(
      {
        persisted: async () => true,
        estimate: async () => ({ usage: 123, quota: 1_000 }) as StorageEstimate,
      },
      async () => {
        const r = await estimate();
        expect(r).toEqual({ persisted: true, usage: 123, quota: 1_000, supported: true });
      },
    );
  });
});
