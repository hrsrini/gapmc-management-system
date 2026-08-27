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
import { AlertCircle, CalendarDays, Plus, Trash2, X } from "lucide-react";
import { Link } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Same codes as Leave Application (IOMS M-01). */
const ALL_LEAVE_TYPES = ["EL", "HPL", "COMMUTED", "CL", "RH", "SPL_H", "ML", "PL", "EOL", "CCL"] as const;
const LEAVE_TYPE_LABELS: Record<string, string> = {
  EL: "Earned Leave",
  HPL: "Half Pay Leave",
  COMMUTED: "Commuted Leave",
  CL: "Casual Leave",
  RH: "Restricted Holiday",
  SPL_H: "Special Holiday",
  ML: "Maternity Leave",
  PL: "Paternity Leave",
  EOL: "Extraordinary Leave",
  CCL: "Child Care Leave",
};

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
  setOffDays?: number | null;
  setOffExpiryDate?: string | null;
}

type EditableRow = {
  key: string;
  employeeId: string;
  leaveType: string;
  balanceDays: string;
  setOffDays: string;
  setOffExpiryDate: string;
};

function normalizeLeaveTypeCode(raw: string): string {
  const t = raw.trim().toUpperCase().replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    "CASUAL LEAVE": "CL",
    "RESTRICTED HOLIDAY": "RH",
    "RISTRICTED HOLIDAY": "RH",
    "SPECIAL HOLIDAY": "SPL_H",
    SH: "SPL_H",
    "HALF PAY LEAVE": "HPL",
    "EARNED LEAVE": "EL",
    "COMMUTED LEAVE": "COMMUTED",
    "MATERNITY LEAVE": "ML",
    "PATERNITY LEAVE": "PL",
    "EXTRAORDINARY LEAVE": "EOL",
    "CHILD CARE LEAVE": "CCL",
  };
  if (aliases[t]) return aliases[t];
  if ((ALL_LEAVE_TYPES as readonly string[]).includes(t)) return t;
  return t;
}

function toDateInputValue(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return "";
}

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
    const next: EditableRow[] = balances.map((b) => {
      const code = normalizeLeaveTypeCode(b.leaveType);
      return {
        key: b.id,
        employeeId: b.employeeId,
        leaveType: (ALL_LEAVE_TYPES as readonly string[]).includes(code) ? code : "EL",
        balanceDays: String(b.balanceDays),
        setOffDays: String(b.setOffDays ?? 0),
        setOffExpiryDate: toDateInputValue(b.setOffExpiryDate),
      };
    });
    setRows(next);
  }, [balances]);

  const saveMutation = useMutation({
    mutationFn: async (body: {
      rows: {
        employeeId: string;
        leaveType: string;
        balanceDays: number;
        setOffDays?: number;
        setOffExpiryDate?: string | null;
      }[];
    }) => {
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
      {
        key: `new-${Date.now()}`,
        employeeId: first,
        leaveType: "CL",
        balanceDays: "0",
        setOffDays: "0",
        setOffExpiryDate: "",
      },
    ]);
  }

  function removeRow(key: string) {
    setRows((r) => r.filter((x) => x.key !== key));
  }

  function updateRow(key: string, patch: Partial<EditableRow>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function handleSave() {
    const normalized: {
      employeeId: string;
      leaveType: string;
      balanceDays: number;
      setOffDays: number;
      setOffExpiryDate: string | null;
    }[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const employeeId = row.employeeId.trim();
      const leaveType = normalizeLeaveTypeCode(row.leaveType);
      const balanceDays = Number(row.balanceDays);
      const setOffDays = Number(row.setOffDays);
      const setOffExpiryDate = row.setOffExpiryDate.trim() || null;

      if (!employeeId || !leaveType || !Number.isFinite(balanceDays) || balanceDays < 0) {
        toast({
          title: "Invalid row",
          description: "Each row needs employee, leave type, and balance days ≥ 0.",
          variant: "destructive",
        });
        return;
      }
      if (!(ALL_LEAVE_TYPES as readonly string[]).includes(leaveType)) {
        toast({
          title: "Invalid leave type",
          description: `Use a standard leave type (e.g. CL, RH, SPL_H). Got: ${row.leaveType}`,
          variant: "destructive",
        });
        return;
      }
      if (!Number.isFinite(setOffDays) || setOffDays < 0) {
        toast({ title: "Invalid row", description: "Set-off days must be ≥ 0.", variant: "destructive" });
        return;
      }
      if (setOffExpiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(setOffExpiryDate)) {
        toast({
          title: "Invalid set-off expiry",
          description: "Set-off expiry must be a valid date (or cleared).",
          variant: "destructive",
        });
        return;
      }

      const dupKey = `${employeeId}::${leaveType}`;
      if (seen.has(dupKey)) {
        toast({
          title: "Duplicate leave type",
          description: "Each employee can have only one opening balance row per leave type.",
          variant: "destructive",
        });
        return;
      }
      seen.add(dupKey);

      normalized.push({
        employeeId,
        leaveType,
        balanceDays,
        setOffDays,
        setOffExpiryDate,
      });
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
            leave debits from that balance (EL uses set-off bucket first when valid). Leave types match Leave
            Application codes (CL, RH, SPL_H, …).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {canUpdate && (
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href="/hr/leave-balances/import">Bulk import JSON</Link>
            </Button>
          )}
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
                    <div className="md:col-span-3 space-y-1">
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
                    <div className="md:col-span-2 space-y-1">
                      <Label>Leave type</Label>
                      <Select
                        value={row.leaveType}
                        onValueChange={(v) => updateRow(row.key, { leaveType: v })}
                        disabled={!canUpdate}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Leave type" />
                        </SelectTrigger>
                        <SelectContent>
                          {ALL_LEAVE_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t} — {LEAVE_TYPE_LABELS[t] ?? t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-2 space-y-1">
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
                    <div className="md:col-span-2 space-y-1">
                      <Label>Set-off (EL)</Label>
                      <Input
                        type="number"
                        min={0}
                        step={0.5}
                        value={row.setOffDays}
                        onChange={(e) => updateRow(row.key, { setOffDays: e.target.value })}
                        disabled={!canUpdate}
                      />
                    </div>
                    <div className="md:col-span-2 space-y-1">
                      <Label>Set-off expiry</Label>
                      <div className="flex gap-1">
                        <Input
                          type="date"
                          value={row.setOffExpiryDate}
                          onChange={(e) => updateRow(row.key, { setOffExpiryDate: e.target.value })}
                          disabled={!canUpdate}
                          className="flex-1"
                        />
                        {canUpdate && row.setOffExpiryDate ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            title="Clear set-off expiry"
                            aria-label="Clear set-off expiry"
                            onClick={() => updateRow(row.key, { setOffExpiryDate: "" })}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="md:col-span-1 flex gap-1 justify-end">
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
