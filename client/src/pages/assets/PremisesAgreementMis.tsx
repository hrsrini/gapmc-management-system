import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { downloadCsv } from "@/lib/csvDownload";
import { formatInr } from "@/lib/formatInr";
import { ymdToDmy } from "@/lib/premisesAgreementUi";
import { cn } from "@/lib/utils";

/** FRD §10 — Reports and MIS (client feedback). */
const REPORTS: { key: string; label: string }[] = [
  { key: "due-2-months", label: "1. Agreements due for renewal (next 2 months)" },
  { key: "expired-not-renewed", label: "2. Agreements expired but not renewed" },
  { key: "notices", label: "3. Renewal notices generated and printed" },
  { key: "notice-dispatch", label: "4. Notice generation and dispatch history" },
  { key: "renewed", label: "5. Agreements successfully renewed" },
  { key: "pending-renewal", label: "6. Agreements pending for renewal" },
  { key: "revision-due", label: "7. Agreements due for mandatory rent revision" },
  { key: "revision-history", label: "8. Rent revision history" },
  { key: "premises-renewal-history", label: "9. Premises-wise agreement renewal history" },
  { key: "delay-penalty", label: "10. Delay period and penalty details" },
  { key: "penalties-pending", label: "11. Penalties pending verification and approval" },
  { key: "current-status", label: "12. Premises-wise current agreement status" },
];

export default function PremisesAgreementMis() {
  const [reportKey, setReportKey] = useState("revision-due");
  const [renewalFilter, setRenewalFilter] = useState("all");
  const { data, isLoading } = useQuery<{ rows: Array<Record<string, unknown>> }>({
    queryKey: [`/api/ioms/premises-agreements-mis/${reportKey}`],
  });
  const rows = useMemo(() => {
    let list = data?.rows ?? [];
    if (renewalFilter !== "all") {
      list = list.filter((r) => String(r.renewalStatus ?? r.status ?? "") === renewalFilter);
    }
    return list;
  }, [data, renewalFilter]);

  const activeLabel = REPORTS.find((r) => r.key === reportKey)?.label ?? reportKey;

  return (
    <AppShell
      breadcrumbs={[
        { label: "Premises allocations", href: "/assets/agreements" },
        { label: "Reports & MIS" },
      ]}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">Reports and MIS</h1>
            <p className="text-sm text-muted-foreground">Pick a report, filter it, then print or export it.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              Print
            </Button>
            <Button
              disabled={!rows.length}
              onClick={() => {
                const keys = [
                  ...new Set(
                    rows.flatMap((r) =>
                      Object.entries(r)
                        .filter(([, v]) => v != null && typeof v !== "object")
                        .map(([k]) => k),
                    ),
                  ),
                ];
                downloadCsv(
                  `premises-agreement-${reportKey}.csv`,
                  keys,
                  rows.map((r) => keys.map((k) => (r[k] as string | number | boolean | null | undefined) ?? "")),
                );
              }}
            >
              Export to Excel
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <Card className="h-fit">
            <CardContent className="pt-4 space-y-1">
              {REPORTS.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setReportKey(r.key)}
                  className={cn(
                    "w-full text-left text-sm rounded-md px-3 py-2 transition-colors",
                    reportKey === r.key ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 space-y-4">
              <div>
                <h2 className="text-lg font-semibold">{activeLabel.replace(/^\d+\.\s*/, "")}</h2>
                <p className="text-sm text-muted-foreground">
                  {reportKey === "revision-due"
                    ? "Agreements whose next period requires rent revision by frequency, with no approved revision yet for that cycle."
                    : `${rows.length} row(s)`}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Select value={renewalFilter} onValueChange={setRenewalFilter}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Renewal status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All renewal statuses</SelectItem>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="RenewalDue">Renewal Due</SelectItem>
                    <SelectItem value="Expired">Expired</SelectItem>
                    <SelectItem value="RentRevisionPending">Rent Revision Pending</SelectItem>
                    <SelectItem value="PenaltyApplicable">Penalty Applicable</SelectItem>
                  </SelectContent>
                </Select>
                <Button asChild variant="outline">
                  <Link href="/assets/agreements">Back to list</Link>
                </Button>
              </div>

              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <div className="overflow-auto">
                  <p className="text-sm mb-2">{rows.length} record(s) found.</p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="py-2 pr-2">Premises / Agreement</th>
                        <th className="py-2 pr-2">Lessee</th>
                        <th className="py-2 pr-2">Period</th>
                        <th className="py-2 pr-2">Frequency</th>
                        <th className="py-2 pr-2">Expiry / date</th>
                        <th className="py-2 pr-2">Rent / amount</th>
                        <th className="py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 100).map((r, i) => {
                        const agreementId = String(r.agreementId ?? r.id ?? "");
                        const premises =
                          Array.isArray(r.premises)
                            ? (r.premises as Array<{ premisesId?: string }>)
                                .map((p) => p.premisesId)
                                .filter(Boolean)
                                .join(", ")
                            : String(r.agreementNo ?? r.noticeNo ?? agreementId);
                        return (
                          <tr key={`${agreementId}-${i}`} className="border-b border-border/50">
                            <td className="py-2 pr-2">
                              <div className="font-mono text-xs">{premises || "—"}</div>
                              <div className="text-xs text-muted-foreground">{String(r.agreementNo ?? "")}</div>
                            </td>
                            <td className="py-2 pr-2">{String(r.allotteeName ?? "—")}</td>
                            <td className="py-2 pr-2">{String(r.agreementPeriodNumber ?? r.newPeriodNumber ?? "—")}</td>
                            <td className="py-2 pr-2">{String(r.rentRevisionFrequency ?? "—")}</td>
                            <td className="py-2 pr-2">
                              {ymdToDmy(String(r.toDate ?? r.effectiveDate ?? r.expiryDate ?? r.noticeDate ?? ""))}
                            </td>
                            <td className="py-2 pr-2">
                              {r.totalMonthlyRent != null
                                ? formatInr(Number(r.totalMonthlyRent))
                                : r.calculatedAmount != null
                                  ? formatInr(Number(r.calculatedAmount))
                                  : "—"}
                            </td>
                            <td className="py-2">
                              <Badge variant="outline" className="bg-amber-500/10 text-amber-800 border-amber-500/30">
                                {String(r.renewalStatus ?? r.status ?? "—")}
                              </Badge>
                              {agreementId ? (
                                <div>
                                  <Link
                                    className="text-xs text-primary underline"
                                    href={`/assets/agreements/${agreementId}/history`}
                                  >
                                    History
                                  </Link>
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {rows.length === 0 && <p className="text-sm text-muted-foreground">No rows.</p>}
                </div>
              )}
              <p className="text-xs text-muted-foreground text-right">
                Generated {ymdToDmy(new Date().toISOString().slice(0, 10))}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
