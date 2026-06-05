import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
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
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Landmark, Loader2, Plus, History } from "lucide-react";
import { formatApiDateOrDateTime } from "@/lib/dateFormat";

interface BankAccountRow {
  id: string;
  bankName: string;
  accountNumber: string;
  ifscCode?: string | null;
  branch?: string | null;
  isActive: boolean;
  yardIds: string[];
  roleTiers: string[];
}

interface YardRef {
  id: string;
  name: string;
  code: string;
}

const ROLE_OPTIONS = ["DO", "DV", "DA", "ADMIN", "READ_ONLY"];

export default function AdminBankAccounts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [branch, setBranch] = useState("");
  const [yardIds, setYardIds] = useState<string[]>([]);
  const [roleTiers, setRoleTiers] = useState<string[]>([]);
  const [historyId, setHistoryId] = useState<string | null>(null);

  const { data: list = [], isLoading } = useQuery<BankAccountRow[]>({
    queryKey: ["/api/ioms/receipt-deposits/bank-accounts/all"],
  });
  const { data: yards = [] } = useQuery<YardRef[]>({ queryKey: ["/api/yards"] });

  const { data: versionHistory = [], isLoading: versionsLoading } = useQuery<
    Array<{ id: string; changedAt: string; changedBy: string | null; snapshot: Record<string, unknown> }>
  >({
    queryKey: [`/api/ioms/receipt-deposits/bank-accounts/${historyId}/versions`],
    enabled: Boolean(historyId),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ioms/receipt-deposits/bank-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ bankName, accountNumber, ifscCode, branch, yardIds, roleTiers, isActive: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { message?: string }).message ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/receipt-deposits/bank-accounts/all"] });
      toast({ title: "Bank account added" });
      setBankName("");
      setAccountNumber("");
      setIfscCode("");
      setBranch("");
      setYardIds([]);
      setRoleTiers([]);
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const row = list.find((a) => a.id === id);
      const res = await fetch(`/api/ioms/receipt-deposits/bank-accounts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...row, isActive }),
      });
      if (!res.ok) throw new Error("Update failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/receipt-deposits/bank-accounts/all"] });
    },
  });

  const yardLabel = useMemo(() => Object.fromEntries(yards.map((y) => [y.id, `${y.name} (${y.code})`])), [yards]);

  const columns: ReportTableColumn[] = [
    { key: "bankName", header: "Bank" },
    { key: "accountNumber", header: "Account no." },
    { key: "ifscCode", header: "IFSC" },
    { key: "yardsLabel", header: "Yards" },
    { key: "_active", header: "Active" },
    { key: "_actions", header: "Actions" },
  ];

  const sourceRows = useMemo(
    () =>
      list.map((a) => ({
        id: a.id,
        bankName: a.bankName,
        accountNumber: a.accountNumber,
        ifscCode: a.ifscCode ?? "—",
        yardsLabel: a.yardIds.length ? a.yardIds.map((y) => yardLabel[y] ?? y).join(", ") : "All yards",
        _active: a.isActive ? "Yes" : "No",
        _actions: (
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => toggleActive.mutate({ id: a.id, isActive: !a.isActive })}
            >
              {a.isActive ? "Deactivate" : "Activate"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setHistoryId(a.id)}>
              <History className="h-3.5 w-3.5 mr-1" />
              History
            </Button>
          </div>
        ),
      })),
    [list, yardLabel, toggleActive],
  );

  return (
    <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/config" }, { label: "Bank accounts (M-05)" }]}>
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Add bank account (FR-RCP-010)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Bank name</Label>
            <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Account number</Label>
            <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>IFSC</Label>
            <Input value={ifscCode} onChange={(e) => setIfscCode(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Branch</Label>
            <Input value={branch} onChange={(e) => setBranch(e.target.value)} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>Yards (empty = all)</Label>
            <div className="flex flex-wrap gap-2">
              {yards.map((y) => (
                <label key={y.id} className="flex items-center gap-1 text-sm">
                  <Checkbox
                    checked={yardIds.includes(y.id)}
                    onCheckedChange={(c) =>
                      setYardIds((prev) => (c ? [...prev, y.id] : prev.filter((id) => id !== y.id)))
                    }
                  />
                  {y.code}
                </label>
              ))}
            </div>
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button
              disabled={createMutation.isPending || !bankName.trim() || !accountNumber.trim()}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save account"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5" />
            GAPLMB bank accounts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <ClientDataGrid columns={columns} sourceRows={sourceRows} defaultSortKey="bankName" defaultSortDir="asc" emptyMessage="No bank accounts." />
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(historyId)} onOpenChange={(o) => !o && setHistoryId(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bank account version history</DialogTitle>
          </DialogHeader>
          {versionsLoading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : versionHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved versions yet (created on each update).</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {versionHistory.map((v) => (
                <li key={v.id} className="rounded-md border p-3">
                  <div className="font-medium">{formatApiDateOrDateTime(v.changedAt)}</div>
                  <pre className="mt-2 overflow-x-auto text-xs bg-muted p-2 rounded">
                    {JSON.stringify(v.snapshot, null, 2)}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
