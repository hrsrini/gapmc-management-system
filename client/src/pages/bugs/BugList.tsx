import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Bug, PlusCircle, LayoutDashboard, AlertCircle } from "lucide-react";
import { BUG_STATUSES } from "@shared/bug-taxonomy";
import { bugsListQueryKey, bugsListUrl } from "@/lib/bugsQueryKeys";
import { fetchApiGet } from "@/lib/queryClient";

interface BugRow {
  id: string;
  ticketNo: string;
  title: string;
  bugType: string;
  bugSubtype: string;
  severity: string;
  status: string;
  reporterUserId: string;
  reporterName: string;
  assignedToUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

function severityVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "critical") return "destructive";
  if (s === "high") return "destructive";
  if (s === "medium") return "secondary";
  return "outline";
}

export default function BugList() {
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [status, setStatus] = useState<string>("");
  const { data: list, isLoading, isError, error } = useQuery<BugRow[]>({
    queryKey: bugsListQueryKey(scope, status),
    queryFn: async ({ queryKey }) => {
      const [, , sc, st] = queryKey as readonly [string, string, "all" | "mine", string];
      const url = bugsListUrl(sc, st === "any" ? "" : st);
      return fetchApiGet<BugRow[]>(url);
    },
  });

  return (
    <AppShell
      breadcrumbs={[
        { label: "Bugs", href: "/bugs" },
        { label: "All tickets" },
      ]}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Bug className="h-5 w-5" />
            Bug tickets
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Everyone can see all reported bugs. You can add comments only on tickets you created.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button asChild variant="default" size="sm">
              <Link href="/bugs/new">
                <PlusCircle className="h-4 w-4 mr-2" />
                Report bug
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/bugs/dashboard">
                <LayoutDashboard className="h-4 w-4 mr-2" />
                Dashboard
              </Link>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-4 pt-4">
            <Tabs
              value={scope}
              onValueChange={(v) => setScope(v === "mine" ? "mine" : "all")}
            >
              <TabsList>
                <TabsTrigger value="all">All bugs</TabsTrigger>
                <TabsTrigger value="mine">My bugs</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="w-[min(100%,220px)] min-w-[180px]">
              <Select
                value={status || "any"}
                onValueChange={(v) => setStatus(v === "any" ? "" : v)}
              >
                <SelectTrigger aria-label="Filter by status">
                  <SelectValue placeholder="Any status" />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="any">Any status</SelectItem>
                  {BUG_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground pt-1">
            Showing:{" "}
            <span className="font-medium text-foreground">
              {scope === "mine" ? "My bugs" : "All bugs"}
            </span>
            {" · "}
            <span className="font-medium text-foreground">
              {status ? status.replace(/_/g, " ") : "Any status"}
            </span>
          </p>
        </CardHeader>
        <CardContent>
          {isError && (
            <div className="flex items-start gap-2 text-destructive text-sm py-4 rounded-md border border-destructive/30 bg-destructive/5 px-3">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Failed to load bugs.
                {error instanceof Error && error.message ? (
                  <span className="block mt-1 font-mono text-xs opacity-90 break-all">{error.message}</span>
                ) : null}
              </span>
            </div>
          )}
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Reporter</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list ?? []).map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-sm">
                      <Link href={`/bugs/${b.id}`} className="text-primary hover:underline">
                        {b.ticketNo}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate">{b.title}</TableCell>
                    <TableCell className="text-sm">
                      {b.bugType} / {b.bugSubtype}
                    </TableCell>
                    <TableCell>
                      <Badge variant={severityVariant(b.severity)}>{b.severity}</Badge>
                    </TableCell>
                    <TableCell>{b.reporterName}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{b.status.replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {b.createdAt?.slice(0, 16)?.replace("T", " ") ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && !isError && (!list || list.length === 0) && (
            <p className="text-sm text-muted-foreground py-6">No bugs match the current filters.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
