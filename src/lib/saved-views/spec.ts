import type { Note } from "@/lib/vault/types";

// A saved view is a regular vault note with `kind: saved-view` in metadata.
// Storing filter state in the vault (rather than localStorage) means views
// follow you across devices and stay agent-readable. The conventional path
// is `UI/Views/<name>` and the role-tagged tag (default `view`) lets the
// list query filter cheaply.

export const VIEWS_PATH_PREFIX = "UI/Views/";
export const SAVED_VIEW_KIND = "saved-view";

export interface SavedViewFilters {
  search?: string;
  tags?: string[];
  tagMatch?: "any" | "all";
  pathPrefix?: string;
  sort?: "asc" | "desc";
  showArchived?: boolean;
}

export interface SavedView {
  id: string;
  name: string;
  filters: SavedViewFilters;
  description?: string;
}

// Build the canonical metadata blob the vault stores. Only emit fields
// that are actually set so a view note round-trips minimally.
export function encodeFiltersMetadata(filters: SavedViewFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (filters.search?.trim()) out.search = filters.search.trim();
  if (filters.tags && filters.tags.length > 0) out.tags = [...filters.tags];
  if (filters.tags && filters.tags.length > 1 && filters.tagMatch) out.tagMatch = filters.tagMatch;
  if (filters.pathPrefix?.trim()) out.pathPrefix = filters.pathPrefix.trim();
  if (filters.sort) out.sort = filters.sort;
  if (filters.showArchived) out.showArchived = true;
  return { kind: SAVED_VIEW_KIND, filters: out };
}

// Inverse: pull a typed SavedView out of a vault Note. Returns null when the
// note's metadata doesn't carry the saved-view shape.
export function decodeView(note: Note): SavedView | null {
  const meta = note.metadata as { kind?: unknown; filters?: unknown } | undefined;
  if (!meta || meta.kind !== SAVED_VIEW_KIND) return null;
  const f = (meta.filters ?? {}) as Record<string, unknown>;
  const name = nameFromPath(note.path) ?? note.id;
  return {
    id: note.id,
    name,
    filters: {
      search: typeof f.search === "string" ? f.search : undefined,
      tags: Array.isArray(f.tags)
        ? f.tags.filter((x): x is string => typeof x === "string")
        : undefined,
      tagMatch: f.tagMatch === "all" ? "all" : f.tagMatch === "any" ? "any" : undefined,
      pathPrefix: typeof f.pathPrefix === "string" ? f.pathPrefix : undefined,
      sort: f.sort === "asc" ? "asc" : f.sort === "desc" ? "desc" : undefined,
      showArchived: f.showArchived === true,
    },
  };
}

// Pull the bare display name from a `UI/Views/<name>` path. Strips the
// prefix and the trailing `.md` if the vault appended one.
export function nameFromPath(path: string | undefined): string | null {
  if (!path) return null;
  if (!path.startsWith(VIEWS_PATH_PREFIX)) return null;
  const rest = path.slice(VIEWS_PATH_PREFIX.length);
  return rest.replace(/\.md$/i, "") || null;
}

// Construct the path the vault will store the view under. Names are not
// allowed to contain slashes — that would create nested folders, which
// confuses the list query and the rename UI we don't have yet.
export function pathForName(name: string): string {
  const safe = name.trim().replace(/[/\\]/g, "-");
  return `${VIEWS_PATH_PREFIX}${safe}`;
}

// Encode the current filter state as URL search params for the /notes
// route. Same shape as buildNoteQueryParams except we also pass the
// non-server params (tagMatch always — even single tag — so applying a
// view round-trips exactly; show_archived; sort).
export function filtersToSearchParams(filters: SavedViewFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  for (const t of filters.tags ?? []) params.append("tag", t);
  if (filters.tagMatch) params.set("tag_match", filters.tagMatch);
  if (filters.pathPrefix?.trim()) params.set("path_prefix", filters.pathPrefix.trim());
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.showArchived) params.set("show_archived", "1");
  return params;
}

// Inverse: read URL search params (from /notes?...) into a filter spec so
// the route can hydrate its local state from the URL on mount.
export function searchParamsToFilters(params: URLSearchParams): SavedViewFilters {
  const tags = params.getAll("tag");
  const tagMatch = params.get("tag_match");
  const sort = params.get("sort");
  return {
    search: params.get("search") ?? undefined,
    tags: tags.length > 0 ? tags : undefined,
    tagMatch: tagMatch === "all" ? "all" : tagMatch === "any" ? "any" : undefined,
    pathPrefix: params.get("path_prefix") ?? undefined,
    sort: sort === "asc" ? "asc" : sort === "desc" ? "desc" : undefined,
    showArchived: params.get("show_archived") === "1",
  };
}

// True when at least one filter dimension is set. Used to gate the
// "Save view" button — saving an empty view is meaningless.
export function isFiltersNonEmpty(filters: SavedViewFilters): boolean {
  if (filters.search?.trim()) return true;
  if (filters.tags && filters.tags.length > 0) return true;
  if (filters.pathPrefix?.trim()) return true;
  return false;
}
