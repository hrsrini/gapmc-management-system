import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { FileCheck, ArrowLeft, AlertCircle, ShieldAlert, Loader2, Trash2, Package, Pencil, MessageSquareWarning, Wallet, BookOpen } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatYmdToDisplay } from "@/lib/dateFormat";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { traderLicenceUsesBmSupplement } from "@shared/m02-licence-bm-bk";

interface Licence {
  id: string;
  licenceNo?: string | null;
  parentLicenceId?: string | null;
  applicationKind?: string | null;
  firmName: string;
  firmType?: string | null;
  yardId: string;
  contactName?: string | null;
  mobile: string;
  email?: string | null;
  address?: string | null;
  aadhaarToken?: string | null;
  pan?: string | null;
  gstin?: string | null;
  licenceType: string;
  feeAmount?: number | null;
  receiptId?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  status: string;
  isBlocked?: boolean;
  blockReason?: string | null;
  dvReturnRemarks?: string | null;
  workflowRevisionCount?: number | null;
  doUser?: string | null;
  dvUser?: string | null;
  daUser?: string | null;
  govtGstExemptCategoryId?: string | null;
  isNonGstEntity?: boolean | null;
  fatherSpouseName?: string | null;
  dateOfBirth?: string | null;
  emergencyContactMobile?: string | null;
  characterCertIssuer?: string | null;
  characterCertDate?: string | null;
  bmFormDocUrl?: string | null;
  bmFormDocFile?: string | null;
  parentLicenceFeeSnapshot?: number | null;
  renewalNoArrearsDeclared?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface StockOpeningRow {
  id: string;
  traderLicenceId: string;
  commodityId: string;
  yardId: string;
  quantity: number;
  unit: string;
  effectiveDate: string;
  remarks?: string | null;
}
interface CommodityRef {
  id: string;
  name: string;
  unit?: string | null;
}

interface GstExemptCategory {
  id: string;
  code: string;
  name: string;
}
interface BlockingLogEntry {
  id: string;
  traderLicenceId: string;
  action: string;
  reason: string;
  actionedBy: string;
  actionedAt: string;
}
interface YardRef {
  id: string;
  name: string;
}
interface ReceiptRef {
  id: string;
  receiptNo: string;
}

interface AssetRef {
  id: string;
  assetId: string;
}
interface AssetAllotmentRow {
  id: string;
  assetId: string;
  traderLicenceId: string;
  allotteeName: string;
  fromDate: string;
  toDate: string;
  status: string;
  securityDeposit?: number | null;
}

const stockColumns: ReportTableColumn[] = [
  { key: "commodityName", header: "Commodity" },
  { key: "quantity", header: "Qty", sortField: "quantity" },
  { key: "unit", header: "Unit" },
  { key: "effectiveDate", header: "Effective" },
  { key: "_actions", header: "Actions" },
];

const blockingColumns: ReportTableColumn[] = [
  { key: "_action", header: "Action", sortField: "action" },
  { key: "reason", header: "Reason" },
  { key: "actionedBy", header: "Actioned by" },
  { key: "actionedAt", header: "Actioned at" },
];

const allotmentColumns: ReportTableColumn[] = [
  { key: "assetDisplay", header: "Premises / Asset" },
  { key: "allotteeName", header: "Allottee" },
  { key: "fromDate", header: "From" },
  { key: "toDate", header: "To" },
  { key: "_status", header: "Status", sortField: "status" },
  { key: "securityDeposit", header: "Security deposit" },
];

interface RenewPreview {
  canRenew: boolean;
  parentLicenceNo: string | null;
  parentFeeAmount: number | null;
  systemLicenceFee: number;
  defaultRenewalFee: number;
  resolutionSource: string;
  resolutionNote: string;
}

export default function TraderLicenceDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { can } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canUpdateLicence = can("M-02", "Update");
  const [exemptCategoryId, setExemptCategoryId] = useState<string>("__none__");
  const [nonGst, setNonGst] = useState(false);
  const [stockCommodityId, setStockCommodityId] = useState<string>("");
  const [stockQty, setStockQty] = useState("");
  const [stockUnit, setStockUnit] = useState("Quintal");
  const [stockEffective, setStockEffective] = useState("");
  const [stockRemarks, setStockRemarks] = useState("");
  const [queryDialogOpen, setQueryDialogOpen] = useState(false);
  const [queryRemarksDraft, setQueryRemarksDraft] = useState("");
  const [renewDialogOpen, setRenewDialogOpen] = useState(false);
  const [renewFeeDraft, setRenewFeeDraft] = useState("");
  const [renewValidFrom, setRenewValidFrom] = useState("");
  const [renewValidTo, setRenewValidTo] = useState("");

  const { data: licence, isLoading, isError } = useQuery<Licence>({
    queryKey: ["/api/ioms/traders/licences", id],
    enabled: !!id,
  });
  const licenceIssued = Boolean(licence?.licenceNo && String(licence.licenceNo).trim());
  const renewPreviewEnabled = Boolean(
    renewDialogOpen && id && licence && licenceIssued && !licence.isBlocked && canUpdateLicence,
  );
  const { data: renewPreview, isLoading: renewPreviewLoading } = useQuery<RenewPreview>({
    queryKey: ["licence-renew-preview", id],
    enabled: renewPreviewEnabled,
    queryFn: async (): Promise<RenewPreview> => {
      const res = await fetch(`/api/ioms/traders/licences/${encodeURIComponent(id!)}/renew-preview`, {
        credentials: "include",
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      return (await res.json()) as RenewPreview;
    },
  });

  useEffect(() => {
    if (!renewDialogOpen || !renewPreview) return;
    setRenewFeeDraft(String(renewPreview.defaultRenewalFee));
    setRenewValidFrom("");
    setRenewValidTo("");
  }, [renewDialogOpen, renewPreview]);
  const { data: blockingLog = [] } = useQuery<BlockingLogEntry[]>({
    queryKey: [id ? `/api/ioms/traders/blocking-log?traderLicenceId=${encodeURIComponent(id)}` : ""],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/ioms/traders/blocking-log?traderLicenceId=${encodeURIComponent(id!)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch blocking log");
      return res.json();
    },
  });
  const { data: yards = [] } = useQuery<YardRef[]>({
    queryKey: ["/api/yards"],
  });
  const { data: receipts = [] } = useQuery<ReceiptRef[]>({
    queryKey: ["/api/ioms/receipts"],
  });
  const { data: gstCategories = [] } = useQuery<GstExemptCategory[]>({
    queryKey: ["/api/ioms/reference/govt-gst-exempt-categories"],
  });
  const { data: commodities = [] } = useQuery<CommodityRef[]>({
    queryKey: ["/api/ioms/commodities"],
  });
  const { data: assets = [] } = useQuery<AssetRef[]>({
    queryKey: ["/api/ioms/assets"],
  });
  const { data: allotments = [] } = useQuery<AssetAllotmentRow[]>({
    queryKey: [id ? `/api/ioms/asset-allotments?traderLicenceId=${encodeURIComponent(id)}` : ""],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/ioms/asset-allotments?traderLicenceId=${encodeURIComponent(id!)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load allotments");
      return res.json();
    },
  });
  const { data: stockOpenings = [], isLoading: stockLoading } = useQuery<StockOpeningRow[]>({
    queryKey: ["/api/ioms/traders/licences", id, "stock-openings"],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/ioms/traders/licences/${encodeURIComponent(id!)}/stock-openings`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load stock openings");
      return res.json();
    },
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));
  const receiptById = Object.fromEntries(receipts.map((r) => [r.id, r.receiptNo]));
  const assetDisplayById = useMemo(() => Object.fromEntries(assets.map((a) => [a.id, a.assetId])), [assets]);
  const exemptCategoryName =
    licence?.govtGstExemptCategoryId != null
      ? gstCategories.find((c) => c.id === licence.govtGstExemptCategoryId)?.name
      : undefined;

  const commodityNameById = useMemo(
    () => Object.fromEntries(commodities.map((c) => [c.id, c.name])),
    [commodities],
  );

  const blockingRows = useMemo((): Record<string, unknown>[] => {
    return blockingLog.map((e) => ({
      id: e.id,
      action: e.action,
      reason: e.reason,
      actionedBy: e.actionedBy,
      actionedAt: e.actionedAt,
      _action: (
        <Badge variant={e.action === "Blocked" ? "destructive" : "default"}>{e.action}</Badge>
      ),
    }));
  }, [blockingLog]);

  const allotmentRows = useMemo((): Record<string, unknown>[] => {
    return (allotments ?? []).map((a) => ({
      id: a.id,
      assetDisplay: assetDisplayById[a.assetId] ?? a.assetId,
      allotteeName: a.allotteeName,
      fromDate: a.fromDate,
      toDate: a.toDate,
      status: a.status,
      securityDeposit: a.securityDeposit != null ? `₹${Number(a.securityDeposit).toLocaleString()}` : "—",
      _status: <Badge variant={a.status === "Active" ? "default" : "secondary"}>{a.status}</Badge>,
    }));
  }, [allotments, assetDisplayById]);

  useEffect(() => {
    if (!id) setLocation("/traders/licences");
  }, [id, setLocation]);

  useEffect(() => {
    if (!licence) return;
    setExemptCategoryId(licence.govtGstExemptCategoryId ?? "__none__");
    setNonGst(Boolean(licence.isNonGstEntity));
  }, [licence?.id, licence?.govtGstExemptCategoryId, licence?.isNonGstEntity]);

  const saveNonGstMutation = useMutation({
    mutationFn: async (isNonGstEntity: boolean) => {
      const res = await fetch(`/api/ioms/traders/licences/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isNonGstEntity }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data as Licence;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/traders/licences", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/traders/licences"] });
      toast({ title: "Licence updated", description: "Non-GST declaration saved." });
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const addStockMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ioms/traders/licences/${encodeURIComponent(id!)}/stock-openings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          commodityId: stockCommodityId,
          quantity: Number(stockQty),
          unit: stockUnit.trim(),
          effectiveDate: stockEffective.trim(),
          remarks: stockRemarks.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/traders/licences", id, "stock-openings"] });
      setStockQty("");
      setStockRemarks("");
      toast({ title: "Opening stock added" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteStockMutation = useMutation({
    mutationFn: async (openingId: string) => {
      const res = await fetch(`/api/ioms/traders/stock-openings/${encodeURIComponent(openingId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? res.statusText);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/traders/licences", id, "stock-openings"] });
      toast({ title: "Removed" });
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const stockRows = useMemo((): Record<string, unknown>[] => {
    return stockOpenings.map((s) => ({
      id: s.id,
      commodityName: commodityNameById[s.commodityId] ?? s.commodityId,
      quantity: s.quantity,
      unit: s.unit,
      effectiveDate: s.effectiveDate,
      _actions: (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Delete opening"
          onClick={() => deleteStockMutation.mutate(s.id)}
          disabled={deleteStockMutation.isPending}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      ),
    }));
  }, [stockOpenings, commodityNameById, deleteStockMutation.isPending]);

  const saveExemptMutation = useMutation({
    mutationFn: async (govtGstExemptCategoryId: string | null) => {
      const res = await fetch(`/api/ioms/traders/licences/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ govtGstExemptCategoryId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data as Licence;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/traders/licences", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/traders/licences"] });
      toast({ title: "Licence updated", description: "GST exemption category saved." });
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const returnQueryMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ioms/traders/licences/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          status: "Query",
          dvReturnRemarks: queryRemarksDraft.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data as Licence;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/traders/licences", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/traders/licences"] });
      setQueryDialogOpen(false);
      setQueryRemarksDraft("");
      toast({ title: "Returned for correction", description: "The applicant can update the application and resubmit." });
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const renewMutation = useMutation({
    mutationFn: async (args: { feeAmount?: number; validFrom?: string; validTo?: string }) => {
      const body: Record<string, unknown> = {};
      if (args.validFrom?.trim()) body.validFrom = args.validFrom.trim();
      if (args.validTo?.trim()) body.validTo = args.validTo.trim();
      if (args.feeAmount != null && Number.isFinite(args.feeAmount)) body.feeAmount = args.feeAmount;
      const res = await fetch(`/api/ioms/traders/licences/${encodeURIComponent(id!)}/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { message?: string; error?: string }).message ?? (data as { error?: string }).error ?? res.statusText);
      return data as Licence;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/traders/licences"] });
      setRenewDialogOpen(false);
      toast({ title: "Renewal created", description: "Draft renewal application created. Please review and submit." });
      setLocation(`/traders/licences/${row.id}/edit`);
    },
    onError: (e: Error) => toast({ title: "Renewal failed", description: e.message, variant: "destructive" }),
  });

  const canRenew = Boolean(canUpdateLicence && licenceIssued && licence && !licence.isBlocked);
  const canEditApplication =
    Boolean(canUpdateLicence && licence && !licenceIssued && !licence.isBlocked && licence.status !== "Rejected");
  const canReturnForQuery =
    Boolean(
      canUpdateLicence &&
        licence &&
        !licenceIssued &&
        !licence.isBlocked &&
        licence.status !== "Query" &&
        licence.status !== "Rejected",
    );

  if (!id) return null;
  if (isLoading || licence === undefined) {
    return (
      <AppShell breadcrumbs={[{ label: "Licences", href: "/traders/licences" }, { label: "Licence" }]}>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-8 w-48 mb-4" />
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      </AppShell>
    );
  }
  if (isError || !licence) {
    return (
      <AppShell breadcrumbs={[{ label: "Licences", href: "/traders/licences" }, { label: "Licence" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Licence not found.</span>
            <Button variant="outline" size="sm" onClick={() => setLocation("/traders/licences")}>Back</Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Licences", href: "/traders/licences" }, { label: licence.licenceNo ?? licence.firmName }]}>
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <FileCheck className="h-5 w-5" />
              {licence.licenceNo ?? licence.id} — {licence.firmName}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/traders/dues?unifiedId=${encodeURIComponent(`TA:${licence.id}`)}`}>
                  <Wallet className="h-4 w-4 mr-1" />
                  Outstanding dues
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/rent/ioms/ledger?unifiedEntityId=${encodeURIComponent(`TA:${licence.id}`)}`}>
                  <BookOpen className="h-4 w-4 mr-1" />
                  Ledger
                </Link>
              </Button>
              {canRenew ? (
                <Button variant="outline" size="sm" onClick={() => setRenewDialogOpen(true)} disabled={renewMutation.isPending}>
                  Renew
                </Button>
              ) : null}
              {canEditApplication ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/traders/licences/${licence.id}/edit`}>
                    <Pencil className="h-4 w-4 mr-1" />
                    Edit application
                  </Link>
                </Button>
              ) : null}
              {canReturnForQuery ? (
                <Button variant="secondary" size="sm" onClick={() => setQueryDialogOpen(true)}>
                  <MessageSquareWarning className="h-4 w-4 mr-1" />
                  Return for correction
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" onClick={() => setLocation("/traders/licences")}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm">
              <span className="text-muted-foreground">Application kind</span>
              <br />
              {licence.applicationKind ?? "New"}
              {licence.parentLicenceId ? (
                <>
                  {" "}
                  —{" "}
                  <Link href={`/traders/licences/${encodeURIComponent(licence.parentLicenceId)}`} className="text-primary hover:underline">
                    View parent
                  </Link>
                </>
              ) : null}
            </div>
            {licence.status === "Query" && licence.dvReturnRemarks ? (
              <Alert variant="destructive" className="border-amber-600/50 bg-amber-500/10">
                <MessageSquareWarning className="h-4 w-4" />
                <AlertTitle>Query — reviewer comments</AlertTitle>
                <AlertDescription className="whitespace-pre-wrap text-foreground">{licence.dvReturnRemarks}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Badge variant={licence.isBlocked ? "destructive" : licence.status === "Active" ? "default" : "secondary"}>
                {licence.isBlocked ? "Blocked" : licence.status}
              </Badge>
              <Badge variant="outline">{licence.licenceType}</Badge>
              {(licence.workflowRevisionCount ?? 0) > 0 ? (
                <Badge variant="outline">Resubmissions: {licence.workflowRevisionCount}</Badge>
              ) : null}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">Yard</span><br />{yardById[licence.yardId] ?? licence.yardId}</div>
              <div><span className="text-muted-foreground">Firm type</span><br />{licence.firmType ?? "—"}</div>
              <div><span className="text-muted-foreground">Contact</span><br />{licence.contactName ?? "—"}</div>
              <div><span className="text-muted-foreground">Mobile</span><br />{licence.mobile}</div>
              <div><span className="text-muted-foreground">Email</span><br />{licence.email ?? "—"}</div>
              <div><span className="text-muted-foreground">Address</span><br />{licence.address ?? "—"}</div>
              <div><span className="text-muted-foreground">PAN</span><br />{licence.pan ?? "—"}</div>
              <div><span className="text-muted-foreground">GSTIN</span><br />{licence.gstin ?? "—"}</div>
              {traderLicenceUsesBmSupplement(licence.licenceType) ? (
                <>
                  <div><span className="text-muted-foreground">Father / spouse (BM)</span><br />{licence.fatherSpouseName ?? "—"}</div>
                  <div><span className="text-muted-foreground">Date of birth (BM)</span><br />{formatYmdToDisplay(licence.dateOfBirth ?? "")}</div>
                  <div><span className="text-muted-foreground">Emergency mobile (BM)</span><br />{licence.emergencyContactMobile ?? "—"}</div>
                  <div><span className="text-muted-foreground">Character cert. issuer</span><br />{licence.characterCertIssuer ?? "—"}</div>
                  <div><span className="text-muted-foreground">Character cert. date</span><br />{formatYmdToDisplay(licence.characterCertDate ?? "")}</div>
                  <div className="sm:col-span-2">
                    <span className="text-muted-foreground">Supporting document (BM)</span>
                    <br />
                    {licence.bmFormDocUrl?.trim() ? (
                      <a
                        href={licence.bmFormDocUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline break-all"
                      >
                        {licence.bmFormDocUrl}
                      </a>
                    ) : (
                      "—"
                    )}
                  </div>
                  {licence.bmFormDocFile?.trim() ? (
                    <div className="sm:col-span-2">
                      <span className="text-muted-foreground">BM uploaded file</span>
                      <br />
                      <a
                        href={`/api/ioms/traders/licences/${encodeURIComponent(licence.id)}/bm-form-document`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline break-all"
                      >
                        Open supporting document
                      </a>
                    </div>
                  ) : null}
                </>
              ) : null}
              {licence.applicationKind === "Renewal" ? (
                <>
                  <div>
                    <span className="text-muted-foreground">BK — no-arrears declared</span>
                    <br />
                    {licence.renewalNoArrearsDeclared ? "Yes" : "No"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Parent fee snapshot (BK)</span>
                    <br />
                    {licence.parentLicenceFeeSnapshot != null && Number.isFinite(Number(licence.parentLicenceFeeSnapshot))
                      ? `₹${Number(licence.parentLicenceFeeSnapshot).toLocaleString()}`
                      : "—"}
                  </div>
                </>
              ) : null}
              <div><span className="text-muted-foreground">Aadhaar (masked)</span><br />{licence.aadhaarToken ?? "—"}</div>
              <div><span className="text-muted-foreground">Valid from</span><br />{formatYmdToDisplay(licence.validFrom ?? "")}</div>
              <div><span className="text-muted-foreground">Valid to</span><br />{formatYmdToDisplay(licence.validTo ?? "")}</div>
              <div><span className="text-muted-foreground">Fee amount</span><br />{licence.feeAmount != null ? `₹${licence.feeAmount}` : "—"}</div>
              <div><span className="text-muted-foreground">Receipt</span><br />{licence.receiptId ? (receiptById[licence.receiptId] ?? licence.receiptId) : "—"}</div>
              <div className="md:col-span-2">
                <span className="text-muted-foreground">Govt. GST exempt category (office/godown)</span>
                <br />
                {exemptCategoryName ?? (licence.govtGstExemptCategoryId ? licence.govtGstExemptCategoryId : "— (taxable)")}
              </div>
              <div>
                <span className="text-muted-foreground">Declared non-GST entity</span>
                <br />
                {licence.isNonGstEntity ? "Yes" : "No"}
              </div>
              {licence.isBlocked && licence.blockReason && (
                <div className="md:col-span-2"><span className="text-muted-foreground">Block reason</span><br /><span className="text-destructive">{licence.blockReason}</span></div>
              )}
            </div>
          </CardContent>
        </Card>

        {canUpdateLicence && (
          <Card>
            <CardHeader>
              <CardTitle>GST exemption (M-02 / M-03)</CardTitle>
              <p className="text-sm text-muted-foreground">
                If a category is set, rent invoices and linked receipts use zero CGST/SGST for this tenant licence per SRS Track B.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <Label>Exempt category</Label>
                <Select value={exemptCategoryId} onValueChange={setExemptCategoryId}>
                  <SelectTrigger className="max-w-md">
                    <SelectValue placeholder="Taxable (no exemption)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None (standard GST)</SelectItem>
                    {gstCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                disabled={
                  saveExemptMutation.isPending ||
                  exemptCategoryId === (licence.govtGstExemptCategoryId ?? "__none__")
                }
                onClick={() =>
                  saveExemptMutation.mutate(exemptCategoryId === "__none__" ? null : exemptCategoryId)
                }
              >
                {saveExemptMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save category"
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {canUpdateLicence && (
          <Card>
            <CardHeader>
              <CardTitle>Non-GST trader (M-03)</CardTitle>
              <p className="text-sm text-muted-foreground">
                Check if this trader is a declared non-GST entity (GSTIN optional). Tax treatment on receipts/rent aligns
                with exempt logic where configured.
              </p>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Checkbox id="lic-non-gst" checked={nonGst} onCheckedChange={(c) => setNonGst(c === true)} />
                <Label htmlFor="lic-non-gst" className="font-normal cursor-pointer">
                  Non-GST entity
                </Label>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={saveNonGstMutation.isPending || nonGst === Boolean(licence.isNonGstEntity)}
                onClick={() => saveNonGstMutation.mutate(nonGst)}
              >
                {saveNonGstMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save non-GST flag"}
              </Button>
            </CardContent>
          </Card>
        )}

        {canUpdateLicence && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Stock opening balance (M-02)
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Legacy opening quantities per commodity with effective date (client clarification).
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {stockLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <ClientDataGrid
                  columns={stockColumns}
                  sourceRows={stockRows}
                  searchKeys={["commodityName", "quantity", "unit", "effectiveDate"]}
                  searchPlaceholder="Search opening stock…"
                  defaultSortKey="effectiveDate"
                  defaultSortDir="desc"
                  resetPageDependency={id}
                  emptyMessage="No opening stock lines."
                />
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end border-t pt-4">
                <div className="space-y-2 sm:col-span-2">
                  <Label>Commodity</Label>
                  <Select value={stockCommodityId || "__pick__"} onValueChange={(v) => setStockCommodityId(v === "__pick__" ? "" : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select commodity" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__pick__">Select…</SelectItem>
                      {commodities.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Quantity</Label>
                  <Input value={stockQty} onChange={(e) => setStockQty(e.target.value)} inputMode="decimal" />
                </div>
                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Input value={stockUnit} onChange={(e) => setStockUnit(e.target.value)} placeholder="Quintal" />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Effective date</Label>
                  <Input type="date" value={stockEffective} onChange={(e) => setStockEffective(e.target.value)} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Remarks (optional)</Label>
                  <Input value={stockRemarks} onChange={(e) => setStockRemarks(e.target.value)} />
                </div>
                <Button
                  type="button"
                  disabled={
                    addStockMutation.isPending ||
                    !stockCommodityId ||
                    !stockEffective ||
                    !Number.isFinite(Number(stockQty))
                  }
                  onClick={() => addStockMutation.mutate()}
                >
                  Add opening line
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCheck className="h-5 w-5" />
              Premises allocations ({allotments.length})
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Premises (assets) allotted to this licence (equivalent to the Premises Allocation List in SRS).
            </p>
          </CardHeader>
          <CardContent>
            {allotments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No allotments found for this licence. You can add one from{" "}
                <Link href="/assets/allotments" className="text-primary hover:underline">
                  Shop Allotments
                </Link>
                .
              </p>
            ) : (
              <ClientDataGrid
                columns={allotmentColumns}
                sourceRows={allotmentRows}
                searchKeys={["assetDisplay", "allotteeName", "fromDate", "toDate", "status"]}
                searchPlaceholder="Search allotments…"
                defaultSortKey="fromDate"
                defaultSortDir="desc"
                resetPageDependency={id}
                emptyMessage="No allotments."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" />
              Blocking log ({blockingLog.length})
            </CardTitle>
            <p className="text-sm text-muted-foreground">Block / unblock history for this licence.</p>
          </CardHeader>
          <CardContent>
            {blockingLog.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No blocking log entries. <Link href="/traders/blocking-log" className="text-primary hover:underline">Add entry</Link> from Blocking log page.</p>
            ) : (
              <ClientDataGrid
                columns={blockingColumns}
                sourceRows={blockingRows}
                searchKeys={["action", "reason", "actionedBy", "actionedAt"]}
                searchPlaceholder="Search blocking log…"
                defaultSortKey="actionedAt"
                defaultSortDir="desc"
                resetPageDependency={id}
                emptyMessage="No blocking log entries."
              />
            )}
          </CardContent>
        </Card>

        <Dialog
          open={renewDialogOpen}
          onOpenChange={(o) => {
            setRenewDialogOpen(o);
            if (!o) {
              setRenewFeeDraft("");
              setRenewValidFrom("");
              setRenewValidTo("");
            }
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Renew licence (Form BK)</DialogTitle>
            </DialogHeader>
            {renewPreviewLoading ? (
              <div className="py-6 text-sm text-muted-foreground">Loading fee preview…</div>
            ) : renewPreview ? (
              <div className="space-y-4 text-sm">
                <Alert>
                  <AlertTitle className="text-base">Draft renewal fee</AlertTitle>
                  <AlertDescription className="text-foreground space-y-2">
                    <p>
                      Default for the new Draft:{" "}
                      <span className="font-semibold tabular-nums">₹{Number(renewPreview.defaultRenewalFee).toLocaleString()}</span>
                      {renewPreview.resolutionSource === "parent_licence_fee" ? (
                        <> (from this licence&apos;s current fee)</>
                      ) : (
                        <> (from system <span className="font-mono">licence_fee</span> — parent had no fee)</>
                      )}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Parent fee:{" "}
                      {renewPreview.parentFeeAmount != null
                        ? `₹${Number(renewPreview.parentFeeAmount).toLocaleString()}`
                        : "—"}
                      {" · "}
                      Config <span className="font-mono">licence_fee</span>: ₹
                      {Number(renewPreview.systemLicenceFee).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">{renewPreview.resolutionNote}</p>
                    <p className="text-xs text-muted-foreground">
                      After fee is collected at the counter, record it in M-05 and link the receipt to this renewal when
                      submitting.{" "}
                      <Link href="/receipts/ioms" className="text-primary font-medium hover:underline">
                        IOMS receipts register
                      </Link>
                      .
                    </p>
                  </AlertDescription>
                </Alert>
                <div className="space-y-1">
                  <Label>Renewal fee (₹) for Draft</Label>
                  <Input
                    value={renewFeeDraft}
                    onChange={(e) => setRenewFeeDraft(e.target.value)}
                    inputMode="decimal"
                    placeholder="Adjust if needed"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Valid from (optional)</Label>
                    <Input type="date" value={renewValidFrom} onChange={(e) => setRenewValidFrom(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Valid to (optional)</Label>
                    <Input type="date" value={renewValidTo} onChange={(e) => setRenewValidTo(e.target.value)} />
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-destructive">Could not load preview.</p>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setRenewDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={renewMutation.isPending || renewPreviewLoading || !renewPreview}
                onClick={() => {
                  const feeRaw = renewFeeDraft.trim();
                  let feeAmount: number | undefined;
                  if (feeRaw !== "") {
                    const n = Number(feeRaw);
                    if (!Number.isFinite(n) || n < 0) {
                      toast({ title: "Invalid fee", description: "Enter a non-negative number or leave blank for server default.", variant: "destructive" });
                      return;
                    }
                    feeAmount = n;
                  }
                  renewMutation.mutate({
                    feeAmount,
                    validFrom: renewValidFrom,
                    validTo: renewValidTo,
                  });
                }}
              >
                {renewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Draft renewal"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={queryDialogOpen} onOpenChange={setQueryDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Return application for correction</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              The status will be set to <strong>Query</strong> and the applicant can edit all fields and resubmit. Add
              clear instructions below (required).
            </p>
            <Textarea
              value={queryRemarksDraft}
              onChange={(e) => setQueryRemarksDraft(e.target.value)}
              rows={5}
              placeholder="What needs to be corrected or clarified…"
              className="min-h-[120px]"
            />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setQueryDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={returnQueryMutation.isPending || !queryRemarksDraft.trim()}
                onClick={() => returnQueryMutation.mutate()}
              >
                {returnQueryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send back"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
