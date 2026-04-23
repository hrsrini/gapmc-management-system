import path from "path";
import { getUploadBlobStore } from "./object-storage";

export function voucherBlobKey(voucherId: string, storedFileName: string): string {
  return `vouchers/${path.basename(voucherId)}/${path.basename(storedFileName)}`;
}

export function voucherAttachmentsDir(voucherId: string): string {
  return path.join(process.cwd(), "uploads", "vouchers", path.basename(voucherId));
}

export function voucherAttachmentFilePath(voucherId: string, storedFileName: string): string {
  return path.join(process.cwd(), "uploads", voucherBlobKey(voucherId, storedFileName));
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

export async function writeVoucherAttachmentBuffer(
  voucherId: string,
  storedFileName: string,
  buffer: Buffer,
): Promise<void> {
  await getUploadBlobStore().put(
    voucherBlobKey(voucherId, storedFileName),
    buffer,
    contentTypeForVoucherAttachment(storedFileName),
  );
}

export async function readVoucherAttachmentBuffer(
  voucherId: string,
  storedFileName: string,
): Promise<Buffer | null> {
  return getUploadBlobStore().get(voucherBlobKey(voucherId, storedFileName));
}

export async function unlinkVoucherAttachmentIfExists(voucherId: string, storedFileName: string): Promise<void> {
  await getUploadBlobStore().del(voucherBlobKey(voucherId, storedFileName));
}
