import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatInr } from "@/lib/formatInr";
import { apiRequest, fetchApiGet } from "@/lib/queryClient";
import {
  AlertCircle,
  Mic,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
} from "lucide-react";

type SessionStatus = "Open" | "Submitted" | "Abandoned";

interface VoiceLine {
  seq: number;
  commodityId: string | null;
  commodityName: string;
  quantity: number;
  unit: string;
  ratePerUnit: number;
  farmerName: string;
  placeOfPurchase: string;
  totalValue: number;
  confirmed: boolean;
}

interface SessionListRow {
  id: string;
  traderLicenceId: string;
  yardId: string;
  status: SessionStatus;
  mobileVerified: boolean;
  licenceClass: string | null;
  linesJson: VoiceLine[];
  totalPurchaseValue: number;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  firmName: string | null;
  licenceNo: string | null;
  mobile: string | null;
  lineCount: number;
}

interface SessionDetail extends SessionListRow {}

interface VerifyResult {
  verified: boolean;
  traderLicenceId: string;
  licenceNo: string;
  firmName: string;
  contactName: string | null;
  yardId: string;
  licenceType: string | null;
  licenceClass: string | null;
  mobile: string | null;
  primaryCommodities: string[];
}

interface CommodityRef {
  id: string;
  name: string;
  unit?: string | null;
}

const emptyLineForm = {
  commodityId: "",
  quantity: "",
  unit: "Quintal",
  ratePerUnit: "",
  farmerName: "",
  placeOfPurchase: "",
};

function statusBadge(status: SessionStatus) {
  if (status === "Open") return <Badge variant="default">Open</Badge>;
  if (status === "Submitted") return <Badge className="bg-emerald-600 hover:bg-emerald-600">Submitted</Badge>;
  return <Badge variant="secondary">Abandoned</Badge>;
}

function errMessage(e: unknown): string {
  if (!(e instanceof Error)) return "Request failed";
  const m = e.message;
  const jsonStart = m.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(m.slice(jsonStart)) as { message?: string; error?: string };
      return parsed.message || parsed.error || m;
    } catch {
      /* fall through */
    }
  }
  return m.replace(/^\d+:\s*/, "");
}

export default function TraderVoiceSessions() {
  const { can } = useAuth();
  const canRead = can("M-04", "Read");
  const canCreate = can("M-04", "Create");
  const { toast } = useToast();
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<string>("Open");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [newOpen, setNewOpen] = useState(false);
  const [licenceNo, setLicenceNo] = useState("");
  const [mobile, setMobile] = useState("");
  const [verified, setVerified] = useState<VerifyResult | null>(null);

  const [lineForm, setLineForm] = useState(emptyLineForm);
  const [editingSeq, setEditingSeq] = useState<number | null>(null);
  const [editForm, setEditForm] = useState(emptyLineForm);

  const listKey = ["/api/ioms/market/voice-sessions", { status: statusFilter }] as const;

  const {
    data: listData,
    isLoading: listLoading,
    isError: listError,
    error: listErr,
    refetch: refetchList,
    isFetching: listFetching,
  } = useQuery<{ count: number; rows: SessionListRow[] }>({
    queryKey: listKey,
    enabled: canRead,
    queryFn: async () => {
      const u = new URL("/api/ioms/market/voice-sessions", window.location.origin);
      if (statusFilter && statusFilter !== "all") u.searchParams.set("status", statusFilter);
      return fetchApiGet(u.pathname + u.search);
    },
  });

  const {
    data: session,
    isLoading: sessionLoading,
    refetch: refetchSession,
  } = useQuery<SessionDetail>({
    queryKey: ["/api/ioms/market/voice-sessions", selectedId],
    enabled: canRead && !!selectedId,
    queryFn: () => fetchApiGet(`/api/ioms/market/voice-sessions/${selectedId}`),
  });

  const { data: commodities = [] } = useQuery<CommodityRef[]>({
    queryKey: ["/api/ioms/commodities"],
    enabled: canRead && (!!selectedId || newOpen),
  });

  const commodityById = useMemo(() => {
    const m = new Map<string, CommodityRef>();
    for (const c of commodities) m.set(c.id, c);
    return m;
  }, [commodities]);

  const lines = useMemo(() => (Array.isArray(session?.linesJson) ? session!.linesJson : []), [session]);

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["/api/ioms/market/voice-sessions"] });
    if (selectedId) await refetchSession();
  };

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ioms/market/voice-sessions/verify", {
        licenceNo: licenceNo.trim(),
        mobile: mobile.trim(),
      });
      return (await res.json()) as VerifyResult;
    },
    onSuccess: (data) => {
      setVerified(data);
      toast({ title: "Trader verified", description: `${data.firmName} (${data.licenceNo})` });
    },
    onError: (e) => toast({ title: "Verify failed", description: errMessage(e), variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!verified) throw new Error("Verify trader first");
      const res = await apiRequest("POST", "/api/ioms/market/voice-sessions", {
        traderLicenceId: verified.traderLicenceId,
        licenceClass: verified.licenceClass,
      });
      return (await res.json()) as SessionDetail;
    },
    onSuccess: async (row) => {
      toast({ title: "Session opened" });
      setNewOpen(false);
      setLicenceNo("");
      setMobile("");
      setVerified(null);
      setStatusFilter("Open");
      setSelectedId(row.id);
      await invalidate();
    },
    onError: (e) => toast({ title: "Could not open session", description: errMessage(e), variant: "destructive" }),
  });

  const addLineMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("No session");
      const res = await apiRequest("POST", `/api/ioms/market/voice-sessions/${selectedId}/lines`, {
        commodityId: lineForm.commodityId,
        quantity: Number(lineForm.quantity),
        unit: lineForm.unit,
        ratePerUnit: Number(lineForm.ratePerUnit),
        farmerName: lineForm.farmerName.trim(),
        placeOfPurchase: lineForm.placeOfPurchase.trim(),
        confirmed: true,
      });
      return res.json();
    },
    onSuccess: async () => {
      toast({ title: "Line added" });
      setLineForm(emptyLineForm);
      await invalidate();
    },
    onError: (e) => toast({ title: "Add line failed", description: errMessage(e), variant: "destructive" }),
  });

  const updateLineMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId || editingSeq == null) throw new Error("No line");
      const res = await apiRequest("PUT", `/api/ioms/market/voice-sessions/${selectedId}/lines/${editingSeq}`, {
        commodityId: editForm.commodityId || undefined,
        quantity: Number(editForm.quantity),
        unit: editForm.unit,
        ratePerUnit: Number(editForm.ratePerUnit),
        farmerName: editForm.farmerName.trim(),
        placeOfPurchase: editForm.placeOfPurchase.trim(),
        confirmed: true,
      });
      return res.json();
    },
    onSuccess: async () => {
      toast({ title: "Line updated" });
      setEditingSeq(null);
      await invalidate();
    },
    onError: (e) => toast({ title: "Update failed", description: errMessage(e), variant: "destructive" }),
  });

  const deleteLineMutation = useMutation({
    mutationFn: async (seq: number) => {
      if (!selectedId) throw new Error("No session");
      const res = await apiRequest("DELETE", `/api/ioms/market/voice-sessions/${selectedId}/lines/${seq}`);
      return res.json();
    },
    onSuccess: async () => {
      toast({ title: "Line removed" });
      await invalidate();
    },
    onError: (e) => toast({ title: "Delete failed", description: errMessage(e), variant: "destructive" }),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("No session");
      const res = await apiRequest("POST", `/api/ioms/market/voice-sessions/${selectedId}/submit`, {});
      return res.json();
    },
    onSuccess: async (data: { createdTransactionIds?: string[] }) => {
      const n = data?.createdTransactionIds?.length ?? 0;
      toast({
        title: "Session submitted",
        description: n ? `${n} purchase transaction(s) created (Approved).` : "Submitted.",
      });
      setStatusFilter("Submitted");
      await invalidate();
    },
    onError: (e) => toast({ title: "Submit failed", description: errMessage(e), variant: "destructive" }),
  });

  const abandonMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("No session");
      const res = await apiRequest("POST", `/api/ioms/market/voice-sessions/${selectedId}/abandon`, {});
      return res.json();
    },
    onSuccess: async () => {
      toast({ title: "Session abandoned" });
      await invalidate();
    },
    onError: (e) => toast({ title: "Abandon failed", description: errMessage(e), variant: "destructive" }),
  });

  const startEdit = (line: VoiceLine) => {
    setEditingSeq(line.seq);
    setEditForm({
      commodityId: line.commodityId || "",
      quantity: String(line.quantity),
      unit: line.unit,
      ratePerUnit: String(line.ratePerUnit),
      farmerName: line.farmerName,
      placeOfPurchase: line.placeOfPurchase,
    });
  };

  if (!canRead) {
    return (
      <AppShell>
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">M-04 Read permission required.</CardContent>
        </Card>
      </AppShell>
    );
  }

  const rows = listData?.rows ?? [];
  const isOpen = session?.status === "Open";

  return (
    <AppShell>
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Mic className="h-5 w-5" />
                AI calling / voice sessions
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Verify trader (licence + mobile), capture draft purchase lines, then submit to create Approved
                transactions (same flow as the voice transcript).
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/market/voice-transcript-script">Sample scripts</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/market/trader-transaction-report">Transaction report</Link>
              </Button>
              <Button variant="outline" size="sm" onClick={() => refetchList()} disabled={listFetching}>
                <RefreshCw className={`h-4 w-4 mr-2 ${listFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              {canCreate && (
                <Button
                  size="sm"
                  onClick={() => {
                    setVerified(null);
                    setLicenceNo("");
                    setMobile("");
                    setNewOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  New session
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1 w-40">
                <Label>Status</Label>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="Open">Open</SelectItem>
                    <SelectItem value="Submitted">Submitted</SelectItem>
                    <SelectItem value="Abandoned">Abandoned</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {listError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {errMessage(listErr)}
              </div>
            )}

            {listLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6">No voice sessions for this filter.</p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Opened</TableHead>
                      <TableHead>Trader</TableHead>
                      <TableHead>Licence</TableHead>
                      <TableHead>Lines</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow
                        key={r.id}
                        className={selectedId === r.id ? "bg-muted/50" : undefined}
                        data-testid={`voice-session-row-${r.id}`}
                      >
                        <TableCell className="whitespace-nowrap text-xs">
                          {r.createdAt?.slice(0, 16).replace("T", " ")}
                        </TableCell>
                        <TableCell className="max-w-[180px] truncate">{r.firmName || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{r.licenceNo || "—"}</TableCell>
                        <TableCell>{r.lineCount}</TableCell>
                        <TableCell className="text-right">{formatInr(r.totalPurchaseValue)}</TableCell>
                        <TableCell>{statusBadge(r.status)}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => setSelectedId(r.id)}>
                            Manage
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {selectedId && (
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="text-base">Session detail</CardTitle>
                {session && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {session.firmName} · {session.licenceNo}
                    {session.mobile ? ` · ${session.mobile}` : ""}
                    {session.licenceClass ? ` · class ${session.licenceClass}` : ""}
                  </p>
                )}
                <p className="text-xs font-mono text-muted-foreground mt-1">{selectedId}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {session && statusBadge(session.status)}
                {canCreate && isOpen && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => {
                        if (!confirm("Submit all confirmed lines as Approved purchase transactions?")) return;
                        submitMutation.mutate();
                      }}
                      disabled={submitMutation.isPending || lines.length === 0}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Submit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (!confirm("Abandon this open session? Lines will not be posted.")) return;
                        abandonMutation.mutate();
                      }}
                      disabled={abandonMutation.isPending}
                    >
                      Abandon
                    </Button>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {sessionLoading || !session ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <>
                  <div className="text-sm">
                    Total purchase value: <strong>{formatInr(session.totalPurchaseValue)}</strong>
                    {session.submittedAt && (
                      <span className="text-muted-foreground ml-2">
                        · submitted {session.submittedAt.slice(0, 16).replace("T", " ")}
                      </span>
                    )}
                  </div>

                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>#</TableHead>
                          <TableHead>Commodity</TableHead>
                          <TableHead>Qty</TableHead>
                          <TableHead>Rate</TableHead>
                          <TableHead>Farmer</TableHead>
                          <TableHead>Place</TableHead>
                          <TableHead className="text-right">Value</TableHead>
                          {canCreate && isOpen && <TableHead />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="text-muted-foreground text-sm">
                              No lines yet. Add a purchase line below (voice transcript capture step).
                            </TableCell>
                          </TableRow>
                        ) : (
                          lines.map((l) => (
                            <TableRow key={l.seq}>
                              <TableCell>{l.seq}</TableCell>
                              <TableCell>{l.commodityName}</TableCell>
                              <TableCell>
                                {l.quantity} {l.unit}
                              </TableCell>
                              <TableCell>{formatInr(l.ratePerUnit)}</TableCell>
                              <TableCell>{l.farmerName}</TableCell>
                              <TableCell>{l.placeOfPurchase}</TableCell>
                              <TableCell className="text-right">{formatInr(l.totalValue)}</TableCell>
                              {canCreate && isOpen && (
                                <TableCell className="whitespace-nowrap">
                                  <Button size="icon" variant="ghost" onClick={() => startEdit(l)} title="Edit">
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => {
                                      if (!confirm(`Remove line ${l.seq}?`)) return;
                                      deleteLineMutation.mutate(l.seq);
                                    }}
                                    title="Delete"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              )}
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  {canCreate && isOpen && (
                    <div className="rounded-md border p-4 space-y-3">
                      <p className="text-sm font-medium">Add purchase line</p>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="space-y-1">
                          <Label>Commodity</Label>
                          <Select
                            value={lineForm.commodityId || undefined}
                            onValueChange={(id) => {
                              const c = commodityById.get(id);
                              const unit =
                                c?.unit != null && String(c.unit).trim() !== ""
                                  ? String(c.unit).trim()
                                  : lineForm.unit || "Quintal";
                              setLineForm((f) => ({ ...f, commodityId: id, unit }));
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select commodity" />
                            </SelectTrigger>
                            <SelectContent>
                              {commodities.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {(c.name ?? c.id).slice(0, 64)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label>Quantity</Label>
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={lineForm.quantity}
                            onChange={(e) => setLineForm((f) => ({ ...f, quantity: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Unit</Label>
                          <Input
                            value={lineForm.unit}
                            onChange={(e) => setLineForm((f) => ({ ...f, unit: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Rate / unit</Label>
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={lineForm.ratePerUnit}
                            onChange={(e) => setLineForm((f) => ({ ...f, ratePerUnit: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Farmer name</Label>
                          <Input
                            value={lineForm.farmerName}
                            onChange={(e) => setLineForm((f) => ({ ...f, farmerName: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Place of purchase</Label>
                          <Input
                            value={lineForm.placeOfPurchase}
                            onChange={(e) => setLineForm((f) => ({ ...f, placeOfPurchase: e.target.value }))}
                          />
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => addLineMutation.mutate()}
                        disabled={addLineMutation.isPending}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add line
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog
        open={newOpen}
        onOpenChange={(o) => {
          setNewOpen(o);
          if (!o) {
            setVerified(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New voice session</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Step 1 — verify licence number and registered mobile (transcript verify step).
            </p>
            <div className="space-y-1">
              <Label>Licence number</Label>
              <Input value={licenceNo} onChange={(e) => setLicenceNo(e.target.value)} placeholder="e.g. TL-…" />
            </div>
            <div className="space-y-1">
              <Label>Mobile</Label>
              <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="Registered mobile" />
            </div>
            {verified && (
              <div className="rounded-md bg-muted p-3 text-sm space-y-1">
                <p className="font-medium">{verified.firmName}</p>
                <p className="text-muted-foreground">
                  {verified.licenceNo}
                  {verified.licenceClass ? ` · class ${verified.licenceClass}` : ""}
                </p>
                {verified.primaryCommodities?.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Commodities: {verified.primaryCommodities.slice(0, 8).join(", ")}
                    {verified.primaryCommodities.length > 8 ? "…" : ""}
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => verifyMutation.mutate()}
              disabled={!licenceNo.trim() || !mobile.trim() || verifyMutation.isPending}
            >
              Verify
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!verified || createMutation.isPending}
            >
              Open session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editingSeq != null} onOpenChange={(o) => !o && setEditingSeq(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit line {editingSeq}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Commodity</Label>
              <Select
                value={editForm.commodityId || undefined}
                onValueChange={(id) => {
                  const c = commodityById.get(id);
                  const unit =
                    c?.unit != null && String(c.unit).trim() !== ""
                      ? String(c.unit).trim()
                      : editForm.unit;
                  setEditForm((f) => ({ ...f, commodityId: id, unit }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select commodity" />
                </SelectTrigger>
                <SelectContent>
                  {commodities.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {(c.name ?? c.id).slice(0, 64)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Quantity</Label>
                <Input
                  type="number"
                  value={editForm.quantity}
                  onChange={(e) => setEditForm((f) => ({ ...f, quantity: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Unit</Label>
                <Input
                  value={editForm.unit}
                  onChange={(e) => setEditForm((f) => ({ ...f, unit: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Rate / unit</Label>
              <Input
                type="number"
                value={editForm.ratePerUnit}
                onChange={(e) => setEditForm((f) => ({ ...f, ratePerUnit: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Farmer name</Label>
              <Input
                value={editForm.farmerName}
                onChange={(e) => setEditForm((f) => ({ ...f, farmerName: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Place of purchase</Label>
              <Input
                value={editForm.placeOfPurchase}
                onChange={(e) => setEditForm((f) => ({ ...f, placeOfPurchase: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSeq(null)}>
              Cancel
            </Button>
            <Button onClick={() => updateLineMutation.mutate()} disabled={updateLineMutation.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
