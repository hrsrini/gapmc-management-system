import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { AlertCircle, FileText, Plus, Loader2 } from "lucide-react";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatInr } from "@/lib/formatInr";
import { formatEntityMasterLabel } from "@shared/unified-entity-display";
import { formatApiDateOrDateTime, formatYearMonthLabel } from "@/lib/dateFormat";
import { Link } from "wouter";
import { billableEntityAllotments, type EntityAllotmentRow } from "@/pages/rent/rent-allotments-ui";

interface EntityRef {
  id: string;
  entityCode?: string | null;
  name: string;
  yardId: string;
  subType?: string | null;
}

interface PreReceiptIssueContext {
  rentPremisesType: string;
  rentPremisesId: string;
  rentAllotmentReferenceNo: string;
  amount: number;
  agreementFrom: string;
  agreementTo: string;
}

interface PreReceipt {
  id: string;
  preReceiptNo?: string | null;
  entityId: string;
  entityCode?: string | null;
  entityName?: string | null;
  entityDisplay?: string | null;
  yardId: string;
  yardName?: string | null;
  amount: number;
  rentPremisesType?: string | null;
  rentPremisesRef?: string | null;
  rentBillingMonth?: string | null;
  status: string;
  issuedAt?: string | null;
  settledReceiptId?: string | null;
  settledReceiptNo?: string | null;
  updatedAt?: string | null;
}

const columns: ReportTableColumn[] = [
  { key: "_no", header: "Pre-receipt no." },
  { key: "entityLabel", header: "Entity ID — name" },
  { key: "premisesId", header: "Premises ID" },
  { key: "yardName", header: "Yard" },
  { key: "billingMonthLabel", header: "Month — year", sortField: "billingMonthSort" },
  { key: "issuedDate", header: "Issued date", sortField: "issuedAtSort" },
  { key: "amount", header: "Rent amount (₹)", sortField: "amountNum" },
  { key: "_settled", header: "Settled receipt no." },
  { key: "_prePdf", header: "Pre-receipt link" },
  { key: "_status", header: "Status", sortField: "status" },
];

async function downloadPdf(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

export default function PreReceipts() {
  const { toast } = useToast();
  const { can } = useAuth();
  const canCreate = can("M-02", "Create");
  const queryClient = useQueryClient();

  const { data: entities = [], isLoading: entLoading } = useQuery<EntityRef[]>({
    queryKey: ["/api/ioms/entities"],
  });
  const { data: list = [], isLoading, isError } = useQuery<PreReceipt[]>({
    queryKey: ["/api/ioms/pre-receipts"],
  });
  const { data: entityAllotments = [] } = useQuery<EntityAllotmentRow[]>({
    queryKey: ["/api/ioms/entity-allotments"],
    queryFn: async () => {
      const res = await fetch("/api/ioms/entity-allotments", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load entity allotments");
      return res.json();
    },
  });

  const govtEntities = useMemo(() => entities.filter((e) => String(e.subType ?? "").trim() === "Govt"), [entities]);

  const govtWithAllotment = useMemo(() => {
    const billable = billableEntityAllotments(entityAllotments);
    const entityIdsWithAllot = new Set(billable.map((a) => a.entityId));
    return govtEntities.filter((e) => entityIdsWithAllot.has(e.id));
  }, [govtEntities, entityAllotments]);

  const entityLabelById = useMemo(
    () => Object.fromEntries(entities.map((e) => [e.id, formatEntityMasterLabel(e.entityCode, e.name)])),
    [entities],
  );

  const [open, setOpen] = useState(false);
  const [entityId, setEntityId] = useState("");
  const [rentPremisesType, setRentPremisesType] = useState("");
  const [rentBillingMonth, setRentBillingMonth] = useState("");
  const [amount, setAmount] = useState("");
  const [agreementFrom, setAgreementFrom] = useState("");
  const [agreementTo, setAgreementTo] = useState("");

  const { data: issueContext, isFetching: issueContextLoading } = useQuery<PreReceiptIssueContext>({
    queryKey: ["/api/ioms/pre-receipts/issue-context", entityId],
    enabled: open && Boolean(entityId),
    queryFn: async () => {
      const res = await fetch(
        `/api/ioms/pre-receipts/issue-context?entityId=${encodeURIComponent(entityId)}`,
        { credentials: "include" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { message?: string }).message ?? (data as { error?: string }).error ?? res.statusText,
        );
      }
      return data as PreReceiptIssueContext;
    },
  });

  useEffect(() => {
    if (!entityId || !issueContext) {
      setRentPremisesType("");
      setAmount("");
      setAgreementFrom("");
      setAgreementTo("");
      return;
    }
    setRentPremisesType(issueContext.rentPremisesType ?? "");
    setAmount(String(issueContext.amount ?? ""));
    setAgreementFrom(issueContext.agreementFrom ?? "");
    setAgreementTo(issueContext.agreementTo ?? "");
  }, [entityId, issueContext]);

  const resetIssueForm = useCallback(() => {
    setEntityId("");
    setRentBillingMonth("");
    setRentPremisesType("");
    setAmount("");
    setAgreementFrom("");
    setAgreementTo("");
  }, []);

  const duplicateForMonth = useMemo(() => {
    const ym = rentBillingMonth.trim().slice(0, 7);
    if (!entityId || !/^\d{4}-\d{2}$/.test(ym)) return null;
    return (list ?? []).find(
      (p) =>
        p.entityId === entityId &&
        String(p.rentBillingMonth ?? "").slice(0, 7) === ym &&
        String(p.status ?? "") !== "Cancelled",
    );
  }, [list, entityId, rentBillingMonth]);

  const billingOutsideAgreement = useMemo(() => {
    const ym = rentBillingMonth.trim().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym) || !agreementFrom || !agreementTo) return false;
    const start = agreementFrom.slice(0, 7);
    const end = agreementTo.slice(0, 7);
    return ym < start || ym > end;
  }, [rentBillingMonth, agreementFrom, agreementTo]);

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/pre-receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ?? (err as { error?: string }).error ?? res.statusText,
        );
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/pre-receipts"] });
      toast({ title: "Pre-receipt issued" });
      setOpen(false);
      resetIssueForm();
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const handlePreReceiptPdf = useCallback(
    async (preReceiptId: string, preReceiptNo: string | null | undefined) => {
      try {
        await downloadPdf(
          `/api/ioms/pre-receipts/${encodeURIComponent(preReceiptId)}/pdf`,
          `pre-receipt-${(preReceiptNo ?? preReceiptId).replace(/[^\w.-]+/g, "_")}.pdf`,
        );
        toast({ title: "Download started" });
      } catch (e) {
        toast({
          title: "PDF failed",
          description: e instanceof Error ? e.message : "Could not download PDF.",
          variant: "destructive",
        });
      }
    },
    [toast],
  );

  const handleReceiptPdf = useCallback(
    async (receiptId: string, receiptNo: string) => {
      try {
        await downloadPdf(
          `/api/ioms/receipts/${encodeURIComponent(receiptId)}/pdf`,
          `receipt-${receiptNo.replace(/[^\w./-]+/g, "_")}.pdf`,
        );
        toast({ title: "Download started" });
      } catch (e) {
        toast({
          title: "PDF failed",
          description: e instanceof Error ? e.message : "Could not download receipt PDF.",
          variant: "destructive",
        });
      }
    },
    [toast],
  );

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((p) => ({
      id: p.id,
      no: p.preReceiptNo ?? p.id,
      _no: (
        <Link className="text-primary hover:underline" href={`/traders/pre-receipts/${encodeURIComponent(p.id)}`}>
          {p.preReceiptNo ?? p.id}
        </Link>
      ),
      entityLabel: p.entityDisplay ?? entityLabelById[p.entityId] ?? "—",
      premisesId: p.rentPremisesRef?.trim() || "—",
      allotmentRef: p.rentPremisesRef?.trim() || "—",
      yardName: p.yardName?.trim() || "—",
      billingMonthLabel: formatYearMonthLabel(p.rentBillingMonth),
      billingMonthSort: p.rentBillingMonth ?? "",
      issuedDate: formatApiDateOrDateTime(p.issuedAt ?? p.updatedAt ?? null),
      issuedAtSort: p.issuedAt ?? p.updatedAt ?? "",
      amount: formatInr(Number(p.amount ?? 0)),
      amountNum: Number(p.amount ?? 0),
      status: p.status,
      _status: <span>{p.status}</span>,
      _settled:
        p.settledReceiptNo && p.settledReceiptId ? (
          <button
            type="button"
            className="text-primary hover:underline font-mono text-xs text-left"
            onClick={() => void handleReceiptPdf(p.settledReceiptId!, p.settledReceiptNo!)}
          >
            {p.settledReceiptNo}
          </button>
        ) : (
          "—"
        ),
      _prePdf: (
        <button
          type="button"
          className="text-primary hover:underline text-sm"
          onClick={() => void handlePreReceiptPdf(p.id, p.preReceiptNo)}
        >
          Click to view PDF
        </button>
      ),
    }));
  }, [list, entityLabelById, handlePreReceiptPdf, handleReceiptPdf]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Traders", href: "/traders/licences" }, { label: "Pre-receipts" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load pre-receipts.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Traders", href: "/traders/licences" }, { label: "Pre-receipts (Track B)" }]}>
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Pre-receipts (M-02 Track B)
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Issued / dispatched / acknowledged / settled tracking. Only{" "}
              <span className="font-medium text-foreground">Govt</span> Track B entities can receive pre-receipts;
              Commercial and Ad-hoc occupant entities use tax-invoice flows (M-03).
            </p>
          </div>
          {canCreate && (
            <Button
              size="sm"
              onClick={() => {
                resetIssueForm();
                setOpen(true);
              }}
              disabled={entLoading || govtWithAllotment.length === 0}
            >
              <Plus className="h-4 w-4 mr-1" />
              Issue pre-receipt
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["no", "entityLabel", "premisesId", "yardName", "billingMonthLabel", "status", "issuedDate"]}
              searchPlaceholder="Search pre-receipts…"
              defaultSortKey="issuedAtSort"
              defaultSortDir="desc"
              emptyMessage="No pre-receipts."
            />
          )}
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) resetIssueForm();
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Issue pre-receipt</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Entity *</Label>
              <Select
                value={entityId || "__pick__"}
                onValueChange={(v) => {
                  const next = v === "__pick__" ? "" : v;
                  setEntityId(next);
                  setRentBillingMonth("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select entity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__pick__">Select…</SelectItem>
                  {govtWithAllotment.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {formatEntityMasterLabel(e.entityCode, e.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {govtEntities.length > 0 && govtWithAllotment.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No Govt entity has an active approved premises allocation. Complete allocation before issuing.
                </p>
              )}
            </div>

            {entityId && issueContextLoading && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading premises and rent…
              </p>
            )}

            {entityId && !issueContextLoading && issueContext && (
              <>
                <div className="rounded-md border bg-muted/40 p-3 space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Premises type (PDF):</span>{" "}
                    <span className="font-medium">{rentPremisesType || "—"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Premises ID:</span>{" "}
                    <span className="font-medium font-mono">{issueContext.rentPremisesId || "—"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Allotment Reference No.:</span>{" "}
                    <span className="font-medium font-mono">{issueContext.rentAllotmentReferenceNo || "—"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Rent amount (₹):</span>{" "}
                    <span className="font-medium">{amount ? formatInr(Number(amount)) : "—"}</span>
                  </div>
                  {agreementFrom && agreementTo && (
                    <p className="text-xs text-muted-foreground">
                      Agreement: {formatApiDateOrDateTime(agreementFrom)} — {formatApiDateOrDateTime(agreementTo)}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label>Billing month *</Label>
                  <Input
                    type="month"
                    value={rentBillingMonth}
                    onChange={(e) => setRentBillingMonth(e.target.value)}
                    min={agreementFrom.slice(0, 7) || undefined}
                    max={agreementTo.slice(0, 7) || undefined}
                  />
                  {duplicateForMonth && (
                    <p className="text-xs text-destructive">
                      A pre-receipt already exists for this entity and month (
                      {duplicateForMonth.preReceiptNo ?? duplicateForMonth.id}).
                    </p>
                  )}
                  {billingOutsideAgreement && rentBillingMonth && (
                    <p className="text-xs text-destructive">
                      Billing month is outside the active agreement period for this premises.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                createMutation.isPending ||
                !entityId ||
                !rentBillingMonth ||
                issueContextLoading ||
                !issueContext ||
                Boolean(duplicateForMonth) ||
                billingOutsideAgreement
              }
              onClick={() => {
                const ym = rentBillingMonth.trim().slice(0, 7);
                if (!/^\d{4}-\d{2}$/.test(ym)) {
                  toast({ title: "Billing month", description: "Pick a month (YYYY-MM).", variant: "destructive" });
                  return;
                }
                createMutation.mutate({ entityId, rentBillingMonth: ym });
              }}
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Issue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
