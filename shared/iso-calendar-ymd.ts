/**
 * Normalize calendar dates for storage/API as YYYY-MM-DD.
 * HTML `<input type="date">` can emit years like 0026 when a 2-digit year is typed;
 * map 00–99 → 2000–2099 and reject out-of-range years.
 */

const YMD_RE = /^(\d{1,4})-(\d{2})-(\d{2})$/;

export function normalizeIsoCalendarYmd(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").trim().slice(0, 10);
  if (!t) return null;
  const m = YMD_RE.exec(t);
  if (!m) return null;
  let y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  // Chrome/Edge: typing "26" in the year field → 0026
  if (y >= 0 && y <= 99) y += 2000;
  if (y < 1990 || y > 2100) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const check = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(check.getTime())) return null;
  if (check.getUTCFullYear() !== y || check.getUTCMonth() + 1 !== mo || check.getUTCDate() !== d) return null;
  return iso;
}

/** For display helpers: coerce 00xx years to 20xx without rejecting. */
export function coerceTwoDigitYearInYmd(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(t.slice(0, 10) === t ? t : t.slice(0, 10));
  if (!m) return t;
  let y = Number(m[1]);
  if (y >= 0 && y <= 99) y += 2000;
  return `${String(y).padStart(4, "0")}-${m[2]}-${m[3]}`;
}
