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
import { Mail, Loader2, AlertCircle } from "lucide-react";

interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
}
interface Inward {
  id: string;
  diaryNo?: string | null;
  receivedDate: string;
  fromParty: string;
  subject: string;
  modeOfReceipt: string;
  status: string;
  yardId?: string | null;
  fromAddress?: string | null;
  receivedBy?: string | null;
  assignedTo?: string | null;
  deadline?: string | null;
  fileRef?: string | null;
}

const MODES = ["Hand", "Post", "Courier", "Email", "Fax"];
const STATUS_OPTIONS = ["Pending", "InProgress", "Closed"];

export default function DakInwardForm() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!id;

  const [diaryNo, setDiaryNo] = useState("");
  const [receivedDate, setReceivedDate] = useState("");
  const [fromParty, setFromParty] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [modeOfReceipt, setModeOfReceipt] = useState("Hand");
  const [status, setStatus] = useState("Pending");
  const [yardId, setYardId] = useState("all");
  const [receivedBy, setReceivedBy] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [deadline, setDeadline] = useState("");
  const [fileRef, setFileRef] = useState("");

  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });
  const { data: inward, isError: inwardError } = useQuery<Inward>({
    queryKey: ["/api/ioms/dak/inward", id],
    enabled: isEdit,
  });

  useEffect(() => {
    if (inward) {
      setDiaryNo(inward.diaryNo ?? "");
      setReceivedDate(inward.receivedDate ?? "");
      setFromParty(inward.fromParty ?? "");
      setFromAddress(inward.fromAddress ?? "");
      setSubject(inward.subject ?? "");
      setModeOfReceipt(inward.modeOfReceipt ?? "Hand");
      setStatus(inward.status ?? "Pending");
      setYardId(inward.yardId ?? "all");
      setReceivedBy(inward.receivedBy ?? "");
      setAssignedTo(inward.assignedTo ?? "");
      setDeadline(inward.deadline ?? "");
      setFileRef(inward.fileRef ?? "");
    }
  }, [inward]);

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/dak/inward", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/dak/inward"] });
      toast({ title: "Inward created" });
      setLocation(`/correspondence/inward/${row.id}`);
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/ioms/dak/inward/${id}`, {
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
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/dak/inward"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/dak/inward", id] });
      toast({ title: "Inward updated" });
      setLocation(`/correspondence/inward/${id}`);
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      diaryNo: diaryNo || undefined,
      receivedDate: receivedDate || undefined,
      fromParty: fromParty || undefined,
      fromAddress: fromAddress || undefined,
      subject: subject || undefined,
      modeOfReceipt: modeOfReceipt || undefined,
      status: status || undefined,
      yardId: (yardId && yardId !== "all") ? yardId : undefined,
      receivedBy: receivedBy || undefined,
      assignedTo: assignedTo || undefined,
      deadline: deadline || undefined,
      fileRef: fileRef || undefined,
    };
    if (isEdit) updateMutation.mutate(payload);
    else createMutation.mutate(payload);
  };

  const loading = isEdit && inward === undefined && !inwardError;
  const saving = createMutation.isPending || updateMutation.isPending;

  if (isEdit && inwardError) {
    return (
      <AppShell breadcrumbs={[{ label: "Dak Inward", href: "/correspondence/inward" }, { label: "Edit" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Inward not found.</span>
            <Button variant="outline" size="sm" onClick={() => setLocation("/correspondence/inward")}>Back</Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell breadcrumbs={[{ label: "Dak Inward", href: "/correspondence/inward" }, { label: "Edit" }]}>
        <Card>
          <CardContent className="p-6 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading…</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Dak Inward", href: "/correspondence/inward" }, { label: isEdit ? "Edit inward" : "Add inward" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {isEdit ? "Edit inward" : "Add inward"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Diary No</Label>
                <Input value={diaryNo} onChange={(e) => setDiaryNo(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <Label>Received date *</Label>
                <Input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} required />
              </div>
              <div>
                <Label>From (party) *</Label>
                <Input value={fromParty} onChange={(e) => setFromParty(e.target.value)} required />
              </div>
              <div>
                <Label>Mode of receipt</Label>
                <Select value={modeOfReceipt} onValueChange={setModeOfReceipt}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODES.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
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
              <div>
                <Label>Yard</Label>
                <Select value={yardId} onValueChange={setYardId}>
                  <SelectTrigger><SelectValue placeholder="All yards" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All yards</SelectItem>
                    {yards.map((y) => (
                      <SelectItem key={y.id} value={y.id}>{y.name ?? y.code ?? y.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Subject *</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} required />
            </div>
            <div>
              <Label>From address</Label>
              <Input value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} placeholder="Optional" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Received by</Label>
                <Input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
              </div>
              <div>
                <Label>Assigned to</Label>
                <Input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} />
              </div>
              <div>
                <Label>Deadline</Label>
                <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </div>
              <div>
                <Label>File ref</Label>
                <Input value={fileRef} onChange={(e) => setFileRef(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={saving || !receivedDate || !fromParty || !subject}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isEdit ? "Update" : "Create"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setLocation(isEdit ? `/correspondence/inward/${id}` : "/correspondence/inward")}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
