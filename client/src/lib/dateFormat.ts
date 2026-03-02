/**
 * Lightweight date formatting (replaces date-fns format in client to avoid bundling issues).
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number, len = 2) {
  return String(n).padStart(len, '0');
}

export function format(d: Date, pattern: string): string {
  const y = d.getFullYear();
  const M = d.getMonth();
  const d_ = d.getDate();
  const H = d.getHours();
  const m = d.getMinutes();

  // Replace quoted literals with a placeholder, then restore after token replace
  const literals: string[] = [];
  let s = pattern.replace(/'([^']*)'/g, (_, lit) => {
    literals.push(lit);
    return `\x00${literals.length - 1}\x00`;
  });

  s = s
    .replace(/yyyy/g, String(y))
    .replace(/MMM/g, MONTHS[M])
    .replace(/\bMM\b/g, pad(M + 1))
    .replace(/\bdd\b/g, pad(d_))
    .replace(/HH/g, pad(H))
    .replace(/mm/g, pad(m));

  literals.forEach((lit, i) => {
    s = s.replace(`\x00${i}\x00`, lit);
  });
  return s;
}
