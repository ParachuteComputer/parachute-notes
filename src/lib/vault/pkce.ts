/**
 * PKCE (RFC 7636) helpers for OAuth 2.1 with S256 code challenge.
 *
 * Pure browser crypto — no dependencies. All functions are async because
 * `crypto.subtle.digest` is async.
 *
 * ## Secure context requirement
 *
 * The Web Crypto API (`crypto.subtle`) is only available in secure
 * contexts per the W3C spec: HTTPS, `http://localhost`, or
 * `http://127.0.0.1`. A hub served at e.g. `http://192.168.1.10:1939`
 * over plain HTTP is **insecure** as far as the browser is concerned and
 * `crypto.subtle` will be `undefined` there. PKCE cannot be polyfilled
 * around that — Web Crypto is gated specifically to prevent untrusted
 * intermediaries from observing/mutating cryptographic operations.
 *
 * `deriveCodeChallenge` therefore throws `InsecureContextError` up front
 * with an actionable message instead of letting the call land on
 * `undefined.digest` and surface a cryptic `Cannot read properties of
 * undefined (reading 'digest')` to the user. The defensive check also
 * runs in `generateCodeVerifier` and `generateState` — those use
 * `crypto.getRandomValues` which is available in more contexts than
 * `crypto.subtle`, but a single failure mode at the start of the OAuth
 * flow is easier to recover from than a partial start.
 */

/**
 * Thrown when an OAuth/PKCE helper is invoked in a context where the
 * Web Crypto API isn't available (non-HTTPS, non-localhost). The
 * message is operator-facing and lists the concrete remediations
 * (HTTPS via Tailscale/Cloudflare/reverse proxy, or `http://localhost`
 * direct). Callers should catch this distinctly from generic Error so
 * the UI can render a specific, distinct banner — see
 * `AddVault.tsx` / `VaultPopover.tsx` / `VaultStatusBanner.tsx`.
 */
export class InsecureContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsecureContextError";
  }
}

const INSECURE_CONTEXT_MESSAGE =
  "OAuth requires a secure context (HTTPS or http://localhost). " +
  "This page is loaded in an insecure context — Web Crypto isn't available. " +
  "Reload via HTTPS (e.g. through Tailscale Serve, Cloudflare Tunnel, or a reverse proxy) " +
  "or access the hub at http://localhost directly.";

function assertWebCryptoDigest(): void {
  if (typeof crypto === "undefined" || !crypto.subtle?.digest) {
    throw new InsecureContextError(INSECURE_CONTEXT_MESSAGE);
  }
}

function assertWebCryptoRandom(): void {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new InsecureContextError(INSECURE_CONTEXT_MESSAGE);
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateCodeVerifier(bytes = 32): string {
  if (bytes < 32 || bytes > 96) {
    throw new Error("code_verifier entropy must be between 32 and 96 bytes");
  }
  assertWebCryptoRandom();
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

export async function deriveCodeChallenge(verifier: string): Promise<string> {
  assertWebCryptoDigest();
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(hash));
}

export function generateState(bytes = 16): string {
  assertWebCryptoRandom();
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}
