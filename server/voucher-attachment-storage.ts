import fs from "fs";
import path from "path";

export function voucherAttachmentsDir(voucherId: string): string {
  return path.join(process.cwd(), "uploads", "vouchers", voucherId);
}

export function voucherAttachmentFilePath(voucherId: string, storedFileName: string): string {
  return path.join(voucherAttachmentsDir(voucherId), path.basename(storedFileName));
}

/** Stored names are `nanoid + ext`; reject path traversal and odd names. */
export function isAllowedVoucherAttachmentFileName(name: string): boolean {
  const base = path.basename(name);
  return base === name && /^[A-Za-z0-9_-]{8,32}\.(pdf|png|jpg|jpeg)$/i.test(base);
}

export function extFromVoucherAttachmentMime(mime: string): ".pdf" | ".png" | ".jpg" | null {
  if (mime === "application/pdf") return ".pdf";
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  return null;
}

export function contentTypeForVoucherAttachment(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

export function ensureVoucherAttachmentsDir(voucherId: string): void {
  fs.mkdirSync(voucherAttachmentsDir(voucherId), { recursive: true });
}

export function unlinkVoucherAttachmentIfExists(voucherId: string, storedFileName: string): void {
  const p = voucherAttachmentFilePath(voucherId, storedFileName);
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}
