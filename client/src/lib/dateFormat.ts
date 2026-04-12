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

/** User-facing calendar date (DD-MM-YYYY). */
export function formatDisplayDate(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return typeof d === 'string' ? d : '';
  return format(dt, 'dd-MM-yyyy');
}

/** User-facing date-time (DD-MM-YYYY HH:mm, 24h). */
export function formatDisplayDateTime(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return typeof d === 'string' ? d : '';
  return format(dt, 'dd-MM-yyyy HH:mm');
}

/** Format ISO-like API strings for tables (date vs date-time). */
export function formatIsoLikeForDisplay(iso: string): string {
  const t = String(iso).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return t;
  const hasTime = t.includes('T') || t.length > 10;
  return hasTime ? formatDisplayDateTime(t) : formatDisplayDate(t);
}

/**
 * API calendar date as YYYY-MM-DD → DD-MM-YYYY without `Date` parsing (avoids timezone shifts).
 */
export function formatYmdToDisplay(ymd: string | null | undefined): string {
  if (ymd == null || String(ymd).trim() === '') return '—';
  const part = String(ymd).trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(part);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return formatIsoLikeForDisplay(String(ymd));
}

/**
 * Billing / period month YYYY-MM → first day shown as DD-MM-YYYY (e.g. 2024-06 → 01-06-2024).
 */
export function formatYearMonthToDisplay(ym: string | null | undefined): string {
  if (ym == null || String(ym).trim() === '') return '—';
  const part = String(ym).trim().slice(0, 7);
  const m = /^(\d{4})-(\d{2})$/.exec(part);
  if (m) return `01-${m[2]}-${m[1]}`;
  return part;
}

/** Date-only YYYY-MM-DD or ISO date-time string for detail views. */
export function formatApiDateOrDateTime(value: string | null | undefined): string {
  if (value == null || String(value).trim() === '') return '—';
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) && !s.includes('T') && s.length <= 10) {
    return formatYmdToDisplay(s);
  }
  return formatIsoLikeForDisplay(s);
}
