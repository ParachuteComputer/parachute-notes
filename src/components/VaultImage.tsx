import { useActiveVaultClient } from "@/lib/vault";
import { useEffect, useState } from "react";

interface Props {
  src: string;
  alt?: string;
  className?: string;
}

export function VaultImage({ src, alt, className }: Props) {
  const client = useActiveVaultClient();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needsAuth = isVaultStorageUrl(src);

  useEffect(() => {
    if (!needsAuth || !client) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setError(null);
    client
      .fetchAttachmentBlob(src)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load image");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [needsAuth, src, client]);

  if (error) {
    return (
      <span className="text-xs text-red-400">
        [{alt ?? "image"}: {error}]
      </span>
    );
  }
  const displaySrc = needsAuth ? blobUrl : src;
  if (needsAuth && !displaySrc) {
    return (
      <span
        className={`inline-block h-24 w-40 animate-pulse rounded bg-border/40 ${className ?? ""}`}
        aria-busy="true"
      />
    );
  }
  return <img src={displaySrc ?? undefined} alt={alt ?? ""} className={className} />;
}

function isVaultStorageUrl(src: string): boolean {
  return src.startsWith("/api/storage/") || /^https?:\/\/[^/]+\/api\/storage\//.test(src);
}
