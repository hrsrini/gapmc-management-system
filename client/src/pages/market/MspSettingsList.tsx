import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Percent, AlertCircle } from "lucide-react";

interface MspSetting {
  id: string;
  commodity: string;
  mspRate: number;
  validFrom: string;
  validTo?: string | null;
  updatedBy?: string | null;
}

export default function MspSettingsList() {
  const { data: list = [], isLoading, isError } = useQuery<MspSetting[]>({
    queryKey: ["/api/ioms/msp-settings"],
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Market (IOMS)", href: "/market/commodities" }, { label: "MSP settings" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load MSP settings.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Market (IOMS)", href: "/market/commodities" }, { label: "MSP settings" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5" />
            MSP settings (M-02)
          </CardTitle>
          <p className="text-sm text-muted-foreground">Minimum support price by commodity and validity period.</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Commodity</TableHead>
                  <TableHead>Valid from</TableHead>
                  <TableHead>Valid to</TableHead>
                  <TableHead className="text-right">MSP rate (₹)</TableHead>
                  <TableHead>Updated by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground text-center py-6">No MSP settings.</TableCell>
                  </TableRow>
                ) : (
                  list.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.commodity}</TableCell>
                      <TableCell>{m.validFrom}</TableCell>
                      <TableCell>{m.validTo ?? "—"}</TableCell>
                      <TableCell className="text-right">₹{m.mspRate.toLocaleString()}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{m.updatedBy ?? "—"}</TableCell>
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
