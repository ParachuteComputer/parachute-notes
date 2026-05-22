import { CodeRenderer } from "./CodeRenderer";

// YAML is just highlighted code — there's no equivalent of JSON.parse to
// pretty-print, and re-emitting via a YAML library would be a real
// dependency and a real source of surprises (anchors, key ordering, comment
// stripping). Render the bytes as-authored with highlight.js coloring.

export function YamlRenderer({ content }: { content: string }) {
  return <CodeRenderer content={content} language="yaml" />;
}
