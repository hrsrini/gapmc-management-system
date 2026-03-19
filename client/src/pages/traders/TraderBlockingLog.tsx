import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { ShieldAlert, AlertCircle, Plus, Loader2 } from "lucide-react";

interface BlockingLogEntry {
  id: string;
  traderLicenceId: string;
  action: string;
  reason: string;
  actionedBy: string;
  actionedAt: string;
}
interface Licence {
  id: string;
  licenceNo?: string | null;
  firmName: string;
  yardId: string;
}

export default function TraderBlockingLog() {
  const [traderLicenceIdFilter, setTraderLicenceIdFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [traderLicenceId, setTraderLicenceId] = useState("");
  const [action, setAction] = useState("Blocked");
  const [reason, setReason] = useState("");

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, can } = useAuth();
  const canCreate = can("M-02", "Create");
  const actionedBy = user?.name ?? user?.email ?? "Current User";

  const listUrl = traderLicenceIdFilter
    ? `/api/ioms/traders/blocking-log?traderLicenceId=${encodeURIComponent(traderLicenceIdFilter)}`
    : "/api/ioms/traders/blocking-log";

  const { data: log = [], isLoading, isError } = useQuery<BlockingLogEntry[]>({
    queryKey: [listUrl],
    queryFn: async () => {
      const res = await fetch(listUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch blocking log");
      return res.json();
    },
  });
  const { data: licences = [] } = useQuery<Licence[]>({ queryKey: ["/api/ioms/traders/licences"] });
  const licenceLabelById = Object.fromEntries(
    licences.map((l) => [l.id, `${l.licenceNo ?? l.id} — ${l.firmName}`]),
  );

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/traders/blocking-log", {
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/traders/blocking-log"] });
      toast({ title: "Blocking log entry added" });
      setDialogOpen(false);
      setTraderLicenceId("");
      setAction("Blocked");
      setReason("");
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      traderLicenceId: traderLicenceId || undefined,
      action,
      reason: reason || undefined,
      actionedBy,
    });
  };

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Traders", href: "/traders/licences" }, { label: "Blocking log" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load blocking log.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Traders", href: "/traders/licences" }, { label: "Blocking log" }]}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" />
              Blocking log (M-02)
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Trader licence block / unblock history.</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={traderLicenceIdFilter} onValueChange={setTraderLicenceIdFilter}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="All licences" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All licences</SelectItem>
                {licences.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.licenceNo ?? l.id} — {l.firmName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canCreate && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-1" /> Add entry</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add blocking log entry</DialogTitle></DialogHeader>
                <form onSubmit={handleAdd} className="space-y-4">
                  <div><Label>Trader licence *</Label>
                    <Select value={traderLicenceId} onValueChange={setTraderLicenceId} required>
                      <SelectTrigger><SelectValue placeholder="Select licence" /></SelectTrigger>
                      <SelectContent>
                        {licences.map((l) => (
                          <SelectItem key={l.id} value={l.id}>{l.licenceNo ?? l.id} — {l.firmName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Action *</Label>
                    <Select value={action} onValueChange={setAction}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Blocked">Blocked</SelectItem>
                        <SelectItem value="Unblocked">Unblocked</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Reason *</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="Reason for block/unblock" /></div>
                  <p className="text-xs text-muted-foreground">Actioned by: {actionedBy}</p>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={createMutation.isPending}>
                      {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Add
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Licence</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Actioned by</TableHead>
                  <TableHead>Actioned at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground text-center py-8">No blocking log entries.</TableCell>
                  </TableRow>
                ) : (
                  log.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{licenceLabelById[entry.traderLicenceId] ?? entry.traderLicenceId}</TableCell>
                      <TableCell>
                        <Badge variant={entry.action === "Blocked" ? "destructive" : "default"}>{entry.action}</Badge>
                      </TableCell>
                      <TableCell>{entry.reason}</TableCell>
                      <TableCell>{entry.actionedBy}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{entry.actionedAt}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
