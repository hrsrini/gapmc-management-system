import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { useScopedActiveYards } from "@/hooks/useScopedActiveYards";
import { filterYardTypeLocations } from "@/lib/legacyYardMatch";
import {
  AGREEMENT_RENEWAL_STATUSES,
  canGenerateRenewalNotice,
  canStartRenewal,
  isRenewalWindowOpen,
  noticeDisabledByRenewal,
} from "@shared/premises-agreement";
import {
  formatRentDeposit,
  periodNeedsRevision,
  renewalStatusBadgeClass,
  renewalStatusLabel,
  renewalStatusSubtext,
  ymdToDmy,
} from "@/lib/premisesAgreementUi";
import { AlertCircle, History, KeyRound, Pencil, Plus, RefreshCcw } from "lucide-react";

type AgreementRow = {
  id: string;
  agreementNo: string;
  allotteeName: string;
  yardId: string;
  fromDate: string;
  toDate: string;
  renewalStatus: string;
  approvalStatus: string;
  agreementPeriodNumber: number;
  rentRevisionFrequency: number;
  revisionDue?: boolean;
  premisesCount: number;
  totalMonthlyRent: number;
  totalSecurityDeposit: number;
  daysToExpiry: number | null;
  premises: Array<{ premisesId?: string; tenancyStatus?: string }>;
};

const columns: ReportTableColumn[] = [
  { key: "agreementNo", header: "Agreement ref" },
  { key: "_premises", header: "Premises" },
  { key: "allotteeName", header: "Allottee" },
  { key: "_validity", header: "Agreement validity" },
  { key: "rentDeposit", header: "Rent / deposit (Rs.)" },
  { key: "_renewal", header: "Renewal status" },
  { key: "_period", header: "Agreement period" },
  { key: "_approval", header: "Approval / tenancy" },
  { key: "_actions", header: "Actions" },
];

export default function PremisesAgreementsList() {
  const { data: yardsRaw = [] } = useScopedActiveYards();
  const yards = useMemo(() => filterYardTypeLocations(yardsRaw), [yardsRaw]);

  const [yardId, setYardId] = useState("all");
  const [renewalStatus, setRenewalStatus] = useState("all");
  const [search, setSearch] = useState("");

  const qs = useMemo(() => {
    const sp = new URLSearchParams();
    if (yardId !== "all") sp.set("yardId", yardId);
    if (renewalStatus !== "all") sp.set("renewalStatus", renewalStatus);
    if (search.trim()) sp.set("search", search.trim());
    const q = sp.toString();
    return q ? `/api/ioms/premises-agreements?${q}` : "/api/ioms/premises-agreements";
  }, [yardId, renewalStatus, search]);

  const { data, isLoading, isError, refetch } = useQuery<{ total: number; rows: AgreementRow[] }>({
    queryKey: [qs],
  });
  const { data: summary } = useQuery<{
    dueForRenewal: number;
    expiredNotRenewed: number;
    revisionDueAtNextRenewal: number;
    penaltiesAwaiting: number;
  }>({ queryKey: ["/api/ioms/premises-agreements/summary"] });

  const rows = useMemo(() => {
    return (data?.rows ?? []).map((r) => {
      const days = r.daysToExpiry;
      const windowOpen = isRenewalWindowOpen(days);
      const inProgress = ["RenewalInitiated", "RenewalPending", "RentRevisionPending"].includes(
        r.renewalStatus,
      );
      const noticeOk =
        windowOpen &&
        canGenerateRenewalNotice(r.renewalStatus) &&
        !noticeDisabledByRenewal(r.renewalStatus);
      const renewOk =
        (windowOpen || inProgress) &&
        canStartRenewal(r.renewalStatus) &&
        r.approvalStatus === "Approved";
      const expired = days != null && days < 0;
      const needsRev = periodNeedsRevision(r.agreementPeriodNumber, r.rentRevisionFrequency);
      const premisesIds = (r.premises ?? []).map((p) => p.premisesId).filter(Boolean) as string[];
      const activeTenancy = (r.premises ?? []).some((p) => p.tenancyStatus === "Active");

      return {
        id: r.id,
        agreementNo: r.agreementNo,
        allotteeName: r.allotteeName,
        rentDeposit: formatRentDeposit(r.totalMonthlyRent, Number(r.totalSecurityDeposit ?? 0)),
        _premises: (
          <div className="text-sm">
            {r.premisesCount > 1 ? (
              <>
                <div className="font-medium">{r.premisesCount} premises, one agreement</div>
                <div className="text-muted-foreground text-xs">{premisesIds.join(" · ")}</div>
              </>
            ) : (
              <span className="font-mono">{premisesIds[0] ?? "—"}</span>
            )}
          </div>
        ),
        _validity: (
          <div className="text-sm">
            <div>
              {ymdToDmy(r.fromDate)} to {ymdToDmy(r.toDate)}
            </div>
            {days != null && (
              <div className={expired ? "text-destructive text-xs font-medium" : "text-muted-foreground text-xs"}>
                {expired ? `Expired ${Math.abs(days)} days ago` : `Expires in ${days} days`}
              </div>
            )}
          </div>
        ),
        _renewal: (
          <div className="space-y-1">
            <Badge variant="outline" className={renewalStatusBadgeClass(r.renewalStatus)}>
              {renewalStatusLabel(r.renewalStatus)}
            </Badge>
            <div className="text-xs text-muted-foreground">
              {renewalStatusSubtext({ status: r.renewalStatus, daysToExpiry: days, toDate: r.toDate })}
            </div>
          </div>
        ),
        _period: (
          <div className="text-sm">
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(6, Math.max(r.agreementPeriodNumber, r.rentRevisionFrequency + 1)) }).map(
                (_, i) => (
                  <span
                    key={i}
                    className={`inline-block h-2 w-2 rounded-full ${
                      i + 1 === r.agreementPeriodNumber
                        ? "bg-foreground"
                        : needsRev && i + 1 === r.agreementPeriodNumber + 1
                          ? "bg-amber-700"
                          : "bg-muted-foreground/30"
                    }`}
                  />
                ),
              )}
            </div>
            <div>Period {r.agreementPeriodNumber}</div>
            {needsRev && (
              <div className="text-xs text-amber-800">
                Period {r.agreementPeriodNumber} → {r.agreementPeriodNumber + 1} needs a revision
              </div>
            )}
          </div>
        ),
        _approval: (
          <div className="flex flex-wrap gap-1">
            <Badge variant={r.approvalStatus === "Approved" ? "default" : "secondary"}>{r.approvalStatus}</Badge>
            {activeTenancy && (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20">
                Active
              </Badge>
            )}
          </div>
        ),
        _actions: (
          <div className="flex flex-wrap gap-1">
            {r.approvalStatus === "Approved" && (
              <Button asChild size="sm" variant="secondary">
                <Link href={`/assets/agreements/leave-licence/new?premisesAgreementId=${r.id}`}>L&amp;L</Link>
              </Button>
            )}
            <Button asChild size="sm" disabled={!renewOk}>
              <Link href={`/assets/agreements/${r.id}/renew`}>{inProgress ? "Continue" : "Renew"}</Link>
            </Button>
            <Button asChild size="sm" variant="outline" disabled={!noticeOk}>
              <Link href={`/assets/agreements/${r.id}/notice`}>Notice</Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href={`/assets/agreements/${r.id}/history`}>
                <History className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href={`/assets/agreements/${r.id}`}>
                <Pencil className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        ),
      };
    });
  }, [data]);

  return (
    <AppShell breadcrumbs={[{ label: "Assets", href: "/assets" }, { label: "Premises allocations" }]}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <KeyRound className="h-6 w-6" />
              Premises allocations ({data?.total ?? 0})
            </h1>
            <p className="text-sm text-muted-foreground max-w-3xl">
              One agreement can cover several premises in the same yard. Renewal opens two months before expiry; a rent
              revision is mandatory in the period set by each agreement&apos;s frequency. Tenancy becomes Active only after
              DA approval.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void refetch()}>
              <RefreshCcw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            <Button asChild>
              <Link href="/assets/agreements/new">
                <Plus className="h-4 w-4 mr-1" />
                Add allotment
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Due for renewal (next 2 months)</CardDescription>
              <CardTitle className="text-2xl">{summary?.dueForRenewal ?? "—"}</CardTitle>
            </CardHeader>
          </Card>
          <Card className={(summary?.expiredNotRenewed ?? 0) > 0 ? "border-destructive/40" : undefined}>
            <CardHeader className="pb-2">
              <CardDescription>Expired, not renewed</CardDescription>
              <CardTitle className={`text-2xl ${(summary?.expiredNotRenewed ?? 0) > 0 ? "text-destructive" : ""}`}>
                {summary?.expiredNotRenewed ?? "—"}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card className={(summary?.revisionDueAtNextRenewal ?? 0) > 0 ? "border-amber-500/40" : undefined}>
            <CardHeader className="pb-2">
              <CardDescription>Mandatory rent revision at next renewal</CardDescription>
              <CardTitle className={`text-2xl ${(summary?.revisionDueAtNextRenewal ?? 0) > 0 ? "text-amber-800" : ""}`}>
                {summary?.revisionDueAtNextRenewal ?? "—"}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Penalties awaiting verification</CardDescription>
              <CardTitle className="text-2xl">{summary?.penaltiesAwaiting ?? "—"}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardContent className="pt-6 flex flex-wrap gap-3 items-end">
            <div className="space-y-1 grow min-w-[220px]">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search premises, agreement ref, allottee…"
              />
            </div>
            <Select value={renewalStatus} onValueChange={setRenewalStatus}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="All renewal statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All renewal statuses</SelectItem>
                {AGREEMENT_RENEWAL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {renewalStatusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={yardId} onValueChange={setYardId}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All yards" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All yards</SelectItem>
                {yards.map((y) => (
                  <SelectItem key={y.id} value={y.id}>
                    {y.name ?? y.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button asChild variant="secondary">
              <Link href="/assets/agreements/approvals">Approvals queue</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/assets/agreements/mis">Reports & MIS</Link>
            </Button>
          </CardContent>
        </Card>

        {isError ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="p-4 flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" /> Failed to load agreements
            </CardContent>
          </Card>
        ) : isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <ClientDataGrid
            columns={columns}
            sourceRows={rows}
            defaultSortKey="agreementNo"
            searchPlaceholder="Filter rows…"
            searchKeys={["agreementNo", "allotteeName", "rentDeposit"]}
          />
        )}
      </div>
    </AppShell>
  );
}
