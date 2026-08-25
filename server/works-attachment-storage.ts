/**
 * M-08 Work Order / SD release letter attachment storage.
 */
import path from "path";
import { getUploadBlobStore } from "./object-storage";

export function worksDocBlobKey(workId: string, storedFileName: string): string {
  return `works/${path.basename(workId)}/docs/${path.basename(storedFileName)}`;
}

export function worksSdReleaseBlobKey(sdId: string, storedFileName: string): string {
  return `works/sd-pbg/${path.basename(sdId)}/${path.basename(storedFileName)}`;
}

export function isAllowedWorksAttachmentFileName(name: string): boolean {
  const base = path.basename(name);
  return base === name && /^[A-Za-z0-9_-]{8,32}\.(pdf|png|jpg|jpeg)$/i.test(base);
}

export function extFromWorksAttachmentMime(mime: string): ".pdf" | ".png" | ".jpg" | null {
  if (mime === "application/pdf") return ".pdf";
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  return null;
}

export function contentTypeForWorksAttachment(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

export async function writeWorksDocBuffer(workId: string, storedFileName: string, buffer: Buffer): Promise<void> {
  await getUploadBlobStore().put(
    worksDocBlobKey(workId, storedFileName),
    buffer,
    contentTypeForWorksAttachment(storedFileName),
  );
}

export async function readWorksDocBuffer(workId: string, storedFileName: string): Promise<Buffer | null> {
  return getUploadBlobStore().get(worksDocBlobKey(workId, storedFileName));
}

export async function unlinkWorksDocIfExists(workId: string, storedFileName: string): Promise<void> {
  await getUploadBlobStore().del(worksDocBlobKey(workId, storedFileName));
}

export async function writeSdReleaseLetterBuffer(sdId: string, storedFileName: string, buffer: Buffer): Promise<void> {
  await getUploadBlobStore().put(
    worksSdReleaseBlobKey(sdId, storedFileName),
    buffer,
    contentTypeForWorksAttachment(storedFileName),
  );
}

export async function readSdReleaseLetterBuffer(sdId: string, storedFileName: string): Promise<Buffer | null> {
  return getUploadBlobStore().get(worksSdReleaseBlobKey(sdId, storedFileName));
}
