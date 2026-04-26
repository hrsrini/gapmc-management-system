import path from "path";
import { getUploadBlobStore, resolveLocalUploadsRoot } from "./object-storage";
import { contentTypeForVoucherAttachment } from "./voucher-attachment-storage";

export type DakAttachmentKind = "inward" | "outward";

export function dakBlobKey(kind: DakAttachmentKind, recordId: string, storedFileName: string): string {
  return `dak/${kind}/${recordId}/${path.basename(storedFileName)}`;
}

/** Legacy absolute path under `uploads/` (local layout matches blob key). */
export function dakAttachmentFilePath(kind: DakAttachmentKind, recordId: string, storedFileName: string): string {
  return path.join(resolveLocalUploadsRoot(), dakBlobKey(kind, recordId, storedFileName));
}

export async function writeDakAttachmentBuffer(
  kind: DakAttachmentKind,
  recordId: string,
  storedFileName: string,
  buffer: Buffer,
): Promise<void> {
  const key = dakBlobKey(kind, recordId, storedFileName);
  await getUploadBlobStore().put(key, buffer, contentTypeForVoucherAttachment(storedFileName));
}

export async function readDakAttachmentBuffer(
  kind: DakAttachmentKind,
  recordId: string,
  storedFileName: string,
): Promise<Buffer | null> {
  return getUploadBlobStore().get(dakBlobKey(kind, recordId, storedFileName));
}

export async function unlinkDakAttachmentIfExists(
  kind: DakAttachmentKind,
  recordId: string,
  storedFileName: string,
): Promise<void> {
  await getUploadBlobStore().del(dakBlobKey(kind, recordId, storedFileName));
}
