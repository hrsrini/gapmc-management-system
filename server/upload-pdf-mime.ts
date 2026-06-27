/** Accept common PDF MIME variants and `.pdf` filename when browsers send octet-stream. */
export function extFromPdfUpload(mime: string, fileName?: string | null): ".pdf" | null {
  const m = String(mime ?? "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  if (
    m === "application/pdf" ||
    m === "application/x-pdf" ||
    m === "application/acrobat" ||
    m === "applications/pdf"
  ) {
    return ".pdf";
  }
  const fn = String(fileName ?? "")
    .trim()
    .toLowerCase();
  if (fn.endsWith(".pdf") && (!m || m === "application/octet-stream" || m === "binary/octet-stream")) {
    return ".pdf";
  }
  return null;
}
