import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { FileText, Receipt, Banknote, Download, UserCircle, BarChart3 } from "lucide-react";

interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
}

export default function IomsReports() {
  const { toast } = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [yardId, setYardId] = useState<string>("all");

  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });
  const consolidatedUrl = yardId && yardId !== "all"
    ? `/api/hr/reports/consolidated?yardId=${encodeURIComponent(yardId)}`
    : "/api/hr/reports/consolidated";
  const { data: consolidated } = useQuery<{ total: number; byYard: Record<string, number>; byStatus: Record<string, number>; byEmployeeType: Record<string, number> }>({
    queryKey: [consolidatedUrl],
    queryFn: async () => {
      const res = await fetch(consolidatedUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const downloadCsv = async (report: "rent-summary" | "voucher-summary" | "receipt-register", filename: string) => {
    try {
      const params = new URLSearchParams({ format: "csv" });
      if (yardId && yardId !== "all") params.set("yardId", yardId);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/ioms/reports/${report}?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Download started", description: `${filename} is being saved.` });
    } catch (e) {
      toast({ title: "Download failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    }
  };

  const downloadStaffListCsv = async () => {
    try {
      const params = new URLSearchParams({ format: "csv" });
      if (yardId && yardId !== "all") params.set("yardId", yardId);
      const res = await fetch(`/api/hr/reports/staff-list?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "staff-list.csv";
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Download started", description: "staff-list.csv is being saved." });
    } catch (e) {
      toast({ title: "Download failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    }
  };

  return (
    <AppShell breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "IOMS Reports" }]}>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>IOMS Reports & Export</CardTitle>
            <CardDescription>
              Yard-scoped reports. Optionally filter by yard and date range, then view summary or download CSV (opens in Excel).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Yard</Label>
                <Select value={yardId} onValueChange={setYardId}>
                  <SelectTrigger>
                    <SelectValue placeholder="All yards" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All yards</SelectItem>
                    {(yards as Yard[]).map((y) => (
                      <SelectItem key={y.id} value={y.id}>
                        {y.name ?? y.code ?? y.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>From (period/date)</Label>
                <Input type="text" placeholder="e.g. 2024-04" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>To (period/date)</Label>
                <Input type="text" placeholder="e.g. 2025-03" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Rent summary
              </CardTitle>
              <CardDescription>IOMS rent invoices by period; totals and counts by status.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => downloadCsv("rent-summary", "rent-summary.csv")} variant="outline" className="w-full">
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Banknote className="h-5 w-5" />
                Voucher summary
              </CardTitle>
              <CardDescription>Payment vouchers by yard; totals and counts by status.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => downloadCsv("voucher-summary", "voucher-summary.csv")} variant="outline" className="w-full">
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Receipt register
              </CardTitle>
              <CardDescription>IOMS receipts by yard and date; revenue head and amount.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => downloadCsv("receipt-register", "receipt-register.csv")} variant="outline" className="w-full">
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCircle className="h-5 w-5" />
                Staff list (HR)
              </CardTitle>
              <CardDescription>Employee list by yard; empId, name, designation, joining, status. Optional yard filter above.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={downloadStaffListCsv} variant="outline" className="w-full">
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Consolidated HR
              </CardTitle>
              <CardDescription>Headcount summary by yard, status and type. Uses yard filter above.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {consolidated != null && (
                <>
                  <p className="text-2xl font-semibold">{consolidated.total} employees</p>
                  {Object.keys(consolidated.byStatus).length > 0 && (
                    <div className="text-sm text-muted-foreground">
                      By status: {Object.entries(consolidated.byStatus).map(([k, v]) => `${k}: ${v}`).join(", ")}
                    </div>
                  )}
                  {Object.keys(consolidated.byEmployeeType).length > 0 && (
                    <div className="text-sm text-muted-foreground">
                      By type: {Object.entries(consolidated.byEmployeeType).map(([k, v]) => `${k}: ${v}`).join(", ")}
                    </div>
                  )}
                  {!yardId && Object.keys(consolidated.byYard).length > 0 && (
                    <div className="text-sm text-muted-foreground">
                      By yard: {Object.entries(consolidated.byYard).map(([k, v]) => `${k}: ${v}`).join(", ")}
                    </div>
                  )}
                </>
              )}
              <Button onClick={downloadStaffListCsv} variant="outline" className="w-full mt-2">
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
