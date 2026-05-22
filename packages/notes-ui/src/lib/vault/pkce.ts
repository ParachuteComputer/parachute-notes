/**
 * PKCE primitives — re-exports from `@openparachute/app-client`.
 *
 * Phase 2 of the notes-migration-to-app arc (parachute-app#6, design doc
 * section 16) lifted the byte-for-byte identical implementation into
 * app-client so other hosted apps share it. Notes' callsites keep their
 * import path stable via this thin shim.
 */

export {
  InsecureContextError,
  deriveCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "@openparachute/app-client";
