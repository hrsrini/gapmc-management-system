import { formatInr } from "@/lib/formatInr";
import {
  AGREEMENT_RENEWAL_STATUS_LABELS,
  type AgreementRenewalStatus,
  isRentRevisionDueForPeriod,
} from "@shared/premises-agreement";

/** Display YYYY-MM-DD as DD-MM-YYYY. */
export function ymdToDmy(ymd: string | null | undefined): string {
  const s = String(ymd ?? "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s || "—";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function renewalStatusBadgeClass(status: string): string {
  switch (status) {
    case "Active":
      return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20";
    case "RenewalDue":
    case "NoticeGenerated":
      return "bg-sky-500/10 text-sky-700 border-sky-500/20";
    case "RenewalInitiated":
    case "RenewalPending":
    case "RentRevisionPending":
      return "bg-amber-500/10 text-amber-800 border-amber-500/30";
    case "Expired":
    case "PenaltyApplicable":
      return "bg-destructive/10 text-destructive border-destructive/20";
    case "Renewed":
      return "bg-violet-500/10 text-violet-700 border-violet-500/20";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function renewalStatusLabel(status: string): string {
  return (
    AGREEMENT_RENEWAL_STATUS_LABELS[status as AgreementRenewalStatus] ?? status
  );
}

export function renewalStatusSubtext(args: {
  status: string;
  daysToExpiry: number | null;
  toDate: string;
}): string {
  const days = args.daysToExpiry;
  if (args.status === "Active" && days != null && days > 60) {
    const open = new Date(args.toDate);
    if (!Number.isNaN(open.getTime())) {
      open.setUTCDate(open.getUTCDate() - 60);
      return `Renewal opens ${ymdToDmy(open.toISOString().slice(0, 10))}`;
    }
  }
  if (args.status === "RenewalDue" && days != null) return `Expires in ${days} days`;
  if ((args.status === "Expired" || args.status === "PenaltyApplicable") && days != null && days < 0) {
    return `Delay ${Math.abs(days)} days — penalty to verify`;
  }
  if (args.status === "RentRevisionPending") return "Renewal initiated — approval pending";
  if (args.status === "NoticeGenerated") return "Notice generated";
  if (args.status === "RenewalInitiated" || args.status === "RenewalPending") return "Continue renewal";
  return "";
}

export function periodNeedsRevision(period: number, frequency: number): boolean {
  return isRentRevisionDueForPeriod(period + 1, frequency);
}

export function formatRentDeposit(rent: number, deposit: number): string {
  return `${formatInr(rent)} / ${formatInr(deposit)}`;
}

export function premisesAreaNumber(area: number | string | null | undefined): number {
  if (typeof area === "number") return area;
  const n = Number(String(area ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
