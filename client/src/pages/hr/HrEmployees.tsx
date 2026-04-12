import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { UserCircle, AlertCircle } from "lucide-react";
import { fetchApiGet } from "@/lib/queryClient";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";

interface AppLogin {
  id: string;
  email: string;
  isActive: boolean;
  roles: { id: string; name: string; tier: string }[];
  yards: { id: string; name: string }[];
  effectivePermissions: { module: string; action: string }[];
}

interface Employee {
  id: string;
  empId?: string | null;
  firstName: string;
  middleName?: string | null;
  surname: string;
  designation: string;
  yardId: string;
  employeeType: string;
  joiningDate: string;
  status: string;
  mobile?: string | null;
  workEmail?: string | null;
  userId?: string | null;
  appLogin?: AppLogin | null;
}

function formatPermissionLabel(p: { module: string; action: string }): string {
  return `${p.module}:${p.action}`;
}

const PERM_BADGE_MAX = 12;

export default function HrEmployees() {
  const { can } = useAuth();
  const canCreate = can("M-01", "Create");
  const canM10Read = can("M-10", "Read");
  const queryModeKey = canM10Read ? "app" : "basic";
  const { data: employees, isLoading, isError } = useQuery<Employee[]>({
    queryKey: ["/api/hr/employees", queryModeKey],
    queryFn: () =>
      fetchApiGet<Employee[]>(`/api/hr/employees${canM10Read ? "?includeApp=1" : ""}`),
  });
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  const columns = useMemo((): ReportTableColumn[] => {
    const base: ReportTableColumn[] = [
      { key: "_empId", header: "Emp ID", sortField: "empIdSort" },
      { key: "_name", header: "Name", sortField: "fullName" },
      { key: "designation", header: "Designation" },
      { key: "mobile", header: "Mobile" },
      { key: "workEmail", header: "Work email" },
      { key: "yardName", header: "HR yard" },
      { key: "employeeType", header: "Type" },
      { key: "joiningDate", header: "Joining" },
      { key: "_status", header: "Status", sortField: "status" },
      { key: "_appLogin", header: "App login", sortField: "appLoginSort" },
    ];
    if (!canM10Read) return base;
    return [
      ...base,
      { key: "_roles", header: "IOMS roles", sortField: "rolesLabels" },
      { key: "_locations", header: "App locations", sortField: "locationsLabels" },
      { key: "_perms", header: "Effective permissions", sortField: "permsLabels" },
    ];
  }, [canM10Read]);

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (employees ?? []).map((e) => {
      const linked = canM10Read ? e.appLogin : undefined;
      const fullName = [e.firstName, e.middleName, e.surname].filter(Boolean).join(" ");
      const empIdSort =
        e.empId ??
        (e.status === "Draft" || e.status === "Submitted" ? "" : e.id);
      const displayEmpId = e.empId ?? (e.status === "Draft" || e.status === "Submitted" ? "—" : e.id);
      const permLabels = (linked?.effectivePermissions ?? []).map(formatPermissionLabel);
      const permShown = permLabels.slice(0, PERM_BADGE_MAX);
      const permRest = permLabels.length - permShown.length;
      const permTitle = permLabels.length ? permLabels.join(", ") : "No permissions via role matrix";
      const rolesLabels =
        linked?.roles?.map((r) => r.name).join(", ") ?? "";
      const locationsLabels =
        linked?.yards?.map((y) => y.name).join(", ") ?? "";
      const permsLabels = permLabels.join(", ");

      const row: Record<string, unknown> = {
        id: e.id,
        empIdSort,
        fullName,
        designation: e.designation,
        mobile: e.mobile ?? "—",
        workEmail: e.workEmail ?? "—",
        yardName: yardById[e.yardId] ?? e.yardId,
        employeeType: e.employeeType,
        joiningDate: e.joiningDate,
        status: e.status,
        appLoginSort: e.userId ? (canM10Read && linked ? linked.email : "Enabled") : "",
        rolesLabels,
        locationsLabels,
        permsLabels,
        _empId: (
          <Link href={`/hr/employees/${e.id}`} className="text-primary hover:underline font-mono text-sm">
            {displayEmpId}
          </Link>
        ),
        _name: (
          <Link href={`/hr/employees/${e.id}`} className="text-primary hover:underline">
            {fullName}
          </Link>
        ),
        _status: (
          <Badge variant={e.status === "Active" ? "default" : "secondary"}>{e.status}</Badge>
        ),
        _appLogin: e.userId ? (
          <div className="flex flex-col gap-0.5">
            <Badge variant="outline" className="font-normal w-fit">
              Enabled
            </Badge>
            {canM10Read && linked && (
              <span
                className="text-xs text-muted-foreground font-mono truncate max-w-[140px]"
                title={linked.email}
              >
                {linked.email}
              </span>
            )}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
      };

      if (canM10Read) {
        row._roles =
          !e.userId || !linked ? (
            <span className="text-sm text-muted-foreground">—</span>
          ) : (linked.roles?.length ?? 0) === 0 ? (
            <span className="text-xs text-amber-700 dark:text-amber-400">No roles</span>
          ) : (
            <div className="flex flex-wrap gap-1 max-w-[200px]">
              {linked.roles!.map((r) => (
                <Badge key={r.id} variant="outline" className="font-normal text-xs">
                  {r.name}
                  <span className="text-muted-foreground ml-1">({r.tier})</span>
                </Badge>
              ))}
            </div>
          );
        row._locations =
          !e.userId || !linked ? (
            <span className="text-muted-foreground">—</span>
          ) : (linked.yards?.length ?? 0) === 0 ? (
            <span className="text-muted-foreground text-xs">No yards assigned</span>
          ) : (
            <ul className="list-disc pl-4 space-y-0.5 max-w-[200px]">
              {linked.yards!.map((y) => (
                <li key={y.id} className="truncate" title={y.name}>
                  {y.name}
                </li>
              ))}
            </ul>
          );
        row._perms =
          !e.userId || !linked ? (
            <span className="text-sm text-muted-foreground">—</span>
          ) : (
            <div className="flex flex-wrap gap-1 max-w-[320px]" title={permTitle}>
              {permShown.map((label, i) => (
                <Badge
                  key={`${label}-${i}`}
                  variant="secondary"
                  className="font-mono font-normal text-[10px] px-1.5 py-0"
                >
                  {label}
                </Badge>
              ))}
              {permRest > 0 && (
                <Badge variant="outline" className="text-[10px]">
                  +{permRest}
                </Badge>
              )}
              {permLabels.length === 0 && (linked.roles?.length ?? 0) > 0 && (
                <span className="text-xs text-muted-foreground">No matrix rows</span>
              )}
            </div>
          );
      }

      return row;
    });
  }, [employees, yardById, canM10Read]);

  const searchKeys = useMemo(() => {
    const keys = [
      "empIdSort",
      "fullName",
      "designation",
      "mobile",
      "workEmail",
      "yardName",
      "employeeType",
      "joiningDate",
      "status",
      "appLoginSort",
    ];
    if (canM10Read) keys.push("rolesLabels", "locationsLabels", "permsLabels");
    return keys;
  }, [canM10Read]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Employees" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load employees.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Employees" }]}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <UserCircle className="h-5 w-5" />
              Employees (M-01 HRMS)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Employee master is the only place for people and app access. IOMS roles, app locations, and effective
              permissions come from the same HR API when you have M-10 Read (no separate user admin).
            </p>
          </div>
          {canCreate && (
            <Button asChild>
              <Link href="/hr/employees/new">Add employee</Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={searchKeys}
              searchPlaceholder="Search by emp ID, name, designation, yard, email, roles, permissions…"
              defaultSortKey="fullName"
              defaultSortDir="asc"
              resetPageDependency={queryModeKey}
              emptyMessage="No employees. Use API or add via HR module."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
