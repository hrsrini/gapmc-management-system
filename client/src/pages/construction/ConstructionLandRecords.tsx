import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, AlertCircle, PlusCircle } from "lucide-react";
import { formatYmdToDisplay } from "@/lib/dateFormat";
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

interface LandRecord {
  id: string;
  yardId: string;
  surveyNo: string;
  village?: string | null;
  taluk?: string | null;
  district?: string | null;
  areaSqm?: number | null;
  saleDeedNo?: string | null;
  saleDeedDate?: string | null;
  encumbrance?: string | null;
  remarks?: string | null;
  createdBy: string;
  createdAt: string;
}

export default function ConstructionLandRecords() {
  const { can } = useAuth();
  const canCreate = can("M-08", "Create");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [yardId, setYardId] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [formYardId, setFormYardId] = useState("");
  const [surveyNo, setSurveyNo] = useState("");
  const [village, setVillage] = useState("");
  const [taluk, setTaluk] = useState("");
  const [district, setDistrict] = useState("");
  const [areaSqm, setAreaSqm] = useState("");
  const [saleDeedNo, setSaleDeedNo] = useState("");
  const [saleDeedDate, setSaleDeedDate] = useState("");
  const [encumbrance, setEncumbrance] = useState("Free");
  const [remarks, setRemarks] = useState("");

  const params = new URLSearchParams();
  if (yardId && yardId !== "all") params.set("yardId", yardId);
  const url = params.toString() ? `/api/ioms/land-records?${params.toString()}` : "/api/ioms/land-records";

  const { data: list = [], isLoading, isError } = useQuery<LandRecord[]>({ queryKey: [url] });
  const { data: yards = [] } = useScopedActiveYards();
  const yardById = useMemo(() => new Map(yards.map((y) => [y.id, y.name ?? y.code ?? y.id])), [yards]);

  const columns = useMemo(
    (): ReportTableColumn[] => [
      { key: "surveyNo", header: "Survey no" },
      { key: "yardName", header: "Yard" },
      { key: "village", header: "Village" },
      { key: "taluk", header: "Taluk" },
      { key: "_areaSqm", header: "Area (sqm)", sortField: "areaSqm" },
      { key: "saleDeedSummary", header: "Sale deed" },
      { key: "createdAt", header: "Created" },
    ],
    [],
  );

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return list.map((r) => {
      const saleDeedSummary = [r.saleDeedNo ?? "", r.saleDeedDate ? formatYmdToDisplay(r.saleDeedDate) : ""]
        .filter(Boolean)
        .join(" ")
        .trim() || "—";
      return {
        id: r.id,
        surveyNo: r.surveyNo,
        yardName: yardById.get(r.yardId) ?? r.yardId,
        village: r.village ?? "—",
        taluk: r.taluk ?? "—",
        areaSqm: r.areaSqm ?? null,
        _areaSqm: r.areaSqm != null ? r.areaSqm.toLocaleString() : "—",
        saleDeedSummary,
        createdAt: r.createdAt,
      };
    });
  }, [list, yardById]);

  const resetForm = () => {
    setFormYardId("");
    setSurveyNo("");
    setVillage("");
    setTaluk("");
    setDistrict("");
    setAreaSqm("");
    setSaleDeedNo("");
    setSaleDeedDate("");
    setEncumbrance("Free");
    setRemarks("");
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!formYardId) throw new Error("Yard is required");
      if (!surveyNo.trim()) throw new Error("Survey number is required");
      const area = areaSqm.trim() === "" ? null : Number(areaSqm);
      if (area != null && (!Number.isFinite(area) || area < 0)) throw new Error("Area must be a valid number");
      const res = await fetch("/api/ioms/land-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          yardId: formYardId,
          surveyNo: surveyNo.trim(),
          village: village.trim() || null,
          taluk: taluk.trim() || null,
          district: district.trim() || null,
          areaSqm: area,
          saleDeedNo: saleDeedNo.trim() || null,
          saleDeedDate: saleDeedDate.trim() || null,
          encumbrance: encumbrance.trim() || null,
          remarks: remarks.trim() || null,
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
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/land-records"] });
      toast({ title: "Land record added" });
      setCreateOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }, { label: "Land records" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load land records.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }, { label: "Land records" }]}>
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Land records
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Land register by yard — survey no, village, area, deed details. Records are append-only after create.
            </p>
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
              Add land record
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
              searchKeys={["surveyNo", "yardName", "village", "taluk", "saleDeedSummary"]}
              defaultSortKey="createdAt"
              defaultSortDir="desc"
              emptyMessage="No land records."
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
            <DialogTitle>Add land record</DialogTitle>
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
              <Label>Survey no. *</Label>
              <Input value={surveyNo} onChange={(e) => setSurveyNo(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Village</Label>
                <Input value={village} onChange={(e) => setVillage(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Taluk</Label>
                <Input value={taluk} onChange={(e) => setTaluk(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>District</Label>
                <Input value={district} onChange={(e) => setDistrict(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Area (sqm)</Label>
                <Input type="number" min={0} step="0.01" value={areaSqm} onChange={(e) => setAreaSqm(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Sale deed no.</Label>
                <Input value={saleDeedNo} onChange={(e) => setSaleDeedNo(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Sale deed date</Label>
                <Input type="date" value={saleDeedDate} onChange={(e) => setSaleDeedDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Encumbrance</Label>
              <Select value={encumbrance} onValueChange={setEncumbrance}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Free">Free</SelectItem>
                  <SelectItem value="Mortgaged">Mortgaged</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Remarks</Label>
              <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button type="button" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Save land record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
