import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { FileCheck, ArrowLeft, AlertCircle, ShieldAlert, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface Licence {
  id: string;
  licenceNo?: string | null;
  firmName: string;
  firmType?: string | null;
  yardId: string;
  contactName?: string | null;
  mobile: string;
  email?: string | null;
  address?: string | null;
  licenceType: string;
  feeAmount?: number | null;
  receiptId?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  status: string;
  isBlocked?: boolean;
  blockReason?: string | null;
  doUser?: string | null;
  dvUser?: string | null;
  daUser?: string | null;
  govtGstExemptCategoryId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
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

export default function TraderLicenceDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { can } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canUpdateLicence = can("M-02", "Update");
  const [exemptCategoryId, setExemptCategoryId] = useState<string>("__none__");

  const { data: licence, isLoading, isError } = useQuery<Licence>({
    queryKey: ["/api/ioms/traders/licences", id],
    enabled: !!id,
  });
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
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));
  const receiptById = Object.fromEntries(receipts.map((r) => [r.id, r.receiptNo]));
  const exemptCategoryName =
    licence?.govtGstExemptCategoryId != null
      ? gstCategories.find((c) => c.id === licence.govtGstExemptCategoryId)?.name
      : undefined;

  useEffect(() => {
    if (!id) setLocation("/traders/licences");
  }, [id, setLocation]);

  useEffect(() => {
    if (!licence) return;
    setExemptCategoryId(licence.govtGstExemptCategoryId ?? "__none__");
  }, [licence?.id, licence?.govtGstExemptCategoryId]);

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
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileCheck className="h-5 w-5" />
              {licence.licenceNo ?? licence.id} — {licence.firmName}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setLocation("/traders/licences")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant={licence.isBlocked ? "destructive" : licence.status === "Active" ? "default" : "secondary"}>
                {licence.isBlocked ? "Blocked" : licence.status}
              </Badge>
              <Badge variant="outline">{licence.licenceType}</Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">Yard</span><br />{yardById[licence.yardId] ?? licence.yardId}</div>
              <div><span className="text-muted-foreground">Firm type</span><br />{licence.firmType ?? "—"}</div>
              <div><span className="text-muted-foreground">Contact</span><br />{licence.contactName ?? "—"}</div>
              <div><span className="text-muted-foreground">Mobile</span><br />{licence.mobile}</div>
              <div><span className="text-muted-foreground">Email</span><br />{licence.email ?? "—"}</div>
              <div><span className="text-muted-foreground">Address</span><br />{licence.address ?? "—"}</div>
              <div><span className="text-muted-foreground">Valid from</span><br />{licence.validFrom ?? "—"}</div>
              <div><span className="text-muted-foreground">Valid to</span><br />{licence.validTo ?? "—"}</div>
              <div><span className="text-muted-foreground">Fee amount</span><br />{licence.feeAmount != null ? `₹${licence.feeAmount}` : "—"}</div>
              <div><span className="text-muted-foreground">Receipt</span><br />{licence.receiptId ? (receiptById[licence.receiptId] ?? licence.receiptId) : "—"}</div>
              <div className="md:col-span-2">
                <span className="text-muted-foreground">Govt. GST exempt category (office/godown)</span>
                <br />
                {exemptCategoryName ?? (licence.govtGstExemptCategoryId ? licence.govtGstExemptCategoryId : "— (taxable)")}
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Actioned by</TableHead>
                    <TableHead>Actioned at</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blockingLog.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell><Badge variant={e.action === "Blocked" ? "destructive" : "default"}>{e.action}</Badge></TableCell>
                      <TableCell>{e.reason}</TableCell>
                      <TableCell>{e.actionedBy}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{e.actionedAt}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
