import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, AlertCircle } from "lucide-react";

interface Attendance {
  id: string;
  employeeId: string;
  date: string;
  action: string;
  reason?: string | null;
}
interface Employee {
  id: string;
  empId?: string | null;
  firstName: string;
  surname: string;
}

const columns: ReportTableColumn[] = [
  { key: "date", header: "Date" },
  { key: "employeeLabel", header: "Employee" },
  { key: "_action", header: "Action", sortField: "action" },
  { key: "reason", header: "Reason" },
];

export default function HrAttendance() {
  const [employeeId, setEmployeeId] = useState("all");
  const [dateFilter, setDateFilter] = useState("");

  const params = new URLSearchParams();
  if (employeeId && employeeId !== "all") params.set("employeeId", employeeId);
  if (dateFilter) params.set("date", dateFilter);
  const url = params.toString() ? `/api/hr/attendances?${params.toString()}` : "/api/hr/attendances";

  const { data: list = [], isLoading, isError } = useQuery<Attendance[]>({ queryKey: [url] });
  const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ["/api/hr/employees"] });
  const employeeLabelById = Object.fromEntries(
    employees.map((e) => [e.id, `${e.empId ?? e.id} — ${e.firstName} ${e.surname}`]),
  );

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return list.map((a) => ({
      id: a.id,
      date: a.date.slice(0, 10),
      employeeLabel: employeeLabelById[a.employeeId] ?? a.employeeId,
      action: a.action,
      _action: (
        <Badge variant={a.action === "CheckIn" ? "default" : "secondary"}>{a.action}</Badge>
      ),
      reason: a.reason ?? "—",
    }));
  }, [list, employeeLabelById]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Attendance" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load attendance.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Attendance (M-01)" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Attendance (check-in / check-out)
          </CardTitle>
          <p className="text-sm text-muted-foreground">Daily attendance log by employee.</p>
          <div className="flex flex-wrap gap-4 pt-2">
            <div className="space-y-1">
              <Label>Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger className="w-[200px]">
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
            <div className="space-y-1">
              <Label>Date</Label>
              <Input
                type="date"
                className="w-[160px]"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["date", "employeeLabel", "action", "reason"]}
              defaultSortKey="date"
              defaultSortDir="desc"
              emptyMessage="No attendance records."
              resetPageDependency={url}
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
