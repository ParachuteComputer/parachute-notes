import type { VaultClient } from "./client";

// Client-orchestrated tag rename/merge.
//
// The vault HTTP API has no "rename tag" or "merge tags" endpoint — tags are
// inferred from notes, not first-class rows. So these helpers do the work from
// the client: query every note carrying the source tag, PATCH each note to
// swap tags, then drop the now-orphaned tag row.
//
// Trade-offs worth knowing at the call site:
//   - N+1 PATCHes. A vault with 500 notes tagged "work" makes 500 round trips.
//     Fine for a background-ish user action on an UI with a spinner; not fine
//     as a hot path.
//   - No atomicity. A failure halfway through leaves some notes retagged and
//     some not. Callers should surface partial results and let the user retry
//     — re-running the operation is idempotent because the remove delta is a
//     no-op on notes that no longer carry the source tag.
//   - Requires online. Callers must gate on navigator.onLine; there's no
//     offline queue for tag-level ops because partial progress on reconnect
//     would be even more confusing than a synchronous partial failure.

export interface TagMutationResult {
  total: number;
  succeeded: number;
  failed: Array<{ noteId: string; path?: string; error: string }>;
  sourceDeleted: boolean;
}

function normalize(name: string): string {
  return name.trim().replace(/^#/, "");
}

// Rename every occurrence of `oldName` to `newName`. If `newName` already
// exists on some notes, those notes end up with only one copy (tags are a
// set in the vault).
export async function renameTag(
  client: VaultClient,
  oldName: string,
  newName: string,
): Promise<TagMutationResult> {
  const source = normalize(oldName);
  const target = normalize(newName);
  if (!source) throw new Error("Source tag is empty.");
  if (!target) throw new Error("Target tag is empty.");
  if (source === target) throw new Error("Source and target tags are the same.");

  const params = new URLSearchParams({ tag: source, limit: "10000" });
  const notes = await client.queryNotes(params);

  const failed: TagMutationResult["failed"] = [];
  let succeeded = 0;
  for (const note of notes) {
    try {
      await client.updateNote(note.id, {
        tags: { add: [target], remove: [source] },
      });
      succeeded += 1;
    } catch (e) {
      failed.push({
        noteId: note.id,
        path: note.path,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  let sourceDeleted = false;
  if (failed.length === 0 && notes.length > 0) {
    try {
      await client.deleteTag(source);
      sourceDeleted = true;
    } catch {
      // Tag row drop is best-effort — the vault may have already pruned it
      // once the last note was retagged. Not worth surfacing as a failure.
    }
  }

  return { total: notes.length, succeeded, failed, sourceDeleted };
}

// Merge one or more source tags into a single target. Implemented as a
// sequence of renames so the semantics match exactly and partial failures
// are per-source.
export async function mergeTags(
  client: VaultClient,
  sources: string[],
  target: string,
): Promise<TagMutationResult[]> {
  const normTarget = normalize(target);
  if (!normTarget) throw new Error("Target tag is empty.");
  const normSources = sources.map(normalize).filter((s) => s && s !== normTarget);
  if (normSources.length === 0) throw new Error("No source tags to merge.");

  const results: TagMutationResult[] = [];
  for (const source of normSources) {
    results.push(await renameTag(client, source, normTarget));
  }
  return results;
}
