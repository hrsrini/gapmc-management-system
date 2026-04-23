/** Inclusive calendar days between ISO date strings YYYY-MM-DD (UTC). */
export function inclusiveCalendarDays(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map((x) => Number(x));
  const [ty, tm, td] = toIso.split("-").map((x) => Number(x));
  if (![fy, fm, fd, ty, tm, td].every((n) => Number.isFinite(n))) return 0;
  const d0 = Date.UTC(fy, fm - 1, fd);
  const d1 = Date.UTC(ty, tm - 1, td);
  if (d1 < d0) return 0;
  return Math.round((d1 - d0) / 86400000) + 1;
}
