import { useMemo } from "react";
import { CodeRenderer } from "./CodeRenderer";
import { PlainRenderer } from "./PlainRenderer";

// Pretty-print + syntax-highlight a JSON note. Shipping the code-view variant
// (not the tree-view) per the Phase 2 brief — simpler to ship, no
// expand/collapse state, and lines up with the YAML + code paths.
//
// On invalid JSON we fall back to the plain renderer so the user still sees
// their bytes. We don't reformat the original string in that case — the
// authors's spacing/indentation is signal too.

export function JsonRenderer({ content }: { content: string }) {
  const pretty = useMemo(() => {
    try {
      const parsed = JSON.parse(content);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return null;
    }
  }, [content]);

  if (pretty === null) {
    return <PlainRenderer content={content} />;
  }
  return <CodeRenderer content={pretty} language="json" />;
}
