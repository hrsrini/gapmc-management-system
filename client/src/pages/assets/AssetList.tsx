import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, AlertCircle } from "lucide-react";

interface Asset {
  id: string;
  assetId: string;
  yardId: string;
  assetType: string;
  complexName?: string | null;
  plinthAreaSqft?: number | null;
  value?: number | null;
  isActive?: boolean;
}

export default function AssetList() {
  const { data: assets, isLoading, isError } = useQuery<Asset[]>({
    queryKey: ["/api/ioms/assets"],
  });
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Traders & Assets", href: "/assets" }, { label: "Assets" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load assets.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Traders & Assets", href: "/assets" }, { label: "Assets" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Asset Register (M-02)
          </CardTitle>
          <p className="text-sm text-muted-foreground">Shops, godowns, offices — [LOC]/[TYPE]-[NNN].</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset ID</TableHead>
                  <TableHead>Yard</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Complex</TableHead>
                  <TableHead>Plinth (sqft)</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(assets ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-sm">{a.assetId}</TableCell>
                    <TableCell>{yardById[a.yardId] ?? a.yardId}</TableCell>
                    <TableCell>{a.assetType}</TableCell>
                    <TableCell>{a.complexName ?? "—"}</TableCell>
                    <TableCell>{a.plinthAreaSqft != null ? a.plinthAreaSqft : "—"}</TableCell>
                    <TableCell>{a.value != null ? a.value : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={a.isActive !== false ? "default" : "secondary"}>
                        {a.isActive !== false ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!assets || assets.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No assets in register.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
