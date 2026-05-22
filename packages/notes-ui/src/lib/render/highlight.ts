// Singleton highlight.js instance used by the non-markdown renderers
// (CodeRenderer, JsonRenderer, YamlRenderer).
//
// We use the `core` build and register only the languages we actually need;
// the `common` build adds ~35 KB of languages we never reach for in the Notes
// PWA. The markdown path keeps using `rehype-highlight`, which has its own
// bundled language set — that's a separate concern.

import hljsCore from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";

let registered = false;

function ensureRegistered(): typeof hljsCore {
  if (registered) return hljsCore;
  hljsCore.registerLanguage("typescript", typescript);
  hljsCore.registerLanguage("javascript", javascript);
  hljsCore.registerLanguage("python", python);
  hljsCore.registerLanguage("rust", rust);
  hljsCore.registerLanguage("go", go);
  hljsCore.registerLanguage("bash", bash);
  hljsCore.registerLanguage("json", json);
  hljsCore.registerLanguage("yaml", yaml);
  registered = true;
  return hljsCore;
}

// Highlight `code` as `language`. Falls back to the empty string when the
// language isn't registered — the renderer will then emit unstyled `<pre>`
// text, which is still readable.
export function highlightAs(code: string, language: string): string {
  const hljs = ensureRegistered();
  if (!hljs.getLanguage(language)) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

// Complete for both content (`<code>…</code>`) and attribute (`="…"`)
// contexts. Current callers only use the content form, but the generic
// name invites future attribute-context use — escape both quote chars
// up front so a future caller doesn't reintroduce an XSS surface.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
