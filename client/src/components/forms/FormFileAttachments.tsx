import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Eye, Trash2, Upload, FileIcon, ImageIcon } from "lucide-react";

export interface FormFileAttachmentsProps {
  /** Controlled list of files (e.g. before submit). */
  files: File[];
  onChange: (files: File[]) => void;
  accept?: string;
  maxFiles?: number;
  /** Per-file max size in bytes (default 10 MB). */
  maxBytesPerFile?: number;
  label?: string;
  description?: string;
  disabled?: boolean;
}

function isImage(f: File) {
  return f.type.startsWith("image/");
}

export function FormFileAttachments({
  files,
  onChange,
  accept = "image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,.pdf,.txt",
  maxFiles = 5,
  maxBytesPerFile = 10 * 1024 * 1024,
  label = "Attachments",
  description,
  disabled = false,
}: FormFileAttachmentsProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f));
    setUrls(next);
    return () => {
      next.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [files]);

  const removeAt = useCallback(
    (index: number) => {
      const copy = files.filter((_, i) => i !== index);
      onChange(copy);
    },
    [files, onChange],
  );

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files;
    e.target.value = "";
    if (!picked?.length) return;
    const next: File[] = [...files];
    for (let i = 0; i < picked.length; i++) {
      if (next.length >= maxFiles) break;
      const f = picked[i]!;
      if (f.size > maxBytesPerFile) continue;
      next.push(f);
    }
    onChange(next);
  };

  const openInput = () => inputRef.current?.click();

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor={inputId}>{label}</Label>
        {description ? <p className="text-sm text-muted-foreground mt-1">{description}</p> : null}
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className="sr-only"
        accept={accept}
        multiple={maxFiles > 1}
        disabled={disabled}
        onChange={onPick}
      />

      {files.length > 0 ? (
        <ul className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}-${f.size}`}
              className="flex flex-wrap items-center gap-2 justify-between rounded-md border bg-background px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {isImage(f) ? (
                  <img src={urls[i] ?? ""} alt="" className="h-10 w-10 rounded object-cover border shrink-0" />
                ) : f.type === "application/pdf" ? (
                  <FileIcon className="h-10 w-10 text-red-600 shrink-0" />
                ) : (
                  <ImageIcon className="h-10 w-10 text-muted-foreground shrink-0" />
                )}
                <span className="truncate font-medium" title={f.name}>
                  {f.name}
                </span>
                <span className="text-muted-foreground shrink-0">({(f.size / 1024).toFixed(1)} KB)</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button type="button" variant="outline" size="sm" asChild disabled={disabled}>
                  <a href={urls[i]} target="_blank" rel="noreferrer">
                    <Eye className="h-4 w-4 mr-1" />
                    View
                  </a>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => removeAt(i)}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || files.length >= maxFiles}
          onClick={openInput}
        >
          <Upload className="h-4 w-4 mr-2" />
          {files.length === 0 ? "Choose file(s)" : "Add / replace (more files)"}
        </Button>
        {files.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange([])}>
            Clear all
          </Button>
        ) : null}
      </div>
      {files.length >= maxFiles ? (
        <p className="text-xs text-muted-foreground">Maximum {maxFiles} file(s).</p>
      ) : null}
    </div>
  );
}
