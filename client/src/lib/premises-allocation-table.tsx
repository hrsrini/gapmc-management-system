import type { ReactNode } from "react";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import { formatInr } from "@/lib/formatInr";

/** Shared Premises allocations grid for Track A (trader licence) and Track B (entity). */
export const PREMISES_ALLOCATION_COLUMNS: ReportTableColumn[] = [
  { key: "assetDisplay", header: "Premises" },
  { key: "allotteeName", header: "Allottee" },
  { key: "fromDate", header: "Agreement from" },
  { key: "toDate", header: "Agreement to" },
  { key: "monthlyRent", header: "Monthly Rent (Rs.)" },
  { key: "securityDeposit", header: "Security deposit (₹)" },
  { key: "_approval", header: "Approval", sortField: "approvalStatus" },
  { key: "_tenancy", header: "Tenancy", sortField: "status" },
  { key: "premisesRef", header: "Ref" },
  { key: "_actions", header: "" },
];

export const PREMISES_ALLOCATION_SEARCH_KEYS = [
  "assetDisplay",
  "allotteeName",
  "fromDate",
  "toDate",
  "monthlyRent",
  "securityDeposit",
  "status",
  "approvalStatus",
  "premisesRef",
];

export function formatAllocationMoney(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(Number(amount))) return "—";
  return formatInr(Number(amount));
}

export function allocationApprovalBadge(approvalStatus: string): ReactNode {
  const appr = String(approvalStatus ?? "Draft");
  return (
    <Badge variant={appr === "Approved" ? "default" : appr === "Rejected" ? "destructive" : "secondary"}>
      {appr}
    </Badge>
  );
}

export function allocationTenancyBadge(status: string): ReactNode {
  return <Badge variant={status === "Active" ? "default" : "outline"}>{status}</Badge>;
}
