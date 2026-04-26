/** Build a `FileList` for APIs that expect `FileList` / multipart from staged `File[]`. */
export function filesToFileList(files: File[]): FileList {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  return dt.files;
}
