import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, AlertCircle } from "lucide-react";

interface LandRecord {
  id: string;
  yardId: string;
  surveyNo: string;
  village?: string | null;
  taluk?: string | null;
  district?: string | null;
  areaSqm?: number | null;
  saleDeedNo?: string | null;
  saleDeedDate?: string | null;
  encumbrance?: string | null;
  remarks?: string | null;
  createdBy: string;
  createdAt: string;
}
interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
}

export default function ConstructionLandRecords() {
  const [yardId, setYardId] = useState("all");

  const params = new URLSearchParams();
  if (yardId && yardId !== "all") params.set("yardId", yardId);
  const url = params.toString() ? `/api/ioms/land-records?${params.toString()}` : "/api/ioms/land-records";

  const { data: list = [], isLoading, isError } = useQuery<LandRecord[]>({ queryKey: [url] });
  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }, { label: "Land records" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load land records.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }, { label: "Land records" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Land records
          </CardTitle>
          <p className="text-sm text-muted-foreground">Land register by yard — survey no, village, area, deed details.</p>
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
                  <TableHead>Survey no</TableHead>
                  <TableHead>Yard</TableHead>
                  <TableHead>Village</TableHead>
                  <TableHead>Taluk</TableHead>
                  <TableHead className="text-right">Area (sqm)</TableHead>
                  <TableHead>Sale deed</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground text-center py-6">No land records.</TableCell>
                  </TableRow>
                ) : (
                  list.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-sm">{r.surveyNo}</TableCell>
                      <TableCell>{r.yardId}</TableCell>
                      <TableCell>{r.village ?? "—"}</TableCell>
                      <TableCell>{r.taluk ?? "—"}</TableCell>
                      <TableCell className="text-right">{r.areaSqm != null ? r.areaSqm.toLocaleString() : "—"}</TableCell>
                      <TableCell>{r.saleDeedNo ?? "—"} {r.saleDeedDate ? `(${r.saleDeedDate})` : ""}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{r.createdAt}</TableCell>
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
