import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { FileCheck, AlertCircle, PlusCircle } from "lucide-react";
import { formatInr } from "@/lib/formatInr";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useScopedActiveYards } from "@/hooks/useScopedActiveYards";

interface AmcContract {
  id: string;
  yardId: string;
  contractorName: string;
  description?: string | null;
  amountPerPeriod: number;
  periodType?: string | null;
  contractStart: string;
  contractEnd: string;
  status: string;
  daUser?: string | null;
}

interface AmcRenewalAlert {
  contractId: string;
  contractorName: string;
  contractEnd: string;
  daysRemaining: number;
  urgency: "overdue" | "30d" | "60d";
}

const PERIOD_TYPES = ["Monthly", "Quarterly", "Annual"] as const;

export default function ConstructionAmc() {
  const { can } = useAuth();
  const canCreate = can("M-08", "Create");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [yardId, setYardId] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [formYardId, setFormYardId] = useState("");
  const [contractorName, setContractorName] = useState("");
  const [description, setDescription] = useState("");
  const [amountPerPeriod, setAmountPerPeriod] = useState("");
  const [periodType, setPeriodType] = useState<string>("Annual");
  const [contractStart, setContractStart] = useState("");
  const [contractEnd, setContractEnd] = useState("");

  const params = new URLSearchParams();
  if (yardId && yardId !== "all") params.set("yardId", yardId);
  const url = params.toString() ? `/api/ioms/amc?${params.toString()}` : "/api/ioms/amc";

  const { data: list = [], isLoading, isError } = useQuery<AmcContract[]>({ queryKey: [url] });
  const { data: yards = [] } = useScopedActiveYards();
  const yardById = useMemo(() => new Map(yards.map((y) => [y.id, y.name ?? y.code ?? y.id])), [yards]);

  const columns = useMemo(
    (): ReportTableColumn[] => [
      { key: "yardName", header: "Yard" },
      { key: "contractorName", header: "Contractor" },
      { key: "periodType", header: "Period type" },
      { key: "contractStart", header: "Start" },
      { key: "contractEnd", header: "End" },
      { key: "_amountPerPeriod", header: "Amount/period", sortField: "amountPerPeriod" },
      { key: "_status", header: "Status", sortField: "status" },
    ],
    [],
  );

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return list.map((a) => ({
      id: a.id,
      yardName: yardById.get(a.yardId) ?? a.yardId,
      contractorName: a.contractorName,
      periodType: a.periodType ?? "—",
      contractStart: a.contractStart.slice(0, 10),
      contractEnd: a.contractEnd.slice(0, 10),
      amountPerPeriod: a.amountPerPeriod,
      _amountPerPeriod: `${formatInr(a.amountPerPeriod)}`,
      status: a.status,
      _status: <Badge variant="secondary">{a.status}</Badge>,
    }));
  }, [list, yardById]);

  const alertsUrl =
    yardId && yardId !== "all"
      ? `/api/ioms/amc/renewal-alerts?yardId=${encodeURIComponent(yardId)}`
      : "/api/ioms/amc/renewal-alerts";
  const { data: amcAlertsPayload } = useQuery<{ alerts: AmcRenewalAlert[] }>({ queryKey: [alertsUrl] });
  const amcAlerts = amcAlertsPayload?.alerts ?? [];
  const overdueAmc = amcAlerts.filter((a) => a.urgency === "overdue").length;

  const resetForm = () => {
    setFormYardId("");
    setContractorName("");
    setDescription("");
    setAmountPerPeriod("");
    setPeriodType("Annual");
    setContractStart("");
    setContractEnd("");
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const amount = Number(amountPerPeriod);
      if (!formYardId) throw new Error("Yard is required");
      if (!contractorName.trim()) throw new Error("Contractor name is required");
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount per period must be greater than zero");
      if (!contractStart.trim() || !contractEnd.trim()) throw new Error("Contract start and end dates are required");
      if (contractEnd < contractStart) throw new Error("Contract end must be on or after start date");
      const res = await fetch("/api/ioms/amc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          yardId: formYardId,
          contractorName: contractorName.trim(),
          description: description.trim() || null,
          amountPerPeriod: amount,
          periodType,
          contractStart: contractStart.trim(),
          contractEnd: contractEnd.trim(),
          status: "Active",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [url] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/amc"] });
      queryClient.invalidateQueries({ queryKey: [alertsUrl] });
      toast({ title: "AMC registered", description: "New AMC contract created." });
      setCreateOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }, { label: "AMC" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load AMC contracts.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }, { label: "AMC contracts" }]}>
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <FileCheck className="h-5 w-5" />
              AMC contracts
            </CardTitle>
            <p className="text-sm text-muted-foreground">Annual / periodic maintenance contracts by yard.</p>
            {amcAlerts.length > 0 && (
              <Alert variant={overdueAmc > 0 ? "destructive" : "default"} className="mt-3">
                <AlertTitle>Contract end reminders</AlertTitle>
                <AlertDescription>
                  {amcAlerts.length} active AMC contract(s) ending within 60 days or overdue
                  {overdueAmc > 0 ? ` (${overdueAmc} overdue).` : "."}
                </AlertDescription>
              </Alert>
            )}
            <div className="pt-2">
              <Label>Yard</Label>
              <Select value={yardId} onValueChange={setYardId}>
                <SelectTrigger className="w-[200px] mt-1">
                  <SelectValue placeholder="All yards" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All yards</SelectItem>
                  {yards.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.name ?? y.code ?? y.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {canCreate ? (
            <Button
              type="button"
              className="shrink-0"
              onClick={() => {
                resetForm();
                if (yardId !== "all") setFormYardId(yardId);
                setCreateOpen(true);
              }}
            >
              <PlusCircle className="h-4 w-4 mr-2" />
              Register new AMC
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["yardName", "contractorName", "periodType", "contractStart", "contractEnd", "status"]}
              defaultSortKey="contractEnd"
              defaultSortDir="desc"
              emptyMessage="No AMC contracts."
              resetPageDependency={url}
            />
          )}
        </CardContent>
      </Card>

      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Register new AMC</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Yard *</Label>
              <Select value={formYardId || undefined} onValueChange={setFormYardId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select yard" />
                </SelectTrigger>
                <SelectContent>
                  {yards.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.name ?? y.code ?? y.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Contractor *</Label>
              <Input value={contractorName} onChange={(e) => setContractorName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Scope / description</Label>
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Bill period *</Label>
                <Select value={periodType} onValueChange={setPeriodType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERIOD_TYPES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Amount / period (₹) *</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={amountPerPeriod}
                  onChange={(e) => setAmountPerPeriod(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Start date *</Label>
                <Input type="date" value={contractStart} onChange={(e) => setContractStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>End date *</Label>
                <Input type="date" value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Save AMC"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
