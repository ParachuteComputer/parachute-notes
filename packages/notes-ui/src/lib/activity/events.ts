import type { Note } from "@/lib/vault/types";

export type ActivityKind = "created" | "updated";

export interface ActivityEvent {
  id: string;
  noteId: string;
  noteName: string;
  kind: ActivityKind;
  at: string;
  preview?: string;
  tags?: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Vault PR 6 sets updated_at = created_at on insert, and a fast follow-up
// edit usually lands within a second of the insert. Treat anything within
// this gap as "same event" so a single capture doesn't show up as adjacent
// Created/Edited rows.
const UPDATE_THRESHOLD_MS = 5_000;

export function buildActivityEvents(
  notes: readonly Note[],
  windowDays = 30,
  now: Date = new Date(),
): ActivityEvent[] {
  const cutoff = now.getTime() - windowDays * DAY_MS;
  const events: ActivityEvent[] = [];
  for (const note of notes) {
    const noteName = note.path ?? note.id;
    const created = Date.parse(note.createdAt);
    if (Number.isFinite(created) && created >= cutoff) {
      events.push({
        id: `${note.id}:created`,
        noteId: note.id,
        noteName,
        kind: "created",
        at: note.createdAt,
        preview: note.preview,
        tags: note.tags,
      });
    }
    if (note.updatedAt) {
      const updated = Date.parse(note.updatedAt);
      if (
        Number.isFinite(updated) &&
        updated >= cutoff &&
        Number.isFinite(created) &&
        updated - created > UPDATE_THRESHOLD_MS
      ) {
        events.push({
          id: `${note.id}:updated`,
          noteId: note.id,
          noteName,
          kind: "updated",
          at: note.updatedAt,
          preview: note.preview,
          tags: note.tags,
        });
      }
    }
  }
  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return events;
}

export type Bucket = "today" | "yesterday" | "thisWeek" | "older";

export const BUCKET_ORDER: readonly Bucket[] = ["today", "yesterday", "thisWeek", "older"];

export const BUCKET_LABELS: Record<Bucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
  older: "Older",
};

// Local-time bucketing — same reasoning as src/lib/dates.ts. The "this week"
// window is days 2–6 ago; today/yesterday are handled separately so the
// labels never overlap.
export function bucketOf(at: string, now: Date = new Date()): Bucket | null {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  const today = startOfDay(now);
  const eventDay = startOfDay(new Date(t));
  const dayDelta = Math.round((today.getTime() - eventDay.getTime()) / DAY_MS);
  if (dayDelta < 0) return "today";
  if (dayDelta === 0) return "today";
  if (dayDelta === 1) return "yesterday";
  if (dayDelta < 7) return "thisWeek";
  return "older";
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function groupEventsByBucket(
  events: readonly ActivityEvent[],
  now: Date = new Date(),
): Record<Bucket, ActivityEvent[]> {
  const groups: Record<Bucket, ActivityEvent[]> = {
    today: [],
    yesterday: [],
    thisWeek: [],
    older: [],
  };
  for (const ev of events) {
    const b = bucketOf(ev.at, now);
    if (b) groups[b].push(ev);
  }
  return groups;
}
