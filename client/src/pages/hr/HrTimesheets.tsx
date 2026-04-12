import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";

interface Timesheet {
  id: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  totalAttendance?: number | null;
  totalTimesheet?: number | null;
  status: string;
  validatedBy?: string | null;
}
interface Employee {
  id: string;
  empId?: string | null;
  firstName: string;
  surname: string;
}

const columns: ReportTableColumn[] = [
  { key: "periodStart", header: "Period start" },
  { key: "periodEnd", header: "Period end" },
  { key: "employeeLabel", header: "Employee" },
  { key: "totalAttendance", header: "Attendance", sortField: "totalAttendanceNum" },
  { key: "totalTimesheet", header: "Timesheet hrs", sortField: "totalTimesheetNum" },
  { key: "_status", header: "Status", sortField: "status" },
  { key: "validatedBy", header: "Validated by" },
  { key: "_actions", header: "Actions" },
];

export default function HrTimesheets() {
  const [employeeId, setEmployeeId] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [addEmployeeId, setAddEmployeeId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [totalAttendance, setTotalAttendance] = useState("");
  const [totalTimesheet, setTotalTimesheet] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const params = new URLSearchParams();
  if (employeeId && employeeId !== "all") params.set("employeeId", employeeId);
  const url = params.toString() ? `/api/hr/timesheets?${params.toString()}` : "/api/hr/timesheets";

  const { data: list = [], isLoading, isError } = useQuery<Timesheet[]>({ queryKey: [url] });
  const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ["/api/hr/employees"] });
  const employeeLabelById = Object.fromEntries(
    employees.map((e) => [e.id, `${e.empId ?? e.id} — ${e.firstName} ${e.surname}`]),
  );

  const validateMutation = useMutation({
    mutationFn: async (timesheetId: string) => {
      const res = await fetch(`/api/hr/timesheets/${timesheetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Validated" }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [url] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/timesheets"] });
      toast({ title: "Timesheet validated" });
    },
    onError: (e: Error) => toast({ title: "Validation failed", description: e.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async (body: {
      employeeId: string;
      periodStart: string;
      periodEnd: string;
      totalAttendance?: number | null;
      totalTimesheet?: number | null;
    }) => {
      const res = await fetch("/api/hr/timesheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, status: "Draft" }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [url] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/timesheets"] });
      toast({ title: "Timesheet created" });
      setAddOpen(false);
      setAddEmployeeId("");
      setPeriodStart("");
      setPeriodEnd("");
      setTotalAttendance("");
      setTotalTimesheet("");
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const handleAddTimesheet = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      employeeId: addEmployeeId,
      periodStart,
      periodEnd,
      totalAttendance: totalAttendance === "" ? undefined : Number(totalAttendance),
      totalTimesheet: totalTimesheet === "" ? undefined : Number(totalTimesheet),
    });
  };

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return list.map((t) => ({
      id: t.id,
      periodStart: t.periodStart,
      periodEnd: t.periodEnd,
      employeeLabel: employeeLabelById[t.employeeId] ?? t.employeeId,
      totalAttendance: t.totalAttendance ?? "—",
      totalTimesheet: t.totalTimesheet ?? "—",
      totalAttendanceNum: t.totalAttendance ?? null,
      totalTimesheetNum: t.totalTimesheet ?? null,
      status: t.status,
      validatedBy: t.validatedBy ?? "—",
      _status: (
        <Badge variant={t.status === "Validated" ? "default" : "secondary"}>{t.status}</Badge>
      ),
      _actions:
        t.status === "Draft" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => validateMutation.mutate(t.id)}
            disabled={validateMutation.isPending}
          >
            {validateMutation.isPending && validateMutation.variables === t.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4 mr-1" />
            )}
            Validate
          </Button>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
    }));
  }, [list, employeeLabelById, validateMutation.isPending, validateMutation.variables]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Timesheets" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load timesheets.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Timesheets (M-01)" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Timesheets
          </CardTitle>
          <p className="text-sm text-muted-foreground">Fortnightly / monthly timesheet periods; validate workflow.</p>
          <div className="pt-2">
            <Label>Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="w-[220px] mt-1">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.empId ?? e.id} — {e.firstName} {e.surname}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={[
                "periodStart",
                "periodEnd",
                "employeeLabel",
                "status",
                "validatedBy",
              ]}
              searchPlaceholder="Search by period, employee, status…"
              defaultSortKey="periodStart"
              defaultSortDir="desc"
              resetPageDependency={url}
              emptyMessage="No timesheets."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
