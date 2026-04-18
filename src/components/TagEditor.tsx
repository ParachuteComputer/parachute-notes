interface Props {
  tags: string[];
  input: string;
  onInputChange(v: string): void;
  onAdd(raw: string): void;
  onRemove(name: string): void;
}

export function TagEditor({ tags, input, onInputChange, onAdd, onRemove }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="shrink-0 text-xs uppercase tracking-wider text-fg-dim">Tags</span>
      {tags.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-bg/60 px-2 py-0.5 text-xs text-fg-muted"
        >
          {t}
          <button
            type="button"
            onClick={() => onRemove(t)}
            aria-label={`Remove tag ${t}`}
            className="text-fg-dim hover:text-red-400"
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            onAdd(input);
          } else if (e.key === "Backspace" && input === "" && tags.length > 0) {
            onRemove(tags[tags.length - 1]!);
          }
        }}
        onBlur={() => {
          if (input.trim()) onAdd(input);
        }}
        placeholder="add tag…"
        className="min-w-24 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-fg focus:border-border focus:outline-none"
        aria-label="Add tag"
      />
    </div>
  );
}

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#/, "");
}
