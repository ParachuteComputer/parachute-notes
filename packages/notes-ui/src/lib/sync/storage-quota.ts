// Thin wrapper around the StorageManager API. Browsers without it are treated
// as "unknown" — callers should surface that state rather than assume failure.

export interface QuotaReport {
  persisted: boolean;
  usage: number | null;
  quota: number | null;
  supported: boolean;
}

export async function requestPersistent(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isPersisted(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) return false;
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

export async function estimate(): Promise<QuotaReport> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return { persisted: false, usage: null, quota: null, supported: false };
  }
  try {
    const [persisted, est] = await Promise.all([isPersisted(), navigator.storage.estimate()]);
    return {
      persisted,
      usage: est.usage ?? null,
      quota: est.quota ?? null,
      supported: true,
    };
  } catch {
    return { persisted: false, usage: null, quota: null, supported: false };
  }
}
