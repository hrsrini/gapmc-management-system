import path from "path";
import { getUploadBlobStore } from "./object-storage";
import {
  contentTypeForVoucherAttachment,
  extFromVoucherAttachmentMime,
  isAllowedVoucherAttachmentFileName,
} from "./voucher-attachment-storage";

export function traderBmFormBlobKey(licenceId: string, storedFileName: string): string {
  return `trader-licences/${path.basename(licenceId)}/bm-form/${path.basename(storedFileName)}`;
}

export { isAllowedVoucherAttachmentFileName as isAllowedBmFormFileName, extFromVoucherAttachmentMime as extFromBmFormMime };

export function contentTypeForBmFormFile(fileName: string): string {
  return contentTypeForVoucherAttachment(fileName);
}

export async function writeTraderBmFormBuffer(licenceId: string, storedFileName: string, buffer: Buffer): Promise<void> {
  await getUploadBlobStore().put(
    traderBmFormBlobKey(licenceId, storedFileName),
    buffer,
    contentTypeForVoucherAttachment(storedFileName),
  );
}

export async function readTraderBmFormBuffer(licenceId: string, storedFileName: string): Promise<Buffer | null> {
  return getUploadBlobStore().get(traderBmFormBlobKey(licenceId, storedFileName));
}

export async function unlinkTraderBmFormIfExists(licenceId: string, storedFileName: string): Promise<void> {
  await getUploadBlobStore().del(traderBmFormBlobKey(licenceId, storedFileName));
}
