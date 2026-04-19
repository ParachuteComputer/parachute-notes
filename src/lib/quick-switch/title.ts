import type { Note, NoteSummary } from "@/lib/vault/types";

// Extracts a human-readable title for a note. Prefers the first non-empty
// line of content (stripped of markdown heading `#`s), falling back to the
// last segment of the path without a `.md` suffix, then the id. Matches the
// label the vault UI uses in list views.
export function noteTitle(note: Pick<Note, "id" | "path" | "content"> | NoteSummary): string {
  const content = (note as { content?: string }).content;
  if (typeof content === "string") {
    for (const line of content.split("\n")) {
      const trimmed = line.trim().replace(/^#+\s*/, "");
      if (trimmed.length > 0) return trimmed;
    }
  }
  if (note.path) {
    const segments = note.path.split("/");
    const last = segments[segments.length - 1] ?? note.path;
    return last.replace(/\.md$/i, "");
  }
  return note.id;
}
