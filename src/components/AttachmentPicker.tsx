import { useRef } from "react";

interface Props {
  onPickFiles: (files: File[]) => void;
  label?: string;
  className?: string;
}

const ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,audio/wav,audio/mpeg,audio/mp4,audio/ogg,audio/webm,video/webm,.wav,.mp3,.m4a,.ogg,.webm,.png,.jpg,.jpeg,.gif,.webp";

export function AttachmentPicker({ onPickFiles, label = "Attach files…", className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={
          className ??
          "min-h-11 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-fg-muted hover:text-accent"
        }
        title="Upload an attachment"
      >
        {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onPickFiles(files);
          e.target.value = "";
        }}
      />
    </>
  );
}
