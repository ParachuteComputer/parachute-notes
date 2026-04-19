export { scribeHealth, transcribeAudio } from "./client";
export type { HealthOptions, TranscribeOptions, TranscribeResult } from "./client";
export {
  deleteScribeSettings,
  loadScribeSettings,
  saveScribeSettings,
  useScribeSettings,
} from "./settings";
export { ScribeError } from "./types";
export type { ScribeErrorKind, ScribeSettings } from "./types";
