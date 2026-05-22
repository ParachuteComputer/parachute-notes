// Fallback renderer: plain text in a monospace block. Used for unknown
// extensions and as a graceful-fallback target when a format-specific
// renderer can't parse its input. Reuses the `.prose-note pre` styling so
// the visual treatment matches markdown code blocks.

export function PlainRenderer({ content }: { content: string }) {
  return (
    <div className="prose-note">
      <pre>
        <code>{content}</code>
      </pre>
    </div>
  );
}
