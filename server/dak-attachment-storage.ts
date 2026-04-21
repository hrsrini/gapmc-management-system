import fs from "fs";
import path from "path";

export type DakAttachmentKind = "inward" | "outward";

export function dakAttachmentsDir(kind: DakAttachmentKind, recordId: string): string {
  return path.join(process.cwd(), "uploads", "dak", kind, recordId);
}

export function dakAttachmentFilePath(kind: DakAttachmentKind, recordId: string, storedFileName: string): string {
  return path.join(dakAttachmentsDir(kind, recordId), path.basename(storedFileName));
}

export function ensureDakAttachmentsDir(kind: DakAttachmentKind, recordId: string): void {
  fs.mkdirSync(dakAttachmentsDir(kind, recordId), { recursive: true });
}

export function unlinkDakAttachmentIfExists(kind: DakAttachmentKind, recordId: string, storedFileName: string): void {
  const p = dakAttachmentFilePath(kind, recordId, storedFileName);
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}
