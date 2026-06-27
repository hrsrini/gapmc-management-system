import path from "path";
import { getUploadBlobStore } from "./object-storage";
import { extFromPdfUpload } from "./upload-pdf-mime";

export function entityAllotmentAgreementBlobKey(entityAllotmentId: string, storedFileName: string): string {
  return `entity-allotments/${path.basename(entityAllotmentId)}/${path.basename(storedFileName)}`;
}

/** Notarised agreement: PDF only (US-M02-003). */
export function extFromEntityAllotmentAgreementMime(mime: string, fileName?: string | null): ".pdf" | null {
  return extFromPdfUpload(mime, fileName);
}

export function isAllowedEntityAllotmentAgreementFileName(name: string): boolean {
  return /^agreement-\d{10,}-[a-z0-9_-]+\.pdf$/i.test(String(name ?? "").trim());
}

export function contentTypeForEntityAllotmentAgreement(fileName: string): string {
  return String(fileName).toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream";
}

export async function writeEntityAllotmentAgreementBuffer(
  entityAllotmentId: string,
  storedFileName: string,
  buffer: Buffer,
): Promise<void> {
  await getUploadBlobStore().put(
    entityAllotmentAgreementBlobKey(entityAllotmentId, storedFileName),
    buffer,
    contentTypeForEntityAllotmentAgreement(storedFileName),
  );
}

export async function readEntityAllotmentAgreementBuffer(
  entityAllotmentId: string,
  storedFileName: string,
): Promise<Buffer | null> {
  return getUploadBlobStore().get(entityAllotmentAgreementBlobKey(entityAllotmentId, storedFileName));
}
