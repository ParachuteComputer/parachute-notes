// Pure derivation: a flat list of note paths → a folder tree. Notes with no
// path or whose path is just a filename (no slashes) don't contribute folder
// nodes — they're "loose" at the root and aren't part of the tree primitive.
//
// The auto-detection threshold gates whether the tree is worth showing: tag-
// flat vaults shouldn't see a near-empty tree taking sidebar space.

export interface PathTreeNode {
  /** Last segment, used as the display label. */
  name: string;
  /** Full prefix from the vault root, e.g. `Canon/Aaron`. Used for the
   *  `path_prefix` URL filter and as the React key. No trailing slash. */
  fullPath: string;
  /** Notes whose path starts with this folder, including descendants. */
  count: number;
  children: PathTreeNode[];
}

interface MutableNode extends PathTreeNode {
  childMap: Map<string, MutableNode>;
}

function makeNode(name: string, fullPath: string): MutableNode {
  return { name, fullPath, count: 0, children: [], childMap: new Map() };
}

// Split a path into folder segments, dropping the final filename so a note at
// `Canon/Aaron/draft.md` contributes the `Canon` and `Canon/Aaron` folders but
// not a leaf node for the file itself.
function folderSegments(path: string): string[] {
  const parts = path.split("/").filter((p) => p.length > 0);
  if (parts.length <= 1) return [];
  return parts.slice(0, -1);
}

export function buildPathTree(paths: Iterable<string | undefined>): PathTreeNode[] {
  const roots = new Map<string, MutableNode>();
  for (const raw of paths) {
    if (!raw) continue;
    const segments = folderSegments(raw);
    if (segments.length === 0) continue;

    let levelMap = roots;
    let prefix = "";
    for (const seg of segments) {
      prefix = prefix ? `${prefix}/${seg}` : seg;
      let node = levelMap.get(seg);
      if (!node) {
        node = makeNode(seg, prefix);
        levelMap.set(seg, node);
      }
      node.count += 1;
      levelMap = node.childMap;
    }
  }

  const sortNodes = (nodes: MutableNode[]): PathTreeNode[] =>
    nodes
      .map((n) => ({
        name: n.name,
        fullPath: n.fullPath,
        count: n.count,
        children: sortNodes([...n.childMap.values()]),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

  return sortNodes([...roots.values()]);
}

// Show the tree automatically when the vault has either ≥5 distinct top-level
// folders or ≥20 notes that live in any folder (multi-segment path). Below
// that, a tag-flat vault would just see a stub — better to hide it.
export const AUTO_TOP_LEVEL_MIN = 5;
export const AUTO_FOLDERED_NOTES_MIN = 20;

export function meetsAutoThreshold(paths: Iterable<string | undefined>): boolean {
  const topLevel = new Set<string>();
  let foldered = 0;
  for (const raw of paths) {
    if (!raw) continue;
    const segments = folderSegments(raw);
    if (segments.length === 0) continue;
    foldered += 1;
    topLevel.add(segments[0]!);
    if (topLevel.size >= AUTO_TOP_LEVEL_MIN || foldered >= AUTO_FOLDERED_NOTES_MIN) return true;
  }
  return false;
}
