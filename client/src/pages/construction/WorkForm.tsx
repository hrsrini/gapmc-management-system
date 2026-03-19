import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useToast } from "@/hooks/use-toast";
import { HardHat, Loader2, AlertCircle } from "lucide-react";

interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
}
interface Work {
  id: string;
  workNo?: string | null;
  yardId: string;
  workType: string;
  status: string;
  description?: string | null;
  location?: string | null;
  contractorName?: string | null;
  contractorContact?: string | null;
  estimateAmount?: number | null;
  tenderValue?: number | null;
  workOrderNo?: string | null;
  workOrderDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  completionDate?: string | null;
}

const WORK_TYPES = ["Civil", "Electrical", "Plumbing", "AMC", "Other"];
const STATUS_OPTIONS = ["Planned", "InProgress", "Completed", "Closed"];

export default function WorkForm() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!id;

  const [workNo, setWorkNo] = useState("");
  const [yardId, setYardId] = useState("");
  const [workType, setWorkType] = useState("Civil");
  const [status, setStatus] = useState("Planned");
  const [description, setDescription] = useState("");
  const [location, setLocationField] = useState("");
  const [contractorName, setContractorName] = useState("");
  const [contractorContact, setContractorContact] = useState("");
  const [estimateAmount, setEstimateAmount] = useState("");
  const [tenderValue, setTenderValue] = useState("");
  const [workOrderNo, setWorkOrderNo] = useState("");
  const [workOrderDate, setWorkOrderDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [completionDate, setCompletionDate] = useState("");

  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });
  const { data: work, isError: workError } = useQuery<Work>({
    queryKey: ["/api/ioms/works", id],
    enabled: isEdit,
  });

  useEffect(() => {
    if (work) {
      setWorkNo(work.workNo ?? "");
      setYardId(work.yardId ?? "");
      setWorkType(work.workType ?? "Civil");
      setStatus(work.status ?? "Planned");
      setDescription(work.description ?? "");
      setLocationField(work.location ?? "");
      setContractorName(work.contractorName ?? "");
      setContractorContact(work.contractorContact ?? "");
      setEstimateAmount(work.estimateAmount != null ? String(work.estimateAmount) : "");
      setTenderValue(work.tenderValue != null ? String(work.tenderValue) : "");
      setWorkOrderNo(work.workOrderNo ?? "");
      setWorkOrderDate(work.workOrderDate ?? "");
      setStartDate(work.startDate ?? "");
      setEndDate(work.endDate ?? "");
      setCompletionDate(work.completionDate ?? "");
    }
  }, [work]);

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/works", {
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
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/works"] });
      toast({ title: "Work created" });
      setLocation(`/construction/works/${row.id}`);
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/ioms/works/${id}`, {
        method: "PUT",
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
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/works"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/works", id] });
      toast({ title: "Work updated" });
      setLocation(`/construction/works/${id}`);
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      yardId: yardId || undefined,
      workType: workType || undefined,
      status: status || undefined,
      workNo: workNo || undefined,
      description: description || undefined,
      location: location || undefined,
      contractorName: contractorName || undefined,
      contractorContact: contractorContact || undefined,
      estimateAmount: estimateAmount ? Number(estimateAmount) : undefined,
      tenderValue: tenderValue ? Number(tenderValue) : undefined,
      workOrderNo: workOrderNo || undefined,
      workOrderDate: workOrderDate || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      completionDate: completionDate || undefined,
    };
    if (isEdit) updateMutation.mutate(payload);
    else createMutation.mutate(payload);
  };

  const loading = isEdit && work === undefined && !workError;
  const saving = createMutation.isPending || updateMutation.isPending;

  if (isEdit && workError) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction", href: "/construction" }, { label: "Edit" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Work not found.</span>
            <Button variant="outline" size="sm" onClick={() => setLocation("/construction")}>Back</Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction", href: "/construction" }, { label: "Edit" }]}>
        <Card>
          <CardContent className="p-6 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading work…</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Construction", href: "/construction" }, { label: isEdit ? "Edit work" : "Add work" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardHat className="h-5 w-5" />
            {isEdit ? "Edit work" : "Add work"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Work No</Label>
                <Input value={workNo} onChange={(e) => setWorkNo(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <Label>Yard *</Label>
                <Select value={yardId} onValueChange={setYardId} required>
                  <SelectTrigger><SelectValue placeholder="Select yard" /></SelectTrigger>
                  <SelectContent>
                    {yards.map((y) => (
                      <SelectItem key={y.id} value={y.id}>{y.name ?? y.code ?? y.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Work type</Label>
                <Select value={workType} onValueChange={setWorkType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WORK_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
            </div>
            <div>
              <Label>Location</Label>
              <Input value={location} onChange={(e) => setLocationField(e.target.value)} placeholder="Location" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Contractor name</Label>
                <Input value={contractorName} onChange={(e) => setContractorName(e.target.value)} />
              </div>
              <div>
                <Label>Contractor contact</Label>
                <Input value={contractorContact} onChange={(e) => setContractorContact(e.target.value)} />
              </div>
              <div>
                <Label>Estimate amount</Label>
                <Input type="number" step="0.01" value={estimateAmount} onChange={(e) => setEstimateAmount(e.target.value)} />
              </div>
              <div>
                <Label>Tender value</Label>
                <Input type="number" step="0.01" value={tenderValue} onChange={(e) => setTenderValue(e.target.value)} />
              </div>
              <div>
                <Label>Work order no</Label>
                <Input value={workOrderNo} onChange={(e) => setWorkOrderNo(e.target.value)} />
              </div>
              <div>
                <Label>Work order date</Label>
                <Input type="date" value={workOrderDate} onChange={(e) => setWorkOrderDate(e.target.value)} />
              </div>
              <div>
                <Label>Start date</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <Label>End date</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <div>
                <Label>Completion date</Label>
                <Input type="date" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={saving || !yardId}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isEdit ? "Update" : "Create"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setLocation(isEdit ? `/construction/works/${id}` : "/construction")}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
