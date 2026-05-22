export interface NoteQueryState {
  search: string;
  tags: string[];
  tagMatch: "any" | "all";
  pathPrefix: string;
  sort: "asc" | "desc";
  limit: number;
  offset: number;
  // `undefined` = don't constrain. `false` selects untagged / orphaned notes
  // (vault PR 5.5). We don't bother emitting `=true` because the default
  // selection already includes those notes.
  hasTags?: boolean;
  hasLinks?: boolean;
}

export const DEFAULT_PAGE_SIZE = 50;

export const DEFAULT_NOTE_QUERY: NoteQueryState = {
  search: "",
  tags: [],
  tagMatch: "any",
  pathPrefix: "",
  sort: "desc",
  limit: DEFAULT_PAGE_SIZE,
  offset: 0,
};

export function buildNoteQueryParams(state: NoteQueryState): URLSearchParams {
  const params = new URLSearchParams();
  const search = state.search.trim();
  if (search) params.set("search", search);

  if (state.tags.length > 0) {
    params.set("tag", state.tags.join(","));
    if (state.tags.length > 1) params.set("tag_match", state.tagMatch);
  }

  const prefix = state.pathPrefix.trim();
  if (prefix) params.set("path_prefix", prefix);

  if (state.hasTags === false) params.set("has_tags", "false");
  else if (state.hasTags === true) params.set("has_tags", "true");

  if (state.hasLinks === false) params.set("has_links", "false");
  else if (state.hasLinks === true) params.set("has_links", "true");

  params.set("sort", state.sort);
  params.set("limit", String(state.limit));
  if (state.offset > 0) params.set("offset", String(state.offset));

  return params;
}

export function isFilteringActive(state: NoteQueryState): boolean {
  return (
    state.search.trim().length > 0 || state.tags.length > 0 || state.pathPrefix.trim().length > 0
  );
}
