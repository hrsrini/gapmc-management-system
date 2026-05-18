import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { KeyRound, AlertCircle, Plus, Loader2, Pencil } from "lucide-react";
import { localCalendarYmd, RENT_REVISION_MODES } from "@shared/premises-allocation";
import { invalidateAssetAllotmentQueries } from "@/lib/invalidate-asset-allotments";
import { formatInr } from "@/lib/formatInr";
import {
  AssetAllotmentManageDialog,
  type ManagedAssetAllotment,
} from "@/components/assets/AssetAllotmentManageDialog";

type Allotment = ManagedAssetAllotment;
interface Asset {
  id: string;
  assetId: string;
  yardId: string;
  assetType: string;
}
interface VacantAssetRow {
  asset: Asset;
}
interface Licence {
  id: string;
  licenceNo?: string | null;
  firmName: string;
  yardId: string;
}

const columns: ReportTableColumn[] = [
  { key: "assetDisplay", header: "Asset" },
  { key: "allotteeName", header: "Allottee" },
  { key: "licenceDisplay", header: "Licence" },
  { key: "fromDate", header: "From" },
  { key: "toDate", header: "To" },
  { key: "_approval", header: "Approval", sortField: "approvalStatus" },
  { key: "_status", header: "Tenancy", sortField: "status" },
  { key: "securityDeposit", header: "Security deposit", sortField: "securityDepositNum" },
  { key: "_actions", header: "" },
];

export default function AssetAllotments() {
  const [assetIdFilter, setAssetIdFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [traderLicenceId, setTraderLicenceId] = useState("");
  const [allotteeName, setAllotteeName] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [status, setStatus] = useState("Pending");
  const [securityDeposit, setSecurityDeposit] = useState("");
  const [monthlyRent, setMonthlyRent] = useState("");
  const [rentRevisionMode, setRentRevisionMode] = useState<string>("StandardConsecutiveRenewal");

  const [manageRow, setManageRow] = useState<Allotment | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const canCreate = can("M-02", "Create");
  const canUpdate = can("M-02", "Update");

  const listUrl = assetIdFilter && assetIdFilter !== "all"
    ? `/api/ioms/asset-allotments?assetId=${encodeURIComponent(assetIdFilter)}`
    : "/api/ioms/asset-allotments";

  const { data: allotments = [], isLoading, isError } = useQuery<Allotment[]>({
    queryKey: [listUrl],
    queryFn: async () => {
      const res = await fetch(listUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch allotments");
      return res.json();
    },
  });
  const { data: assets = [] } = useQuery<Asset[]>({ queryKey: ["/api/ioms/assets"] });
  const { data: vacantRows = [] } = useQuery<VacantAssetRow[]>({ queryKey: ["/api/ioms/assets/vacant"] });
  const { data: licences = [] } = useQuery<Licence[]>({ queryKey: ["/api/ioms/traders/licences"] });

  const assetDisplayMap = Object.fromEntries(assets.map((a) => [a.id, a.assetId]));
  assets.forEach((a) => {
    assetDisplayMap[a.assetId] = a.assetId;
  });

  const vacantAssets = useMemo(() => vacantRows.map((r) => r.asset), [vacantRows]);

  const licenceDisplayById = Object.fromEntries(
    licences.map((l) => [l.id, `${l.licenceNo ?? l.id} — ${l.firmName}`]),
  );

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return allotments.map((a) => {
      const appr = String(a.approvalStatus ?? "Draft");
      return {
        id: a.id,
        assetDisplay: assetDisplayMap[a.assetId] ?? a.assetId,
        allotteeName: a.allotteeName,
        licenceDisplay: licenceDisplayById[a.traderLicenceId] ?? a.traderLicenceId,
        fromDate: a.fromDate,
        toDate: a.toDate,
        status: a.status,
        approvalStatus: appr,
        securityDeposit:
          a.securityDeposit != null ? `${formatInr(a.securityDeposit)}` : "—",
        securityDepositNum: a.securityDeposit ?? null,
        _approval: (
          <Badge variant={appr === "Approved" ? "default" : appr === "Rejected" ? "destructive" : "secondary"}>
            {appr}
          </Badge>
        ),
        _status: (
          <Badge variant={a.status === "Active" ? "default" : "secondary"}>{a.status}</Badge>
        ),
        _actions: canUpdate ? (
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => setManageRow(a)}>
            <Pencil className="h-4 w-4" />
            <span className="sr-only">Manage</span>
          </Button>
        ) : null,
      };
    });
  }, [allotments, assetDisplayMap, licenceDisplayById, canUpdate]);

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/asset-allotments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      invalidateAssetAllotmentQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/assets/vacant"] });
      toast({ title: "Allotment created" });
      setDialogOpen(false);
      setAllotteeName("");
      setFromDate("");
      setToDate("");
      setSecurityDeposit("");
      setMonthlyRent("");
      setAssetId("");
      setTraderLicenceId("");
      setStatus("Pending");
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const todayLocal = localCalendarYmd();
    if (status === "Vacated" && toDate > todayLocal) {
      toast({
        title: "Invalid vacated date",
        description: "Vacated on must be today or an earlier date.",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      assetId: assetId || undefined,
      traderLicenceId: traderLicenceId || undefined,
      allotteeName: allotteeName || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      status,
      securityDeposit: securityDeposit ? Number(securityDeposit) : null,
      monthlyRent: monthlyRent ? Number(monthlyRent) : undefined,
      rentRevisionMode,
      approvalStatus: "Draft",
    });
  };

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Assets", href: "/assets" }, { label: "Allotments" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load allotments.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Assets", href: "/assets" }, { label: "Shop Allotments" }]}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Shop Allotments (M-02)
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Tenancy status (Pending / Active / Vacated) follows the approval workflow for new lines: open{" "}
              <strong>Manage</strong>, upload the notarised agreement, then DV verifies and DA approves — Approved sets
              tenancy to Active. Use Manage to edit draft fields or run approvals.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={assetIdFilter} onValueChange={setAssetIdFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All assets" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All assets</SelectItem>
                {assets.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.assetId}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canCreate && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-1" /> Add allotment</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add allotment</DialogTitle></DialogHeader>
                <form onSubmit={handleAdd} className="space-y-4">
                  <div><Label>Asset *</Label>
                    <Select value={assetId} onValueChange={setAssetId} required>
                      <SelectTrigger><SelectValue placeholder="Select asset" /></SelectTrigger>
                      <SelectContent>
                        {vacantAssets.map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.assetId}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Trader licence *</Label>
                    <Select value={traderLicenceId} onValueChange={setTraderLicenceId} required>
                      <SelectTrigger><SelectValue placeholder="Select licence" /></SelectTrigger>
                      <SelectContent>
                        {licences.map((l) => (
                          <SelectItem key={l.id} value={l.id}>{l.licenceNo ?? l.id} — {l.firmName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Allottee name *</Label><Input value={allotteeName} onChange={(e) => setAllotteeName(e.target.value)} required /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><Label>From date *</Label><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} required /></div>
                    <div>
                      <Label>To date *</Label>
                      <Input
                        type="date"
                        value={toDate}
                        onChange={(e) => setToDate(e.target.value)}
                        max={status === "Vacated" ? localCalendarYmd() : undefined}
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Monthly rent *</Label>
                      <Input type="number" step="0.01" value={monthlyRent} onChange={(e) => setMonthlyRent(e.target.value)} required />
                    </div>
                    <div>
                      <Label>Rent revision mode *</Label>
                      <Select value={rentRevisionMode} onValueChange={setRentRevisionMode}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {RENT_REVISION_MODES.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m === "StandardConsecutiveRenewal" ? "Standard" : "PWD Certificate"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div><Label>Status</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Pending">Pending</SelectItem>
                        <SelectItem value="Active">Active (legacy)</SelectItem>
                        <SelectItem value="Vacated">Vacated</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Security deposit</Label><Input type="number" step="0.01" value={securityDeposit} onChange={(e) => setSecurityDeposit(e.target.value)} placeholder="Optional" /></div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={createMutation.isPending}>
                      {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
            )}
          </div>
        </CardHeader>

        <AssetAllotmentManageDialog
          row={manageRow}
          onClose={() => setManageRow(null)}
          onRowUpdated={setManageRow}
          assetDisplayMap={assetDisplayMap}
        />

        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={[
                "assetDisplay",
                "allotteeName",
                "licenceDisplay",
                "fromDate",
                "toDate",
                "status",
                "approvalStatus",
              ]}
              searchPlaceholder="Search allotments…"
              defaultSortKey="fromDate"
              defaultSortDir="desc"
              resetPageDependency={listUrl}
              emptyMessage="No allotments."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
