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
import { FileCheck, ArrowLeft, AlertCircle, ShieldAlert, Loader2, Trash2, Package, Pencil, MessageSquareWarning, Wallet, BookOpen, Plus } from "lucide-react";
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
import { LocalSearchSelect } from "@/components/ui/local-search-select";
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
import { TRADER_LICENCE_CRUD_DISABLED, TRADER_LICENCE_CRUD_DISABLED_MESSAGE } from "@shared/trader-licence-crud";
import {
  AssetAllotmentManageDialog,
  type ManagedAssetAllotment,
} from "@/components/assets/AssetAllotmentManageDialog";
import { formatInr } from "@/lib/formatInr";
import { govtGstCategoriesForSelect } from "@/lib/govtGstExemptSelect";
import { invalidateAssetAllotmentQueries } from "@/lib/invalidate-asset-allotments";
import { invalidatePremisesRegisterQueries } from "@/lib/premisesRegisterCache";
import { PaymentPreferenceForm } from "@/components/payments/PaymentPreferenceForm";
import {
  buildCounterDuesPaymentApiBody,
  defaultPaymentPreferenceValue,
  validatePaymentPreference,
  type PaymentPreferenceValue,
} from "@/lib/duesCounterPayment";
import { downloadIomsReceiptPdf } from "@/lib/downloadIomsReceiptPdf";
import { inferAgreementTypeFromDates, localCalendarYmd, RENT_REVISION_MODES } from "@shared/premises-allocation";
import { buildAssetDisplayByRowId, formatPremisesAssetLabel } from "@/lib/asset-premises-display";
import {
  PREMISES_ALLOCATION_COLUMNS,
  PREMISES_ALLOCATION_SEARCH_KEYS,
  allocationApprovalBadge,
  allocationTenancyBadge,
  formatAllocationMoney,
} from "@/lib/premises-allocation-table";

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
  provisionalLicenceNo?: string | null;
  applicationSerial?: string | null;
  entityPublicCode?: string | null;
  bmUndertakingAccepted?: boolean | null;
  commodities?: string[] | null;
  lmStatus?: string | null;
  lmIsActive?: boolean | null;
  lmLicenseClass?: string | null;
  lmSyncedAt?: string | null;
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
  isActive?: boolean;
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
  yardId?: string;
  assetType?: string | null;
  area?: string | null;
}
interface VacantAssetRow {
  asset: AssetRef;
}
type AssetAllotmentRow = ManagedAssetAllotment;

function agreementTypeLabel(code: string | null | undefined): string {
  if (code === "RentalAgreement") return "Rental (≤11 mo approx.)";
  if (code === "LeaseAgreement") return "Lease (>11 mo)";
  return "—";
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
  const { can, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canUpdateLicence = can("M-02", "Update");
  const canCreateAllotment = can("M-02", "Create");
  const [exemptCategoryId, setExemptCategoryId] = useState<string>("__none__");
  const [nonGst, setNonGst] = useState(false);
  const [stockCommodityId, setStockCommodityId] = useState<string>("");
  const [stockQty, setStockQty] = useState("");
  const [stockUnit, setStockUnit] = useState("");
  const [stockEffective, setStockEffective] = useState("");
  const [stockRemarks, setStockRemarks] = useState("");
  const [queryDialogOpen, setQueryDialogOpen] = useState(false);
  const [queryRemarksDraft, setQueryRemarksDraft] = useState("");
  const [renewDialogOpen, setRenewDialogOpen] = useState(false);
  const [renewFeeDraft, setRenewFeeDraft] = useState("");
  const [renewValidFrom, setRenewValidFrom] = useState("");
  const [renewValidTo, setRenewValidTo] = useState("");
  const [manageAllotment, setManageAllotment] = useState<AssetAllotmentRow | null>(null);
  const [allotDialogOpen, setAllotDialogOpen] = useState(false);
  const [allotAssetId, setAllotAssetId] = useState("");
  const [allotAllotmentDate, setAllotAllotmentDate] = useState("");
  const [allotRefNo, setAllotRefNo] = useState("");
  const [allotFromDate, setAllotFromDate] = useState("");
  const [allotToDate, setAllotToDate] = useState("");
  const [allotMonthlyRent, setAllotMonthlyRent] = useState("");
  const [allotRentRevisionMode, setAllotRentRevisionMode] = useState("StandardConsecutiveRenewal");
  const [allotConsecutiveRenewalCount, setAllotConsecutiveRenewalCount] = useState("0");
  const [allotSecurityDeposit, setAllotSecurityDeposit] = useState("");
  const [allotSecurityDepositPayment, setAllotSecurityDepositPayment] = useState<PaymentPreferenceValue>(() =>
    defaultPaymentPreferenceValue(),
  );
  const [allotAgreementTypeOverride, setAllotAgreementTypeOverride] = useState("__auto__");

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
  const { data: vacantRows = [] } = useQuery<VacantAssetRow[]>({
    queryKey: ["/api/ioms/assets/vacant"],
    enabled: allotDialogOpen,
    queryFn: async () => {
      const res = await fetch("/api/ioms/assets/vacant", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load vacant premises");
      return res.json();
    },
  });
  const vacantAssets = useMemo(() => vacantRows.map((r) => r.asset), [vacantRows]);
  const vacantByAssetPk = useMemo(() => Object.fromEntries(vacantRows.map((r) => [r.asset.id, r])), [vacantRows]);

  useEffect(() => {
    if (!allotDialogOpen) return;
    setAllotAllotmentDate((prev) => prev || localCalendarYmd());
  }, [allotDialogOpen]);

  useEffect(() => {
    if (!allotDialogOpen) return;
    setAllotSecurityDepositPayment(defaultPaymentPreferenceValue());
  }, [allotDialogOpen]);

  useEffect(() => {
    if (!allotDialogOpen) return;
    const n = Number(allotSecurityDeposit);
    if (!Number.isFinite(n) || n <= 0) return;
    setAllotSecurityDepositPayment((p) => ({ ...p, paidAmount: String(Math.round(n * 100) / 100) }));
  }, [allotSecurityDeposit, allotDialogOpen]);

  const selectedVacant = allotAssetId ? vacantByAssetPk[allotAssetId] : undefined;
  const receivedByLabel = user?.name ? `${user.name} (Logged in user)` : "Logged in user";
  const allotSecDepAmount = allotSecurityDeposit.trim() ? Number(allotSecurityDeposit) : 0;
  const showAllotSecDepPayment = Number.isFinite(allotSecDepAmount) && allotSecDepAmount > 0;
  const inferredAgType =
    allotFromDate && allotToDate ? inferAgreementTypeFromDates(allotFromDate, allotToDate) : null;
  const licenceCanReceiveAllotment = Boolean(
    licence && licence.status === "Active" && !licence.isBlocked,
  );
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
  const vacantPremiseOptions = useMemo(
    () =>
      vacantAssets.map((a) => ({
        value: a.id,
        label: [
          a.assetId,
          a.yardId && yardById[a.yardId] ? yardById[a.yardId] : null,
          a.assetType || null,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    [vacantAssets, yardById],
  );
  const allotReceivedAtLabel = useMemo(() => {
    const yardId = selectedVacant?.asset?.yardId;
    if (!yardId) return "—";
    return yardById[yardId] ?? yardId;
  }, [selectedVacant?.asset?.yardId, yardById]);
  const receiptById = Object.fromEntries(receipts.map((r) => [r.id, r.receiptNo]));
  const assetDisplayById = useMemo(() => buildAssetDisplayByRowId(assets), [assets]);
  const gstCategoriesForSelect = useMemo(
    () => govtGstCategoriesForSelect(gstCategories, licence?.govtGstExemptCategoryId ?? null),
    [gstCategories, licence?.govtGstExemptCategoryId],
  );
  const exemptCategoryName =
    licence?.govtGstExemptCategoryId != null
      ? gstCategoriesForSelect.find((c) => c.id === licence.govtGstExemptCategoryId)?.name
      : undefined;

  const commodityNameById = useMemo(
    () => Object.fromEntries(commodities.map((c) => [c.id, c.name])),
    [commodities],
  );

  const activeCommodities = useMemo(
    () => commodities.filter((c) => c.isActive !== false),
    [commodities],
  );

  const commodityIdsAlreadyOpen = useMemo(
    () => new Set(stockOpenings.map((s) => s.commodityId)),
    [stockOpenings],
  );

  const commoditiesAvailableForNewOpening = useMemo(
    () => activeCommodities.filter((c) => !commodityIdsAlreadyOpen.has(c.id)),
    [activeCommodities, commodityIdsAlreadyOpen],
  );

  useEffect(() => {
    if (stockCommodityId && commodityIdsAlreadyOpen.has(stockCommodityId)) {
      setStockCommodityId("");
    }
  }, [stockCommodityId, commodityIdsAlreadyOpen]);

  useEffect(() => {
    if (!stockCommodityId) {
      setStockUnit("");
      return;
    }
    const c = commodities.find((x) => x.id === stockCommodityId);
    setStockUnit((c?.unit ?? "").trim());
  }, [stockCommodityId, commodities]);

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
    return (allotments ?? []).map((a) => {
      const appr = String(a.approvalStatus ?? "Draft");
      return {
        id: a.id,
        assetDisplay: formatPremisesAssetLabel(a.assetId, assetDisplayById, a.premisesRefNo),
        allotteeName: a.allotteeName,
        fromDate: a.fromDate,
        toDate: a.toDate,
        status: a.status,
        approvalStatus: appr,
        monthlyRent: formatAllocationMoney(a.monthlyRent),
        securityDeposit: formatAllocationMoney(a.securityDeposit),
        premisesRef: a.premisesRefNo?.trim() ? a.premisesRefNo : "—",
        _approval: allocationApprovalBadge(appr),
        _tenancy: allocationTenancyBadge(a.status),
        _actions: canUpdateLicence ? (
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => setManageAllotment(a)}>
            <Pencil className="h-4 w-4" />
            <span className="sr-only">Edit allotment</span>
          </Button>
        ) : null,
      };
    });
  }, [allotments, assetDisplayById, canUpdateLicence]);

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

  const createAllotmentMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/asset-allotments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string; error?: string }).message ?? (err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: async (data) => {
      invalidateAssetAllotmentQueries(queryClient);
      invalidatePremisesRegisterQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/receipts"] });
      if (id) {
        queryClient.invalidateQueries({
          queryKey: [`/api/ioms/asset-allotments?traderLicenceId=${encodeURIComponent(id)}`],
        });
      }

      const receipt = data?.securityDepositReceipt as { receiptId?: string; receiptNo?: string } | null | undefined;
      let description = "Upload the agreement copy (PDF), then DV verifies and DA approves.";
      if (receipt?.receiptId && receipt?.receiptNo) {
        try {
          await downloadIomsReceiptPdf(receipt.receiptId, receipt.receiptNo);
          description = `Security deposit receipt ${receipt.receiptNo} issued and downloaded. ${description}`;
        } catch {
          description = `Security deposit receipt ${receipt.receiptNo} issued. Open Receipts to download the PDF if needed. ${description}`;
        }
      }

      toast({
        title: "Draft allocation created",
        description,
      });
      setAllotDialogOpen(false);
      setAllotAssetId("");
      setAllotAllotmentDate("");
      setAllotRefNo("");
      setAllotFromDate("");
      setAllotToDate("");
      setAllotMonthlyRent("");
      setAllotSecurityDeposit("");
      setAllotSecurityDepositPayment(defaultPaymentPreferenceValue());
      setAllotConsecutiveRenewalCount("0");
      setAllotAgreementTypeOverride("__auto__");
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
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
          unit: stockUnit,
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
      setStockCommodityId("");
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

  const canRenew = Boolean(
    !TRADER_LICENCE_CRUD_DISABLED && canUpdateLicence && licenceIssued && licence && !licence.isBlocked,
  );
  const canEditApplication = Boolean(
    !TRADER_LICENCE_CRUD_DISABLED &&
      canUpdateLicence &&
      licence &&
      !licenceIssued &&
      !licence.isBlocked &&
      licence.status !== "Rejected",
  );
  const canReturnForQuery = Boolean(
    !TRADER_LICENCE_CRUD_DISABLED &&
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
            {TRADER_LICENCE_CRUD_DISABLED ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>License Manager owns licence master data</AlertTitle>
                <AlertDescription>{TRADER_LICENCE_CRUD_DISABLED_MESSAGE}</AlertDescription>
              </Alert>
            ) : null}
            <div className="text-sm">
              <span className="text-muted-foreground">Application serial</span>
              <br />
              <span className="font-mono">{licence.applicationSerial?.trim() || "—"}</span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Provisional licence ref.</span>
              <br />
              <span className="font-mono break-all">{licence.provisionalLicenceNo?.trim() || "—"}</span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Public entity code (ENT)</span>
              <br />
              <span className="font-mono">{licence.entityPublicCode?.trim() || "—"}</span>
            </div>
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
                      ? `${formatInr(Number(licence.parentLicenceFeeSnapshot))}`
                      : "—"}
                  </div>
                </>
              ) : null}
              <div><span className="text-muted-foreground">Aadhaar (masked)</span><br />{licence.aadhaarToken ?? "—"}</div>
              <div>
                <span className="text-muted-foreground">Valid from</span>
                <br />
                {formatYmdToDisplay(licence.validFrom ?? "")}
                {licence.lmSyncedAt ? <span className="ml-1 text-xs text-muted-foreground">(LM)</span> : null}
              </div>
              <div>
                <span className="text-muted-foreground">Valid to</span>
                <br />
                {formatYmdToDisplay(licence.validTo ?? "")}
                {licence.lmSyncedAt ? <span className="ml-1 text-xs text-muted-foreground">(LM)</span> : null}
              </div>
              {licence.lmSyncedAt ? (
                <>
                  <div>
                    <span className="text-muted-foreground">License Manager</span>
                    <br />
                    <Badge variant={licence.lmIsActive ? "default" : "secondary"}>
                      {licence.lmIsActive ? "LM active" : "LM inactive"}
                      {licence.lmLicenseClass ? ` · Class ${licence.lmLicenseClass}` : ""}
                    </Badge>
                    {licence.lmStatus ? (
                      <span className="ml-2 text-xs text-muted-foreground">{licence.lmStatus}</span>
                    ) : null}
                  </div>
                  <div className="md:col-span-2">
                    <span className="text-muted-foreground">LM commodities</span>
                    <br />
                    {Array.isArray(licence.commodities) && licence.commodities.length > 0
                      ? licence.commodities.join(", ")
                      : "—"}
                  </div>
                </>
              ) : null}
              <div><span className="text-muted-foreground">Fee amount</span><br />{licence.feeAmount != null ? formatInr(licence.feeAmount) : "—"}</div>
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
                    {gstCategoriesForSelect.map((c) => (
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
                  <Select
                    value={stockCommodityId || "__pick__"}
                    onValueChange={(v) => setStockCommodityId(v === "__pick__" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select commodity" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__pick__">Select…</SelectItem>
                      {commoditiesAvailableForNewOpening.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {commoditiesAvailableForNewOpening.length === 0 && activeCommodities.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Every active commodity already has an opening line for this licence. Remove a line to add it again
                      with a new quantity or date.
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label>Quantity</Label>
                  <Input value={stockQty} onChange={(e) => setStockQty(e.target.value)} inputMode="decimal" />
                </div>
                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Input
                    readOnly
                    tabIndex={-1}
                    value={stockUnit}
                    placeholder={stockCommodityId ? "No unit on commodity master" : "Select commodity first"}
                    className="bg-muted cursor-not-allowed"
                    title="Unit comes from the commodity master and cannot be edited here."
                  />
                  {stockCommodityId && !stockUnit ? (
                    <p className="text-xs text-destructive">
                      This commodity has no unit configured. Set it under Commodities (M-04) before adding opening stock.
                    </p>
                  ) : null}
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
                    !stockUnit.trim() ||
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
          <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileCheck className="h-5 w-5" />
                Premises allocations ({allotments.length})
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Premises allotted to this licence. Traders may be allocated at any yard when the licence is Active and
                the premises is vacant. Use <strong>Edit</strong> to upload the agreement and run DV/DA approval;
                Approved sets tenancy to Active.
              </p>
            </div>
            {canCreateAllotment && (
              <Button
                size="sm"
                variant="outline"
                disabled={!licenceCanReceiveAllotment}
                title={
                  licenceCanReceiveAllotment
                    ? "Add a new premises allocation (draft)"
                    : "Licence must be Active and not blocked to add an allocation"
                }
                onClick={() => setAllotDialogOpen(true)}
              >
                <Plus className="h-4 w-4 mr-1" /> Add allotment
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <ClientDataGrid
              columns={PREMISES_ALLOCATION_COLUMNS}
              sourceRows={allotmentRows}
              searchKeys={PREMISES_ALLOCATION_SEARCH_KEYS}
              searchPlaceholder="Search allotments…"
              defaultSortKey="fromDate"
              defaultSortDir="desc"
              resetPageDependency={id}
              emptyMessage="No allotments yet. Use Add allotment to create a draft allocation."
            />
          </CardContent>
        </Card>

        <Dialog open={allotDialogOpen} onOpenChange={setAllotDialogOpen}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New premises allocation (draft)</DialogTitle>
              <p className="text-sm text-muted-foreground">
                Select vacant premises at any yard in your scope. Tenancy becomes Active only after DA approval.
              </p>
            </DialogHeader>
            {!licenceCanReceiveAllotment ? (
              <Alert variant="destructive">
                <AlertTitle>Licence not eligible</AlertTitle>
                <AlertDescription>
                  Only an <strong>Active</strong>, unblocked trader licence can receive a new premises allocation.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2 space-y-1">
                  <Label>Vacant premises *</Label>
                  <LocalSearchSelect
                    value={allotAssetId}
                    onValueChange={setAllotAssetId}
                    options={vacantPremiseOptions}
                    placeholder="Select premises"
                    searchPlaceholder="Type premises id, yard, or type…"
                    emptyMessage="No matching vacant premises."
                    required
                  />
                  {vacantAssets.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No vacant premises in your yard scope.</p>
                  ) : null}
                  {selectedVacant?.asset ? (
                    <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
                      <div>
                        <span className="font-medium text-foreground">Premises type:</span>{" "}
                        {selectedVacant.asset.assetType?.trim() || "—"}
                      </div>
                      {selectedVacant.asset.area?.trim() ? (
                        <div>
                          <span className="font-medium text-foreground">Area:</span> {selectedVacant.asset.area}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="md:col-span-2 space-y-1">
                  <Label>Allottee name</Label>
                  <Input
                    value={(licence?.firmName ?? licence?.contactName ?? "").trim()}
                    readOnly
                    className="bg-muted/50"
                  />
                  <p className="text-xs text-muted-foreground">Taken from this licence.</p>
                </div>
                <div className="space-y-1">
                  <Label>Allotment date *</Label>
                  <Input type="date" value={allotAllotmentDate} onChange={(e) => setAllotAllotmentDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Allotment reference no.</Label>
                  <Input value={allotRefNo} onChange={(e) => setAllotRefNo(e.target.value)} placeholder="Optional" />
                </div>
                <div className="space-y-1">
                  <Label>Agreement from *</Label>
                  <Input type="date" value={allotFromDate} onChange={(e) => setAllotFromDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Agreement to *</Label>
                  <Input type="date" value={allotToDate} onChange={(e) => setAllotToDate(e.target.value)} />
                </div>
                <div className="md:col-span-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">Inferred agreement kind: </span>
                  <span className="font-medium text-foreground">
                    {inferredAgType ? agreementTypeLabel(inferredAgType) : "Pick both dates"}
                  </span>
                </div>
                <div className="space-y-1">
                  <Label>Agreement type override</Label>
                  <Select value={allotAgreementTypeOverride} onValueChange={setAllotAgreementTypeOverride}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">Auto from dates</SelectItem>
                      <SelectItem value="RentalAgreement">Rental agreement</SelectItem>
                      <SelectItem value="LeaseAgreement">Lease agreement</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Monthly Rent (Rs.) *</Label>
                  <Input
                    value={allotMonthlyRent}
                    onChange={(e) => setAllotMonthlyRent(e.target.value)}
                    inputMode="decimal"
                    placeholder="> 0"
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label>Rent revision mode *</Label>
                  <Select value={allotRentRevisionMode} onValueChange={setAllotRentRevisionMode}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RENT_REVISION_MODES.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m === "StandardConsecutiveRenewal" ? "Standard consecutive renewal" : "PWD certificate basis"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Consecutive renewal count</Label>
                  <Input
                    value={allotConsecutiveRenewalCount}
                    onChange={(e) => setAllotConsecutiveRenewalCount(e.target.value)}
                    inputMode="numeric"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Security deposit (₹)</Label>
                  <Input
                    value={allotSecurityDeposit}
                    onChange={(e) => setAllotSecurityDeposit(e.target.value)}
                    inputMode="decimal"
                  />
                </div>
                {showAllotSecDepPayment ? (
                  <div className="md:col-span-2 rounded-md border p-3 bg-muted/20">
                    <p className="text-sm font-medium mb-2">Security deposit payment</p>
                    <p className="text-xs text-muted-foreground mb-3">
                      Record how the deposit was received. A paid receipt is issued immediately when you create the draft.
                    </p>
                    <PaymentPreferenceForm
                      value={allotSecurityDepositPayment}
                      onChange={setAllotSecurityDepositPayment}
                      receivedByLabel={receivedByLabel}
                      receivedAtLabel={allotReceivedAtLabel}
                      summaryAmount={String(allotSecDepAmount)}
                    />
                  </div>
                ) : null}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAllotDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={
                  !licenceCanReceiveAllotment ||
                  createAllotmentMutation.isPending ||
                  !allotAssetId ||
                  !allotAllotmentDate ||
                  !allotFromDate ||
                  !allotToDate ||
                  !Number.isFinite(Number(allotMonthlyRent)) ||
                  Number(allotMonthlyRent) <= 0
                }
                onClick={() => {
                  const allotteeName = (licence?.firmName ?? licence?.contactName ?? "").trim();
                  if (!allotteeName) {
                    toast({ title: "Allottee name required", variant: "destructive" });
                    return;
                  }
                  const body: Record<string, unknown> = {
                    assetId: allotAssetId,
                    traderLicenceId: id,
                    allotteeName,
                    allotmentDate: allotAllotmentDate,
                    fromDate: allotFromDate,
                    toDate: allotToDate,
                    status: "Pending",
                    approvalStatus: "Draft",
                    monthlyRent: Number(allotMonthlyRent),
                    rentRevisionMode: allotRentRevisionMode,
                    consecutiveRenewalCount: Number(allotConsecutiveRenewalCount) || 0,
                    securityDeposit: allotSecurityDeposit.trim() ? Number(allotSecurityDeposit) : null,
                  };
                  if (allotAgreementTypeOverride !== "__auto__") body.agreementType = allotAgreementTypeOverride;
                  if (allotRefNo.trim()) body.premisesRefNo = allotRefNo.trim();
                  const secAmt = allotSecurityDeposit.trim() ? Number(allotSecurityDeposit) : 0;
                  if (Number.isFinite(secAmt) && secAmt > 0) {
                    const pref = { ...allotSecurityDepositPayment, paidAmount: allotSecurityDeposit };
                    const prefErr = validatePaymentPreference(pref);
                    if (prefErr) {
                      toast({ title: "Security deposit payment", description: prefErr, variant: "destructive" });
                      return;
                    }
                    Object.assign(body, buildCounterDuesPaymentApiBody(pref, secAmt));
                  }
                  createAllotmentMutation.mutate(body);
                }}
              >
                {createAllotmentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create draft"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AssetAllotmentManageDialog
          row={manageAllotment}
          onClose={() => setManageAllotment(null)}
          onRowUpdated={setManageAllotment}
          assetDisplayMap={assetDisplayById}
          invalidateVacant={false}
        />

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
                      <span className="font-semibold tabular-nums">{formatInr(Number(renewPreview.defaultRenewalFee))}</span>
                      {renewPreview.resolutionSource === "parent_licence_fee" ? (
                        <> (from this licence&apos;s current fee)</>
                      ) : (
                        <> (from system <span className="font-mono">licence_fee</span> — parent had no fee)</>
                      )}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Parent fee:{" "}
                      {renewPreview.parentFeeAmount != null
                        ? `${formatInr(Number(renewPreview.parentFeeAmount))}`
                        : "—"}
                      {" · "}
                      Config <span className="font-mono">licence_fee</span>: {formatInr(renewPreview.systemLicenceFee)}
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
