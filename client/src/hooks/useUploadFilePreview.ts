import { useEffect, useMemo } from "react";

/**
 * Stable object URL for a local image or PDF (for upload dialogs). Revoked when `file` changes or on unmount.
 */
export function useUploadFilePreview(file: File | null): string | null {
  const url = useMemo(() => {
    if (!file) return null;
    if (file.type.startsWith("image/") || file.type === "application/pdf") {
      return URL.createObjectURL(file);
    }
    return null;
  }, [file]);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  return url;
}
