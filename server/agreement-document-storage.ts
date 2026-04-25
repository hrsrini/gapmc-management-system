import path from "path";
import { getUploadBlobStore } from "./object-storage";

export function agreementDocumentBlobKey(agreementId: string, storedFileName: string): string {
  return `agreements/${path.basename(agreementId)}/${path.basename(storedFileName)}`;
}

/** Stored names are `nanoid + ext`; reject path traversal and odd names. */
export function isAllowedAgreementDocumentFileName(name: string): boolean {
  const base = path.basename(name);
  return base === name && /^[A-Za-z0-9_-]{8,32}\.(pdf|png|jpg|jpeg)$/i.test(base);
}

export function extFromAgreementDocumentMime(mime: string): ".pdf" | ".png" | ".jpg" | null {
  if (mime === "application/pdf") return ".pdf";
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  return null;
}

export function contentTypeForAgreementDocument(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

export async function writeAgreementDocumentBuffer(
  agreementId: string,
  storedFileName: string,
  buffer: Buffer,
): Promise<void> {
  await getUploadBlobStore().put(
    agreementDocumentBlobKey(agreementId, storedFileName),
    buffer,
    contentTypeForAgreementDocument(storedFileName),
  );
}

export async function readAgreementDocumentBuffer(agreementId: string, storedFileName: string): Promise<Buffer | null> {
  return getUploadBlobStore().get(agreementDocumentBlobKey(agreementId, storedFileName));
}

