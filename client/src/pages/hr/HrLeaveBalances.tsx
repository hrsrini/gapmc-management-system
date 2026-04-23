import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, CalendarDays, Plus, Trash2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface EmployeeRow {
  id: string;
  empId?: string | null;
  firstName: string;
  surname: string;
}

interface BalanceRow {
  id: string;
  employeeId: string;
  leaveType: string;
  balanceDays: number;
}

type EditableRow = { key: string; employeeId: string; leaveType: string; balanceDays: string };

export default function HrLeaveBalances() {
  const { can } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canUpdate = can("M-01", "Update");

  const { data: employees = [], isLoading: empLoading } = useQuery<EmployeeRow[]>({
    queryKey: ["/api/hr/employees"],
  });
  const { data: balances = [], isLoading: balLoading } = useQuery<BalanceRow[]>({
    queryKey: ["/api/hr/leave-balances"],
  });

  const [rows, setRows] = useState<EditableRow[]>([]);

  useEffect(() => {
    const next: EditableRow[] = balances.map((b) => ({
      key: b.id,
      employeeId: b.employeeId,
      leaveType: b.leaveType,
      balanceDays: String(b.balanceDays),
    }));
    setRows(next);
  }, [balances]);

  const saveMutation = useMutation({
    mutationFn: async (body: { rows: { employeeId: string; leaveType: string; balanceDays: number }[] }) => {
      const res = await fetch("/api/hr/leave-balances", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json() as Promise<BalanceRow[]>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/leave-balances"] });
      toast({ title: "Saved", description: "Leave opening balances updated." });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  function addRow() {
    const first = employees[0]?.id ?? "";
    setRows((r) => [
      ...r,
      { key: `new-${Date.now()}`, employeeId: first, leaveType: "EL", balanceDays: "0" },
    ]);
  }

  function removeRow(key: string) {
    setRows((r) => r.filter((x) => x.key !== key));
  }

  function updateRow(key: string, patch: Partial<EditableRow>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function handleSave() {
    const normalized: { employeeId: string; leaveType: string; balanceDays: number }[] = [];
    for (const row of rows) {
      const employeeId = row.employeeId.trim();
      const leaveType = row.leaveType.trim();
      const balanceDays = Number(row.balanceDays);
      if (!employeeId || !leaveType || !Number.isFinite(balanceDays) || balanceDays < 0) {
        toast({
          title: "Invalid row",
          description: "Each row needs employee, leave type, and balance days ≥ 0.",
          variant: "destructive",
        });
        return;
      }
      normalized.push({ employeeId, leaveType, balanceDays });
    }
    saveMutation.mutate({ rows: normalized });
  }

  const loading = empLoading || balLoading;

  return (
    <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Leave opening balances" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Leave opening balances (M-01)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Configure go-live opening balance per leave type. When a row exists for an employee and type, approving a
            leave debits inclusive calendar days from that balance.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canUpdate && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
              <AlertCircle className="h-4 w-4 shrink-0" />
              You have read-only access. Saving requires M-01 Update.
            </div>
          )}
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : employees.length === 0 ? (
            <p className="text-sm text-muted-foreground">No employees found.</p>
          ) : (
            <>
              <div className="space-y-3">
                {rows.map((row) => (
                  <div key={row.key} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end border-b pb-3">
                    <div className="md:col-span-4 space-y-1">
                      <Label>Employee</Label>
                      <Select
                        value={row.employeeId}
                        onValueChange={(v) => updateRow(row.key, { employeeId: v })}
                        disabled={!canUpdate}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Employee" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {(e.empId ?? e.id) + " — " + e.firstName + " " + e.surname}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-3 space-y-1">
                      <Label>Leave type</Label>
                      <Input
                        value={row.leaveType}
                        onChange={(e) => updateRow(row.key, { leaveType: e.target.value })}
                        placeholder="EL, CL, ML…"
                        disabled={!canUpdate}
                      />
                    </div>
                    <div className="md:col-span-3 space-y-1">
                      <Label>Balance (days)</Label>
                      <Input
                        type="number"
                        min={0}
                        step={0.5}
                        value={row.balanceDays}
                        onChange={(e) => updateRow(row.key, { balanceDays: e.target.value })}
                        disabled={!canUpdate}
                      />
                    </div>
                    <div className="md:col-span-2 flex gap-1 justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => removeRow(row.key)}
                        disabled={!canUpdate}
                        aria-label="Remove row"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={addRow} disabled={!canUpdate}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add row
                </Button>
                <Button type="button" onClick={handleSave} disabled={!canUpdate || saveMutation.isPending}>
                  Save balances
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
