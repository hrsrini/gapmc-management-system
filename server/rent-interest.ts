/**
 * M-03 rent arrears interest (simple daily): Outstanding × (R/100) ÷ 365 × days overdue.
 * Due date default: last calendar day of `rent_invoices.period_month` when it matches YYYY-MM.
 */
const MS_PER_DAY = 86_400_000;

/** Last day of month for `YYYY-MM` (UTC); null if not in that format. */
export function rentPeriodMonthEndIso(periodMonth: string): string | null {
  const t = String(periodMonth ?? "").trim();
  const m = /^(\d{4})-(\d{2})$/.exec(t);
  if (!m) return null;
  const y = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  const last = new Date(Date.UTC(y, mon, 0));
  return last.toISOString().slice(0, 10);
}

export function computeRentArrearsSimpleInterest(params: {
  principal: number;
  percentPerAnnum: number;
  dueDateIso: string;
  asOfDateIso: string;
}): { days: number; interest: number } {
  const { principal, percentPerAnnum, dueDateIso, asOfDateIso } = params;
  const due = Date.parse(`${dueDateIso}T00:00:00.000Z`);
  const asOf = Date.parse(`${asOfDateIso}T00:00:00.000Z`);
  if (!Number.isFinite(due) || !Number.isFinite(asOf) || principal <= 0 || percentPerAnnum < 0) {
    return { days: 0, interest: 0 };
  }
  const days = Math.max(0, Math.floor((asOf - due) / MS_PER_DAY));
  const raw = principal * (percentPerAnnum / 100) / 365 * days;
  const interest = Math.round(raw * 100) / 100;
  return { days, interest };
}
