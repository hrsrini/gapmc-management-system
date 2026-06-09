import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Landmark, Loader2, Plus, History, MapPin } from "lucide-react";
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

interface MappingHistoryRow {
  id: string;
  actionType: string;
  yardId: string | null;
  previousMapping: string[];
  newMapping: string[];
  remarks: string | null;
  changedByName: string | null;
  changedAt: string;
}

export default function AdminBankAccounts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [branch, setBranch] = useState("");
  const [yardIds, setYardIds] = useState<string[]>([]);
  const [createRemarks, setCreateRemarks] = useState("");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [manageAccount, setManageAccount] = useState<BankAccountRow | null>(null);
  const [manageYardIds, setManageYardIds] = useState<string[]>([]);
  const [manageRemarks, setManageRemarks] = useState("");

  const { data: list = [], isLoading } = useQuery<BankAccountRow[]>({
    queryKey: ["/api/ioms/receipt-deposits/bank-accounts/all"],
  });
  const { data: yards = [] } = useQuery<YardRef[]>({ queryKey: ["/api/yards"] });

  const { data: mappingHistory = [], isLoading: mappingLoading } = useQuery<MappingHistoryRow[]>({
    queryKey: [`/api/ioms/receipt-deposits/bank-accounts/${historyId}/mapping-history`],
    enabled: Boolean(historyId),
  });

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
        body: JSON.stringify({
          bankName,
          accountNumber,
          ifscCode,
          branch,
          yardIds,
          roleTiers: [],
          isActive: true,
          remarks: createRemarks.trim() || undefined,
        }),
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
      setCreateRemarks("");
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

  const saveYardMappings = useMutation({
    mutationFn: async () => {
      if (!manageAccount) throw new Error("No account selected");
      const res = await fetch(`/api/ioms/receipt-deposits/bank-accounts/${manageAccount.id}/yards`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          yardIds: manageYardIds,
          remarks: manageRemarks.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { message?: string }).message ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/receipt-deposits/bank-accounts/all"] });
      if (manageAccount) {
        queryClient.invalidateQueries({
          queryKey: [`/api/ioms/receipt-deposits/bank-accounts/${manageAccount.id}/mapping-history`],
        });
      }
      toast({ title: "Yard mappings updated" });
      setManageAccount(null);
      setManageRemarks("");
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const yardLabel = useMemo(() => Object.fromEntries(yards.map((y) => [y.id, `${y.name} (${y.code})`])), [yards]);
  const yardCode = useMemo(() => Object.fromEntries(yards.map((y) => [y.id, y.code])), [yards]);

  const formatMappingList = (ids: string[]) => {
    if (ids.length === 0) return "All yards";
    return ids.map((id) => yardLabel[id] ?? yardCode[id] ?? id).join(", ");
  };

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
              onClick={() => {
                setManageAccount(a);
                setManageYardIds([...a.yardIds]);
                setManageRemarks("");
              }}
            >
              <MapPin className="h-3.5 w-3.5 mr-1" />
              Manage yards
            </Button>
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

  const historyAccount = list.find((a) => a.id === historyId);

  return (
    <AppShell
      breadcrumbs={[
        { label: "Admin", href: "/admin/config" },
        { label: "Bank Account – Yard Mapping" },
      ]}
    >
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
          <div className="space-y-1 md:col-span-2">
            <Label>Remarks (optional)</Label>
            <Textarea
              value={createRemarks}
              onChange={(e) => setCreateRemarks(e.target.value)}
              rows={2}
              placeholder="Reason for initial yard mapping"
            />
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
            Bank Account – Yard Mapping Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              defaultSortKey="bankName"
              defaultSortDir="asc"
              emptyMessage="No bank accounts."
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(manageAccount)} onOpenChange={(o) => !o && setManageAccount(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage yard mappings</DialogTitle>
          </DialogHeader>
          {manageAccount ? (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                {manageAccount.bankName} — {manageAccount.accountNumber}
              </p>
              <div className="space-y-2">
                <Label>Linked yards (empty = all yards)</Label>
                <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto border rounded-md p-2">
                  {yards.map((y) => (
                    <label key={y.id} className="flex items-center gap-1">
                      <Checkbox
                        checked={manageYardIds.includes(y.id)}
                        onCheckedChange={(c) =>
                          setManageYardIds((prev) =>
                            c ? [...prev, y.id] : prev.filter((id) => id !== y.id),
                          )
                        }
                      />
                      {y.code}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <Label>Remarks (optional)</Label>
                <Textarea
                  value={manageRemarks}
                  onChange={(e) => setManageRemarks(e.target.value)}
                  rows={2}
                  placeholder="Reason for link / de-link / add / remove"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageAccount(null)}>
              Cancel
            </Button>
            <Button disabled={saveYardMappings.isPending} onClick={() => saveYardMappings.mutate()}>
              {saveYardMappings.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save mappings"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(historyId)} onOpenChange={(o) => !o && setHistoryId(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Mapping history</DialogTitle>
          </DialogHeader>
          {historyAccount ? (
            <p className="text-sm text-muted-foreground mb-2">
              {historyAccount.bankName} — {historyAccount.accountNumber}
            </p>
          ) : null}
          {mappingLoading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : mappingHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No mapping changes recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-2">Date / time</th>
                    <th className="py-2 pr-2">User</th>
                    <th className="py-2 pr-2">Action</th>
                    <th className="py-2 pr-2">Previous</th>
                    <th className="py-2 pr-2">New</th>
                    <th className="py-2">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {mappingHistory.map((h) => (
                    <tr key={h.id} className="border-b align-top">
                      <td className="py-2 pr-2 whitespace-nowrap">{formatApiDateOrDateTime(h.changedAt)}</td>
                      <td className="py-2 pr-2">{h.changedByName ?? "—"}</td>
                      <td className="py-2 pr-2 font-medium">
                        {h.actionType}
                        {h.yardId ? ` (${yardCode[h.yardId] ?? h.yardId})` : ""}
                      </td>
                      <td className="py-2 pr-2 text-muted-foreground">{formatMappingList(h.previousMapping)}</td>
                      <td className="py-2 pr-2">{formatMappingList(h.newMapping)}</td>
                      <td className="py-2 text-muted-foreground">{h.remarks ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Full account snapshots</summary>
            {versionsLoading ? (
              <Loader2 className="h-5 w-5 animate-spin mt-2" />
            ) : versionHistory.length === 0 ? (
              <p className="text-muted-foreground mt-2">No snapshots.</p>
            ) : (
              <ul className="space-y-2 mt-2">
                {versionHistory.map((v) => (
                  <li key={v.id} className="rounded-md border p-2">
                    <div className="font-medium">{formatApiDateOrDateTime(v.changedAt)}</div>
                    <pre className="mt-1 overflow-x-auto text-xs bg-muted p-2 rounded">
                      {JSON.stringify(v.snapshot, null, 2)}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
