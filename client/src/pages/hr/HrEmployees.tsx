import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { UserCircle, AlertCircle } from "lucide-react";

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
}

export default function HrEmployees() {
  const { can } = useAuth();
  const canCreate = can("M-01", "Create");
  const { data: employees, isLoading, isError } = useQuery<Employee[]>({
    queryKey: ["/api/hr/employees"],
  });
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

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
            <p className="text-sm text-muted-foreground">Employee master and service record.</p>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Emp ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead>Yard</TableHead>
                  <TableHead>Joining</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(employees ?? []).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-sm">
                      <Link href={`/hr/employees/${e.id}`} className="text-primary hover:underline">{e.empId ?? e.id}</Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/hr/employees/${e.id}`} className="text-primary hover:underline">
                        {[e.firstName, e.middleName, e.surname].filter(Boolean).join(" ")}
                      </Link>
                    </TableCell>
                    <TableCell>{e.designation}</TableCell>
                    <TableCell>{yardById[e.yardId] ?? e.yardId}</TableCell>
                    <TableCell>{e.joiningDate}</TableCell>
                    <TableCell>
                      <Badge variant={e.status === "Active" ? "default" : "secondary"}>{e.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!employees || employees.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No employees. Use API or add via HR module.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
