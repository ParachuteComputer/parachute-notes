// Per-vault scribe configuration. Stored in localStorage keyed by vaultId.
// Empty/missing = transcription is disabled for that vault; memos still save,
// they just never get a transcript run.
export interface ScribeSettings {
  url: string;
  token?: string;
  // Whether to pass `cleanup=true` on transcription requests. Scribe runs an
  // LLM pass to fix filler words / punctuation. Costs extra on hosted setups,
  // so default off; users opt in per-vault.
  cleanup?: boolean;
}

export type ScribeErrorKind = "auth" | "unavailable" | "bad-request" | "parse";

export class ScribeError extends Error {
  readonly kind: ScribeErrorKind;
  readonly status?: number;
  constructor(kind: ScribeErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ScribeError";
    this.kind = kind;
    this.status = status;
  }
}
