import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InsecureContextError,
  deriveCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "./pkce";

describe("generateCodeVerifier", () => {
  it("produces URL-safe base64 of reasonable length", () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(v.length).toBeGreaterThanOrEqual(43);
  });

  it("is non-deterministic across calls", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });

  it("rejects out-of-range entropy", () => {
    expect(() => generateCodeVerifier(16)).toThrow();
    expect(() => generateCodeVerifier(128)).toThrow();
  });
});

describe("deriveCodeChallenge (S256)", () => {
  it("matches the RFC 7636 test vector", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(await deriveCodeChallenge(verifier)).toBe(expected);
  });

  it("is deterministic for the same verifier", async () => {
    const verifier = generateCodeVerifier();
    expect(await deriveCodeChallenge(verifier)).toBe(await deriveCodeChallenge(verifier));
  });
});

describe("generateState", () => {
  it("produces a URL-safe random string", () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

// Insecure-context handling — when the browser doesn't expose
// `crypto.subtle` (HTTP page on a non-loopback origin, per the W3C
// secure-context spec), PKCE helpers throw `InsecureContextError`
// instead of letting `crypto.subtle.digest` blow up with
// "Cannot read properties of undefined (reading 'digest')". That
// cryptic message is what Aaron hit on fresh-install testing; this
// suite pins the actionable replacement.
describe("PKCE helpers in an insecure context", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("InsecureContextError is exported so callers can catch it distinctly", () => {
    const err = new InsecureContextError("nope");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InsecureContextError");
  });

  it("deriveCodeChallenge throws InsecureContextError when crypto.subtle is undefined", async () => {
    vi.stubGlobal("crypto", {
      // Random still works in worker / insecure contexts; only subtle is gated.
      getRandomValues: <T extends ArrayBufferView | null>(buf: T): T => buf,
    });
    await expect(deriveCodeChallenge("anything")).rejects.toBeInstanceOf(InsecureContextError);
    await expect(deriveCodeChallenge("anything")).rejects.toThrow(/secure context/i);
    await expect(deriveCodeChallenge("anything")).rejects.toThrow(/HTTPS or http:\/\/localhost/i);
  });

  it("deriveCodeChallenge throws InsecureContextError when crypto.subtle exists but lacks digest", async () => {
    vi.stubGlobal("crypto", {
      subtle: {},
      getRandomValues: <T extends ArrayBufferView | null>(buf: T): T => buf,
    });
    await expect(deriveCodeChallenge("anything")).rejects.toBeInstanceOf(InsecureContextError);
  });

  it("generateCodeVerifier throws InsecureContextError when crypto.getRandomValues is missing", () => {
    vi.stubGlobal("crypto", {});
    expect(() => generateCodeVerifier()).toThrow(InsecureContextError);
  });

  it("generateState throws InsecureContextError when crypto.getRandomValues is missing", () => {
    vi.stubGlobal("crypto", {});
    expect(() => generateState()).toThrow(InsecureContextError);
  });

  it("deriveCodeChallenge works normally when crypto.subtle.digest is available", async () => {
    // No stub — uses the real Web Crypto provided by the test environment.
    // Re-asserts the RFC 7636 vector to prove the defensive check is a
    // pure pass-through when the secure context is present.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(await deriveCodeChallenge(verifier)).toBe(expected);
  });
});
