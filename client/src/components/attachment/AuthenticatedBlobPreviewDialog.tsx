import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export type AuthenticatedBlobPreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Same-origin API path (e.g. `/api/.../download`). */
  fetchPath: string | null;
};

/**
 * Fetches a binary API response with credentials, shows PDF/image in a dialog, revokes blob URLs on close.
 */
export function AuthenticatedBlobPreviewDialog({
  open,
  onOpenChange,
  title,
  fetchPath,
}: AuthenticatedBlobPreviewDialogProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [mime, setMime] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const clearBlob = () => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setBlobUrl(null);
    setMime("");
    setError(null);
    setLoading(false);
  };

  useEffect(() => {
    if (!open || !fetchPath) {
      clearBlob();
      return;
    }

    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setBlobUrl(null);
    setMime("");

    (async () => {
      try {
        const res = await fetch(fetchPath, { credentials: "include", signal: ac.signal });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error ?? res.statusText);
        }
        const blob = await res.blob();
        if (cancelled) return;
        const u = URL.createObjectURL(blob);
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = u;
        setBlobUrl(u);
        setMime(blob.type || res.headers.get("content-type") || "");
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      ac.abort();
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [open, fetchPath]);

  const handleOpenChange = (next: boolean) => {
    if (!next) clearBlob();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl w-[min(95vw,56rem)] max-h-[90vh] flex flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle className="pr-8 truncate">{title || "Document"}</DialogTitle>
        </DialogHeader>
        <div className="min-h-[240px] max-h-[min(72vh,720px)] border-y bg-muted/20 overflow-auto flex items-center justify-center">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Loading preview…</p>
            </div>
          ) : null}
          {error && !loading ? <p className="text-destructive text-sm px-6 py-8 text-center">{error}</p> : null}
          {!loading && blobUrl ? (
            mime === "application/pdf" || mime.includes("pdf") ? (
              <iframe title="Document preview" src={blobUrl} className="w-full min-h-[65vh] border-0 bg-background" />
            ) : mime.startsWith("image/") ? (
              <img
                src={blobUrl}
                alt=""
                className="max-w-full max-h-[min(70vh,800px)] w-auto h-auto object-contain mx-auto block p-2"
              />
            ) : (
              <p className="text-sm text-muted-foreground px-6 py-8 text-center">
                Inline preview is not available for this file type. Open the download link instead.
              </p>
            )
          ) : null}
        </div>
        <DialogFooter className="px-6 py-4 shrink-0 border-t flex-row justify-end gap-2 sm:justify-end">
          {blobUrl ? (
            <Button variant="outline" asChild>
              <a href={blobUrl} download={title || "document"}>
                Save copy…
              </a>
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
