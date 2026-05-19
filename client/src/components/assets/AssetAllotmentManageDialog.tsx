import { useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth, type AuthUser } from "@/context/AuthContext";
import { Loader2, ExternalLink, FileText } from "lucide-react";
import { localCalendarYmd, RENT_REVISION_MODES } from "@shared/premises-allocation";
import { invalidateAssetAllotmentQueries } from "@/lib/invalidate-asset-allotments";

export interface ManagedAssetAllotment {
  id: string;
  assetId: string;
  traderLicenceId: string;
  allotteeName: string;
  fromDate: string;
  toDate: string;
  status: string;
  securityDeposit?: number | null;
  doUser?: string | null;
  daUser?: string | null;
  approvalStatus?: string | null;
  monthlyRent?: number | null;
  rentRevisionMode?: string | null;
  agreementDocFile?: string | null;
  premisesRefNo?: string | null;
}

function userTierSet(user: AuthUser | null): Set<string> {
  return new Set((user?.roles ?? []).map((r) => String(r.tier ?? "").trim()).filter(Boolean));
}

export function AssetAllotmentManageDialog({
  row,
  onClose,
  onRowUpdated,
  assetDisplayMap,
  invalidateVacant = true,
}: {
  row: ManagedAssetAllotment | null;
  onClose: () => void;
  onRowUpdated: (r: ManagedAssetAllotment) => void;
  assetDisplayMap: Record<string, string>;
  /** When false, skip invalidating /api/ioms/assets/vacant (e.g. if parent does not use vacant list). */
  invalidateVacant?: boolean;
}) {
  const gapCheckboxId = useId();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, can } = useAuth();
  const tiers = useMemo(() => userTierSet(user ?? null), [user]);
  const canUpdate = can("M-02", "Update");

  const [mAllottee, setMAllottee] = useState("");
  const [mFrom, setMFrom] = useState("");
  const [mTo, setMTo] = useState("");
  const [mRent, setMRent] = useState("");
  const [mRevMode, setMRevMode] = useState("");
  const [mReject, setMReject] = useState("");
  const [mDvReturn, setMDvReturn] = useState("");
  const [mGapOv, setMGapOv] = useState(false);
  const [agreementFile, setAgreementFile] = useState<File | null>(null);
  const [tenancyVacateOn, setTenancyVacateOn] = useState("");

  useEffect(() => {
    const r = row;
    if (!r) return;
    setMAllottee(r.allotteeName ?? "");
    setMFrom(r.fromDate ?? "");
    setMTo(r.toDate ?? "");
    setMRent(r.monthlyRent != null ? String(r.monthlyRent) : "");
    setMRevMode(String(r.rentRevisionMode ?? "StandardConsecutiveRenewal"));
    setMReject("");
    setMDvReturn("");
    setMGapOv(false);
    setAgreementFile(null);
    const to = String(r.toDate ?? "").slice(0, 10);
    const today = localCalendarYmd();
    setTenancyVacateOn(to && to <= today ? to : today);
  }, [row]);

  const afterMutation = (next: ManagedAssetAllotment) => {
    invalidateAssetAllotmentQueries(queryClient);
    if (invalidateVacant) {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/assets/vacant"] });
    }
    onRowUpdated(next);
    toast({ title: "Saved" });
  };

  const patchAllotMutation = useMutation({
    mutationFn: async ({ allocId, body }: { allocId: string; body: Record<string, unknown> }) => {
      const res = await fetch(`/api/ioms/asset-allotments/${encodeURIComponent(allocId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return (await res.json()) as ManagedAssetAllotment;
    },
    onSuccess: (next) => afterMutation(next),
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const uploadAgreementMutation = useMutation({
    mutationFn: async ({ allocId, file }: { allocId: string; file: File }) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/ioms/asset-allotments/${encodeURIComponent(allocId)}/agreement`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return (await res.json()) as ManagedAssetAllotment;
    },
    onSuccess: (next) => {
      invalidateAssetAllotmentQueries(queryClient);
      if (invalidateVacant) {
        queryClient.invalidateQueries({ queryKey: ["/api/ioms/assets/vacant"] });
      }
      onRowUpdated(next);
      setAgreementFile(null);
      toast({ title: "Agreement uploaded" });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const manageRow = row;

  return (
    <Dialog
      open={Boolean(manageRow)}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        {!manageRow ? null : (
          <>
            <DialogHeader>
              <DialogTitle>Manage shop allotment</DialogTitle>
              <p className="text-sm text-muted-foreground font-mono">
                {assetDisplayMap[manageRow.assetId] ?? manageRow.assetId}
                {manageRow.premisesRefNo?.trim() ? ` · ${manageRow.premisesRefNo}` : ""}
              </p>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2 items-center">
                <Badge variant="secondary">{String(manageRow.approvalStatus ?? "Draft")}</Badge>
                <Badge variant="outline">{manageRow.status}</Badge>
                {manageRow.agreementDocFile ? (
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={`/api/ioms/asset-allotments/${encodeURIComponent(manageRow.id)}/agreement`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1" />
                      Agreement PDF
                    </a>
                  </Button>
                ) : (
                  <span className="text-muted-foreground flex items-center gap-1">
                    <FileText className="h-4 w-4" /> No PDF uploaded
                  </span>
                )}
              </div>

              {["Draft", "Rejected"].includes(String(manageRow.approvalStatus ?? "")) &&
              (tiers.has("DO") || tiers.has("ADMIN")) ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t pt-3">
                  <div className="md:col-span-2 space-y-1">
                    <Label>Allottee name</Label>
                    <Input value={mAllottee} onChange={(e) => setMAllottee(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Agreement from</Label>
                    <Input type="date" value={mFrom} onChange={(e) => setMFrom(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Agreement to</Label>
                    <Input
                      type="date"
                      value={mTo}
                      onChange={(e) => setMTo(e.target.value)}
                      max={manageRow.status === "Vacated" ? localCalendarYmd() : undefined}
                    />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label>Monthly rent</Label>
                    <Input value={mRent} onChange={(e) => setMRent(e.target.value)} inputMode="decimal" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label>Rent revision mode</Label>
                    <Select value={mRevMode} onValueChange={setMRevMode}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RENT_REVISION_MODES.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m === "StandardConsecutiveRenewal" ? "Standard" : "PWD Certificate"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={
                        patchAllotMutation.isPending ||
                        !Number.isFinite(Number(mRent)) ||
                        Number(mRent) <= 0 ||
                        !mAllottee.trim()
                      }
                      onClick={() => {
                        if (manageRow.status === "Vacated" && mTo > localCalendarYmd()) {
                          toast({
                            title: "Invalid vacated date",
                            description: "Vacated on must be today or an earlier date.",
                            variant: "destructive",
                          });
                          return;
                        }
                        patchAllotMutation.mutate({
                          allocId: manageRow.id,
                          body: {
                            allotteeName: mAllottee.trim(),
                            fromDate: mFrom,
                            toDate: mTo,
                            monthlyRent: Number(mRent),
                            rentRevisionMode: mRevMode,
                          },
                        });
                      }}
                    >
                      {patchAllotMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save draft fields"}
                    </Button>
                  </div>
                </div>
              ) : null}

              {["Draft", "Rejected"].includes(String(manageRow.approvalStatus ?? "")) &&
              (tiers.has("DO") || tiers.has("ADMIN")) ? (
                <div className="border-t pt-3 space-y-2">
                  <Label>Upload notarised agreement (PDF)</Label>
                  <Input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setAgreementFile(e.target.files?.[0] ?? null)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={uploadAgreementMutation.isPending || !agreementFile}
                    onClick={() => agreementFile && uploadAgreementMutation.mutate({ allocId: manageRow.id, file: agreementFile })}
                  >
                    {uploadAgreementMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Upload PDF"}
                  </Button>
                </div>
              ) : null}

              {String(manageRow.approvalStatus ?? "") === "Draft" &&
              manageRow.agreementDocFile &&
              (tiers.has("DV") || tiers.has("ADMIN")) ? (
                <div className="border-t pt-3">
                  <Button
                    type="button"
                    size="sm"
                    disabled={patchAllotMutation.isPending}
                    onClick={() =>
                      patchAllotMutation.mutate({
                        allocId: manageRow.id,
                        body: { approvalStatus: "Verified" },
                      })
                    }
                  >
                    Mark verified (DV)
                  </Button>
                </div>
              ) : null}

              {String(manageRow.approvalStatus ?? "") === "Verified" && (tiers.has("DV") || tiers.has("ADMIN")) ? (
                <div className="border-t pt-3 space-y-2">
                  <Label>Return to draft (DV)</Label>
                  <Textarea value={mDvReturn} onChange={(e) => setMDvReturn(e.target.value)} rows={2} placeholder="Minimum 5 characters" />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={patchAllotMutation.isPending || mDvReturn.trim().length < 5}
                    onClick={() =>
                      patchAllotMutation.mutate({
                        allocId: manageRow.id,
                        body: { approvalStatus: "Draft", dvReturnRemarks: mDvReturn.trim() },
                      })
                    }
                  >
                    Return to DO
                  </Button>
                </div>
              ) : null}

              {String(manageRow.approvalStatus ?? "") === "Verified" && (tiers.has("DA") || tiers.has("ADMIN")) ? (
                <div className="border-t pt-3 space-y-3">
                  <div className="flex items-start gap-3">
                    <Checkbox id={gapCheckboxId} checked={mGapOv} onCheckedChange={(c) => setMGapOv(c === true)} />
                    <Label htmlFor={gapCheckboxId} className="cursor-pointer text-xs leading-snug">
                      I acknowledge overriding the calendar-gap rule versus the prior vacated agreement (DA only).
                    </Label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={patchAllotMutation.isPending}
                      onClick={() =>
                        patchAllotMutation.mutate({
                          allocId: manageRow.id,
                          body: { approvalStatus: "Approved", agreementGapDaOverride: mGapOv },
                        })
                      }
                    >
                      Approve allocation
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={patchAllotMutation.isPending || mReject.trim().length < 3}
                      onClick={() =>
                        patchAllotMutation.mutate({
                          allocId: manageRow.id,
                          body: { approvalStatus: "Rejected", rejectionRemarks: mReject.trim() },
                        })
                      }
                    >
                      Reject
                    </Button>
                  </div>
                  <div className="space-y-1">
                    <Label>Rejection remarks (for Reject)</Label>
                    <Textarea value={mReject} onChange={(e) => setMReject(e.target.value)} rows={2} />
                  </div>
                </div>
              ) : null}

              {String(manageRow.approvalStatus ?? "") === "Rejected" && (tiers.has("DO") || tiers.has("ADMIN")) ? (
                <div className="border-t pt-3">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={patchAllotMutation.isPending}
                    onClick={() =>
                      patchAllotMutation.mutate({
                        allocId: manageRow.id,
                        body: { approvalStatus: "Draft" },
                      })
                    }
                  >
                    Resubmit as draft (DO)
                  </Button>
                </div>
              ) : null}

              {String(manageRow.approvalStatus ?? "") === "Approved" &&
              ["Active", "Vacating"].includes(manageRow.status) &&
              canUpdate ? (
                <div className="border-t pt-3 space-y-2">
                  <div className="space-y-1">
                    <Label>Vacated on</Label>
                    <Input
                      type="date"
                      max={localCalendarYmd()}
                      value={tenancyVacateOn}
                      onChange={(e) => setTenancyVacateOn(e.target.value)}
                    />
                  </div>
                  <Label>Tenancy status</Label>
                  <Select
                    value={manageRow.status}
                    onValueChange={(v) => {
                      const cur = manageRow.status;
                      if (v === cur) return;
                      const ok =
                        (cur === "Active" && (v === "Vacating" || v === "Vacated")) ||
                        (cur === "Vacating" && v === "Vacated");
                      if (!ok) return;
                      if (v === "Vacated") {
                        const today = localCalendarYmd();
                        if (tenancyVacateOn > today) {
                          toast({
                            title: "Invalid vacated date",
                            description: "Vacated on must be today or an earlier date.",
                            variant: "destructive",
                          });
                          return;
                        }
                        patchAllotMutation.mutate({
                          allocId: manageRow.id,
                          body: { status: v, toDate: tenancyVacateOn },
                        });
                      } else {
                        patchAllotMutation.mutate({ allocId: manageRow.id, body: { status: v } });
                      }
                    }}
                  >
                    <SelectTrigger className="max-w-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {manageRow.status === "Active" ? (
                        <>
                          <SelectItem value="Active">Active</SelectItem>
                          <SelectItem value="Vacating">Vacating</SelectItem>
                          <SelectItem value="Vacated">Vacated</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="Vacating">Vacating</SelectItem>
                          <SelectItem value="Vacated">Vacated</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    When marked Vacated, the premises appears on Shop Vacant. Vacated date must be today or earlier.
                  </p>
                </div>
              ) : null}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
