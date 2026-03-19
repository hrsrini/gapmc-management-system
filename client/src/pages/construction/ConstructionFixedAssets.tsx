import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, AlertCircle } from "lucide-react";

interface FixedAsset {
  id: string;
  yardId: string;
  assetType: string;
  description?: string | null;
  acquisitionDate: string;
  acquisitionValue: number;
  usefulLifeYears?: number | null;
  currentBookValue?: number | null;
  status: string;
  disposalDate?: string | null;
  disposalValue?: number | null;
  worksId?: string | null;
}
interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
}

export default function ConstructionFixedAssets() {
  const [yardId, setYardId] = useState("all");

  const params = new URLSearchParams();
  if (yardId && yardId !== "all") params.set("yardId", yardId);
  const url = params.toString() ? `/api/ioms/fixed-assets?${params.toString()}` : "/api/ioms/fixed-assets";

  const { data: list = [], isLoading, isError } = useQuery<FixedAsset[]>({ queryKey: [url] });
  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }, { label: "Fixed assets" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load fixed assets.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }, { label: "Fixed assets" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Fixed assets
          </CardTitle>
          <p className="text-sm text-muted-foreground">Asset register — type, acquisition, book value, disposal.</p>
          <div className="pt-2">
            <Label>Yard</Label>
            <Select value={yardId} onValueChange={setYardId}>
              <SelectTrigger className="w-[200px] mt-1">
                <SelectValue placeholder="All yards" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All yards</SelectItem>
                {yards.map((y) => (
                  <SelectItem key={y.id} value={y.id}>{y.name ?? y.code ?? y.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Yard</TableHead>
                  <TableHead>Acquisition date</TableHead>
                  <TableHead className="text-right">Acquisition value</TableHead>
                  <TableHead className="text-right">Book value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground text-center py-6">No fixed assets.</TableCell>
                  </TableRow>
                ) : (
                  list.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.assetType}</TableCell>
                      <TableCell>{a.yardId}</TableCell>
                      <TableCell>{a.acquisitionDate}</TableCell>
                      <TableCell className="text-right">₹{a.acquisitionValue.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{a.currentBookValue != null ? `₹${a.currentBookValue.toLocaleString()}` : "—"}</TableCell>
                      <TableCell><Badge variant="secondary">{a.status}</Badge></TableCell>
                      <TableCell className="max-w-[180px] truncate text-muted-foreground">{a.description ?? "—"}</TableCell>
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
