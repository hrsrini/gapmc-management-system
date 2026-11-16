import path from "path";
import { getUploadBlobStore } from "./object-storage";
import { extFromPdfUpload } from "./upload-pdf-mime";

const DIR = "leave-licence-agreements";

export function leaveLicenceAgreementBlobKey(agreementId: string, storedFileName: string): string {
  return `${DIR}/${path.basename(agreementId)}/${path.basename(storedFileName)}`;
}

export function extFromLeaveLicenceMime(mime: string, fileName?: string | null): string | null {
  return extFromPdfUpload(mime, fileName);
}

export function isAllowedLeaveLicencePdfFileName(fileName: string): boolean {
  return /^(draft|final|signed|cancel-order)-\d{10,}-[a-zA-Z0-9_-]{6,}\.pdf$/.test(String(fileName ?? ""));
}

export async function writeLeaveLicencePdfBuffer(
  agreementId: string,
  fileName: string,
  buf: Buffer,
): Promise<void> {
  await getUploadBlobStore().put(
    leaveLicenceAgreementBlobKey(agreementId, fileName),
    buf,
    "application/pdf",
  );
}

export async function readLeaveLicencePdfBuffer(
  agreementId: string,
  fileName: string,
): Promise<Buffer | null> {
  return getUploadBlobStore().get(leaveLicenceAgreementBlobKey(agreementId, fileName));
}
