import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
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

  const columns = useMemo(
    (): ReportTableColumn[] => [
      { key: "_voucher", header: "Voucher", sortField: "voucherNoSort" },
      { key: "employeeLabel", header: "Employee" },
      { key: "purpose", header: "Purpose" },
      { key: "_amount", header: "Amount", sortField: "amount" },
      { key: "_recovered", header: "Recovered", sortField: "recoveredAmount" },
      { key: "recoverySchedule", header: "Recovery schedule" },
    ],
    [],
  );

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return advances.map((a) => ({
      id: a.id,
      voucherNoSort: voucherNoMap[a.voucherId] ?? a.voucherId,
      _voucher: (
        <Link href={`/vouchers/${a.voucherId}`} className="text-primary hover:underline font-mono text-sm">
          {voucherNoMap[a.voucherId] ?? a.voucherId}
        </Link>
      ),
      employeeLabel: employeeLabelById[a.employeeId] ?? a.employeeId,
      purpose: a.purpose,
      amount: a.amount,
      _amount: `₹${a.amount.toLocaleString()}`,
      recoveredAmount: a.recoveredAmount ?? 0,
      _recovered: `₹${(a.recoveredAmount ?? 0).toLocaleString()}`,
      recoverySchedule: a.recoverySchedule ?? "—",
    }));
  }, [advances, voucherNoMap, employeeLabelById]);

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
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["voucherNoSort", "employeeLabel", "purpose", "recoverySchedule"]}
              defaultSortKey="voucherNoSort"
              defaultSortDir="desc"
              emptyMessage="No advance requests."
              resetPageDependency={listUrl}
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
