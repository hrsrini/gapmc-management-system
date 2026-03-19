import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Calendar, AlertCircle, CheckCircle, XCircle } from "lucide-react";

interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  status: string;
  approvedBy?: string | null;
}
interface Employee {
  id: string;
  empId?: string | null;
  firstName: string;
  surname: string;
}

export default function LeaveRequests() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const roles = user?.roles?.map((r) => r.tier) ?? [];
  const canApprove = roles.includes("DA") || roles.includes("ADMIN");
  const { data: list, isLoading, isError } = useQuery<LeaveRequest[]>({
    queryKey: ["/api/hr/leaves"],
  });
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/hr/employees"],
  });
  const employeeLabelById = Object.fromEntries(
    employees.map((e) => [e.id, `${e.empId ?? e.id} — ${e.firstName} ${e.surname}`]),
  );
  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`/api/hr/leaves/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/leaves"] });
      toast({ title: "Status updated", description: `Leave request set to ${status}.` });
    },
    onError: (e: Error) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Leave requests" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load leave requests.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Leave requests (M-01)" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Leave requests (IOMS M-01)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Employee leave applications. DA/Admin can approve or reject Pending requests.
            {canApprove && <span className="block mt-1">You can approve or reject Pending requests.</span>}
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Leave type</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Status</TableHead>
                  {canApprove && <TableHead className="w-[200px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{employeeLabelById[r.employeeId] ?? r.employeeId}</TableCell>
                    <TableCell>{r.leaveType}</TableCell>
                    <TableCell>{r.fromDate}</TableCell>
                    <TableCell>{r.toDate}</TableCell>
                    <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                    {canApprove && (
                      <TableCell className="space-x-2">
                        {r.status === "Pending" && (
                          <>
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => statusMutation.mutate({ id: r.id, status: "Approved" })}
                              disabled={statusMutation.isPending}
                            >
                              <CheckCircle className="h-3.5 w-3.5 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => statusMutation.mutate({ id: r.id, status: "Rejected" })}
                              disabled={statusMutation.isPending}
                            >
                              <XCircle className="h-3.5 w-3.5 mr-1" />
                              Reject
                            </Button>
                          </>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!list || list.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No leave requests.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
