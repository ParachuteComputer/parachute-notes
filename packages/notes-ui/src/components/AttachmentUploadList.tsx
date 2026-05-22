import type { UploadEntry } from "./useAttachmentUploader";

interface Props {
  uploads: UploadEntry[];
  onCancel(id: string): void;
  onDismiss(id: string): void;
}

export function AttachmentUploadList({ uploads, onCancel, onDismiss }: Props) {
  if (uploads.length === 0) return null;
  return (
    <ul className="space-y-2">
      {uploads.map((u) => (
        <li
          key={u.id}
          className="rounded-md border border-border bg-card/60 px-3 py-2 text-xs text-fg-muted"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono" title={u.filename}>
              {u.filename}
            </span>
            <span className="shrink-0">{label(u)}</span>
          </div>
          {u.status === "uploading" ? (
            <div className="mt-1 h-1 w-full overflow-hidden rounded bg-border/40">
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${progressPct(u)}%` }}
              />
            </div>
          ) : null}
          {u.status === "error" && u.error ? <p className="mt-1 text-red-400">{u.error}</p> : null}
          <div className="mt-1 flex justify-end gap-2 text-xs">
            {u.status === "uploading" || u.status === "linking" ? (
              <button
                type="button"
                onClick={() => onCancel(u.id)}
                className="text-fg-dim hover:text-fg"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onDismiss(u.id)}
                className="text-fg-dim hover:text-fg"
              >
                Dismiss
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function progressPct(u: UploadEntry): number {
  if (u.size === 0) return 0;
  return Math.min(100, Math.round((u.loaded / u.size) * 100));
}

function label(u: UploadEntry): string {
  switch (u.status) {
    case "uploading":
      return `${progressPct(u)}%`;
    case "linking":
      return "Linking…";
    case "done":
      return "Done";
    case "cancelled":
      return "Cancelled";
    case "error":
      return "Error";
  }
}
