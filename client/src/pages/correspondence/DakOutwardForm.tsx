import { useState } from "react";
import { useLocation } from "wouter";
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
import { Send, Loader2 } from "lucide-react";

interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
}

const MODES = ["Post", "Courier", "Hand", "Email", "Fax"];

export default function DakOutwardForm() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [despatchNo, setDespatchNo] = useState("");
  const [despatchDate, setDespatchDate] = useState("");
  const [toParty, setToParty] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [modeOfDespatch, setModeOfDespatch] = useState("Post");
  const [yardId, setYardId] = useState("all");
  const [inwardRefId, setInwardRefId] = useState("");
  const [fileRef, setFileRef] = useState("");
  const [despatchedBy, setDespatchedBy] = useState("");

  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/dak/outward", {
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
    onSuccess: (row: { id: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/dak/outward"] });
      toast({ title: "Outward created" });
      setLocation(`/correspondence/outward/${row.id}`);
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      despatchNo: despatchNo || undefined,
      despatchDate: despatchDate || undefined,
      toParty: toParty || undefined,
      toAddress: toAddress || undefined,
      subject: subject || undefined,
      modeOfDespatch: modeOfDespatch || undefined,
      yardId: (yardId && yardId !== "all") ? yardId : undefined,
      inwardRefId: inwardRefId || undefined,
      fileRef: fileRef || undefined,
      despatchedBy: despatchedBy || undefined,
    });
  };

  return (
    <AppShell breadcrumbs={[{ label: "Dak Outward", href: "/correspondence/outward" }, { label: "Add outward" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Add outward
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Despatch no</Label>
                <Input value={despatchNo} onChange={(e) => setDespatchNo(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <Label>Despatch date *</Label>
                <Input type="date" value={despatchDate} onChange={(e) => setDespatchDate(e.target.value)} required />
              </div>
              <div>
                <Label>To (party) *</Label>
                <Input value={toParty} onChange={(e) => setToParty(e.target.value)} required />
              </div>
              <div>
                <Label>Mode of despatch</Label>
                <Select value={modeOfDespatch} onValueChange={setModeOfDespatch}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODES.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
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
              <div>
                <Label>Inward ref (if reply)</Label>
                <Input value={inwardRefId} onChange={(e) => setInwardRefId(e.target.value)} placeholder="Inward ID" />
              </div>
            </div>
            <div>
              <Label>Subject *</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} required />
            </div>
            <div>
              <Label>To address</Label>
              <Input value={toAddress} onChange={(e) => setToAddress(e.target.value)} placeholder="Optional" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Despatched by</Label>
                <Input value={despatchedBy} onChange={(e) => setDespatchedBy(e.target.value)} />
              </div>
              <div>
                <Label>File ref</Label>
                <Input value={fileRef} onChange={(e) => setFileRef(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={createMutation.isPending || !despatchDate || !toParty || !subject}>
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create
              </Button>
              <Button type="button" variant="outline" onClick={() => setLocation("/correspondence/outward")}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
