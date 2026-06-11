import path from "path";
import { getUploadBlobStore } from "./object-storage";

export function bugAttachmentBlobKey(storedFileName: string): string {
  return `bugs/${path.basename(storedFileName)}`;
}

export async function writeBugAttachmentBuffer(storedFileName: string, buffer: Buffer, contentType: string): Promise<void> {
  await getUploadBlobStore().put(bugAttachmentBlobKey(storedFileName), buffer, contentType);
}

export async function readBugAttachmentBuffer(storedFileName: string): Promise<Buffer | null> {
  return getUploadBlobStore().get(bugAttachmentBlobKey(storedFileName));
}
