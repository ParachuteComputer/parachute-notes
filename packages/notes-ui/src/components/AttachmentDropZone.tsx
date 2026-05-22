import { type ReactNode, useCallback, useRef, useState } from "react";

interface Props {
  onDropFiles: (files: File[]) => void;
  children: ReactNode;
  className?: string;
  hint?: ReactNode;
}

export function AttachmentDropZone({ onDropFiles, children, className, hint }: Props) {
  const [over, setOver] = useState(false);
  // Track nested dragenter/leave depth so child elements don't flicker the overlay.
  const depthRef = useRef(0);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    depthRef.current += 1;
    setOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setOver(false);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      setOver(false);
      depthRef.current = 0;
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onDropFiles(files);
    },
    [onDropFiles],
  );

  return (
    <div
      className={`relative ${className ?? ""}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {children}
      {over ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md border-2 border-dashed border-accent bg-accent/10 text-sm text-accent"
        >
          <div className="rounded-md bg-bg/80 px-4 py-2 font-medium shadow">
            Drop to attach{hint ? <span className="ml-2 text-fg-dim">— {hint}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function hasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const types = dt.types;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === "Files") return true;
  }
  return false;
}
