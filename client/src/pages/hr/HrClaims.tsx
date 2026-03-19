import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Wallet, Plane, Car, AlertCircle } from "lucide-react";

interface LtcClaim {
  id: string;
  employeeId: string;
  claimDate: string;
  amount: number;
  period?: string | null;
  status: string;
}
interface TaDaClaim {
  id: string;
  employeeId: string;
  travelDate: string;
  purpose: string;
  amount: number;
  status: string;
}
interface Employee {
  id: string;
  empId?: string | null;
  firstName: string;
  surname: string;
}

export default function HrClaims() {
  const { data: ltcList = [], isLoading: ltcLoading, isError: ltcError } = useQuery<LtcClaim[]>({
    queryKey: ["/api/hr/claims/ltc"],
  });
  const { data: tadaList = [], isLoading: tadaLoading, isError: tadaError } = useQuery<TaDaClaim[]>({
    queryKey: ["/api/hr/claims/tada"],
  });
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/hr/employees"],
  });
  const employeeLabelById = Object.fromEntries(
    employees.map((e) => [e.id, `${e.empId ?? e.id} — ${e.firstName} ${e.surname}`]),
  );

  const isError = ltcError || tadaError;

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Claims" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load claims.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Claims (M-01)" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            LTC / TA-DA claims
          </CardTitle>
          <p className="text-sm text-muted-foreground">Leave Travel Concession and Travel / Daily Allowance claims.</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="font-medium flex items-center gap-2 mb-2">
              <Plane className="h-4 w-4" />
              LTC claims
            </h3>
            {ltcLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Claim date</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ltcList.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground text-center py-6">No LTC claims.</TableCell>
                    </TableRow>
                  ) : (
                    ltcList.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>{employeeLabelById[c.employeeId] ?? c.employeeId}</TableCell>
                        <TableCell>{c.claimDate}</TableCell>
                        <TableCell>{c.period ?? "—"}</TableCell>
                        <TableCell className="text-right">₹{c.amount.toLocaleString()}</TableCell>
                        <TableCell><Badge variant="secondary">{c.status}</Badge></TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </div>
          <div>
            <h3 className="font-medium flex items-center gap-2 mb-2">
              <Car className="h-4 w-4" />
              TA/DA claims
            </h3>
            {tadaLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Travel date</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tadaList.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground text-center py-6">No TA/DA claims.</TableCell>
                    </TableRow>
                  ) : (
                    tadaList.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>{employeeLabelById[c.employeeId] ?? c.employeeId}</TableCell>
                        <TableCell>{c.travelDate}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{c.purpose}</TableCell>
                        <TableCell className="text-right">₹{c.amount.toLocaleString()}</TableCell>
                        <TableCell><Badge variant="secondary">{c.status}</Badge></TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
