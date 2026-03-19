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
import { FileCheck, AlertCircle } from "lucide-react";

interface AmcContract {
  id: string;
  yardId: string;
  contractorName: string;
  description?: string | null;
  amountPerPeriod: number;
  periodType?: string | null;
  contractStart: string;
  contractEnd: string;
  status: string;
  daUser?: string | null;
}
interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
}

export default function ConstructionAmc() {
  const [yardId, setYardId] = useState("all");

  const params = new URLSearchParams();
  if (yardId && yardId !== "all") params.set("yardId", yardId);
  const url = params.toString() ? `/api/ioms/amc?${params.toString()}` : "/api/ioms/amc";

  const { data: list = [], isLoading, isError } = useQuery<AmcContract[]>({ queryKey: [url] });
  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }, { label: "AMC" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load AMC contracts.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }, { label: "AMC contracts" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            AMC contracts
          </CardTitle>
          <p className="text-sm text-muted-foreground">Annual / periodic maintenance contracts by yard.</p>
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
                  <TableHead>Yard</TableHead>
                  <TableHead>Contractor</TableHead>
                  <TableHead>Period type</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead className="text-right">Amount/period</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground text-center py-6">No AMC contracts.</TableCell>
                  </TableRow>
                ) : (
                  list.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{a.yardId}</TableCell>
                      <TableCell>{a.contractorName}</TableCell>
                      <TableCell>{a.periodType ?? "—"}</TableCell>
                      <TableCell>{a.contractStart}</TableCell>
                      <TableCell>{a.contractEnd}</TableCell>
                      <TableCell className="text-right">₹{a.amountPerPeriod.toLocaleString()}</TableCell>
                      <TableCell><Badge variant="secondary">{a.status}</Badge></TableCell>
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
