import path from "path";
import { getUploadBlobStore } from "./object-storage";

export function employeeDocumentBlobKey(employeeId: string, storedFileName: string): string {
  return `employees/${path.basename(employeeId)}/${path.basename(storedFileName)}`;
}

/** Stored names are `nanoid + ext`; reject path traversal and odd names. */
export function isAllowedEmployeeDocumentFileName(name: string): boolean {
  const base = path.basename(name);
  return base === name && /^[A-Za-z0-9_-]{8,32}\.(pdf|png|jpg|jpeg)$/i.test(base);
}

export function extFromEmployeeDocumentMime(mime: string): ".pdf" | ".png" | ".jpg" | null {
  if (mime === "application/pdf") return ".pdf";
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  return null;
}

export function contentTypeForEmployeeDocument(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

export async function writeEmployeeDocumentBuffer(
  employeeId: string,
  storedFileName: string,
  buffer: Buffer,
): Promise<void> {
  await getUploadBlobStore().put(
    employeeDocumentBlobKey(employeeId, storedFileName),
    buffer,
    contentTypeForEmployeeDocument(storedFileName),
  );
}

export async function readEmployeeDocumentBuffer(employeeId: string, storedFileName: string): Promise<Buffer | null> {
  return getUploadBlobStore().get(employeeDocumentBlobKey(employeeId, storedFileName));
}

export async function unlinkEmployeeDocumentIfExists(employeeId: string, storedFileName: string): Promise<void> {
  await getUploadBlobStore().del(employeeDocumentBlobKey(employeeId, storedFileName));
}

