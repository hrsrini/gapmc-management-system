import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Banknote, AlertCircle } from "lucide-react";

interface Advance {
  id: string;
  voucherId: string;
  employeeId: string;
  purpose: string;
  amount: number;
  recoverySchedule?: string | null;
  recoveredAmount?: number | null;
}
interface Voucher {
  id: string;
  voucherNo?: string | null;
  payeeName: string;
}
interface Employee {
  id: string;
  empId?: string | null;
  firstName: string;
  surname: string;
}

export default function VouchersAdvances() {
  const [voucherIdFilter, setVoucherIdFilter] = useState("all");

  const listUrl = voucherIdFilter && voucherIdFilter !== "all"
    ? `/api/ioms/advances?voucherId=${encodeURIComponent(voucherIdFilter)}`
    : "/api/ioms/advances";
  const { data: advances = [], isLoading, isError } = useQuery<Advance[]>({
    queryKey: [listUrl],
    queryFn: async () => {
      const res = await fetch(listUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch advances");
      return res.json();
    },
  });
  const { data: vouchers = [] } = useQuery<Voucher[]>({
    queryKey: ["/api/ioms/vouchers"],
  });
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/hr/employees"],
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Vouchers", href: "/vouchers" }, { label: "Advance requests" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load advance requests.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const voucherNoMap = Object.fromEntries(vouchers.map((v) => [v.id, v.voucherNo ?? v.id]));
  const employeeLabelById = Object.fromEntries(
    employees.map((e) => [e.id, `${e.empId ?? e.id} — ${e.firstName} ${e.surname}`]),
  );

  return (
    <AppShell breadcrumbs={[{ label: "Vouchers", href: "/vouchers" }, { label: "Advance requests" }]}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5" />
              Advance requests (M-06)
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Advance requests linked to payment vouchers.</p>
          </div>
          <Select value={voucherIdFilter} onValueChange={setVoucherIdFilter}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="All vouchers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vouchers</SelectItem>
              {vouchers.map((v) => (
                <SelectItem key={v.id} value={v.id}>{v.voucherNo ?? v.id} — {v.payeeName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Voucher</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Recovered</TableHead>
                  <TableHead>Recovery schedule</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {advances.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground text-center py-8">No advance requests.</TableCell>
                  </TableRow>
                ) : (
                  advances.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono text-sm">
                        <Link href={`/vouchers/${a.voucherId}`} className="text-primary hover:underline">
                          {voucherNoMap[a.voucherId] ?? a.voucherId}
                        </Link>
                      </TableCell>
                      <TableCell>{employeeLabelById[a.employeeId] ?? a.employeeId}</TableCell>
                      <TableCell>{a.purpose}</TableCell>
                      <TableCell className="text-right">₹{a.amount.toLocaleString()}</TableCell>
                      <TableCell className="text-right">₹{(a.recoveredAmount ?? 0).toLocaleString()}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{a.recoverySchedule ?? "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
