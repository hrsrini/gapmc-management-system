import path from "path";
import { getUploadBlobStore } from "./object-storage";
import { extFromPdfUpload } from "./upload-pdf-mime";

const DIR = "asset-allotment-agreements";

export function assetAllotmentAgreementBlobKey(allotmentId: string, storedFileName: string): string {
  return `${DIR}/${path.basename(allotmentId)}/${path.basename(storedFileName)}`;
}

export function extFromAssetAllotmentAgreementMime(mime: string, fileName?: string | null): string | null {
  return extFromPdfUpload(mime, fileName);
}

export function isAllowedAssetAllotmentAgreementFileName(fileName: string): boolean {
  return /^agreement-\d{10,}-[a-zA-Z0-9_-]{6,}\.pdf$/.test(String(fileName ?? ""));
}

export function contentTypeForAssetAllotmentAgreement(_fileName: string): string {
  return "application/pdf";
}

export async function writeAssetAllotmentAgreementBuffer(
  allotmentId: string,
  fileName: string,
  buf: Buffer,
): Promise<void> {
  await getUploadBlobStore().put(
    assetAllotmentAgreementBlobKey(allotmentId, fileName),
    buf,
    contentTypeForAssetAllotmentAgreement(fileName),
  );
}

export async function readAssetAllotmentAgreementBuffer(allotmentId: string, fileName: string): Promise<Buffer | null> {
  return getUploadBlobStore().get(assetAllotmentAgreementBlobKey(allotmentId, fileName));
}
