// Required tag schema Notes ensures exists on the active vault. First instance
// of patterns#57 (surface-declares-required-schema). Aaron's framing: every
// note in a vault IS a note, so `#note` is tautological. `#capture`
// distinguishes notes-the-user-captured from imported / generated / derived
// ones — that's a real semantic axis.
//
// The hierarchy uses vault's `parent_names` column (parachute-vault
// core/src/tag-hierarchy.ts): a query for `tag: "capture"` auto-expands to
// notes tagged `capture/text` or `capture/voice`. Future extensions
// (`capture/photo`, `capture/web-clip`) slot in without rename.
//
// Notes "ensures" this schema — doesn't force-migrate the user's stored Tag
// Role *values*. If a user has `captureText = "quick"` from rc.6, that stays.
// The ensure call only writes the tag-identity rows; the per-vault setting
// for which tag to apply on capture is the operator's choice.

export interface RequiredTagDecl {
  name: string;
  description: string;
  parent_names?: string[];
}

export interface RequiredSchema {
  tags: readonly RequiredTagDecl[];
}

export const NOTES_REQUIRED_SCHEMA: RequiredSchema = {
  tags: [
    {
      name: "capture",
      description: "Notes captured directly by the user (text or voice).",
    },
    {
      name: "capture/text",
      parent_names: ["capture"],
      description: "Text capture.",
    },
    {
      name: "capture/voice",
      parent_names: ["capture"],
      description: "Voice capture.",
    },
  ],
};
