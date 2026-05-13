/** PDFKit built-in fonts use WinAnsi; rupee, smart quotes, em dash, and non-Latin1 glyphs often throw at render time. */
export function pdfSafeText(s: string): string {
  let t = String(s ?? "")
    .replace(/\u20b9/g, "Rs.")
    .replace(/\u2014/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2019/g, "'")
    .replace(/\u2018/g, "'")
    .replace(/\u201c/g, '"')
    .replace(/\u201d/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ");
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    const code = c.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7e) out += c;
    else if (code === 0x0a || code === 0x0d) out += c;
    else out += "?";
  }
  return out;
}
