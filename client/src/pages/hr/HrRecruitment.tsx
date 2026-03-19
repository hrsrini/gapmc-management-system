import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Briefcase, AlertCircle } from "lucide-react";

interface RecruitmentRow {
  id: string;
  position: string;
  applicantName: string;
  qualification?: string | null;
  appliedDate: string;
  status: string;
  decision?: string | null;
}

export default function HrRecruitment() {
  const { data: list, isLoading, isError } = useQuery<RecruitmentRow[]>({
    queryKey: ["/api/hr/recruitment"],
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/recruitment" }, { label: "Recruitment" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load recruitment.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "HR", href: "/hr/recruitment" }, { label: "Recruitment" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Recruitment (M-01 HRMS)
          </CardTitle>
          <p className="text-sm text-muted-foreground">Job applications and interview outcomes.</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Position</TableHead>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Qualification</TableHead>
                  <TableHead>Applied</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.position}</TableCell>
                    <TableCell>{r.applicantName}</TableCell>
                    <TableCell>{r.qualification ?? "—"}</TableCell>
                    <TableCell>{r.appliedDate}</TableCell>
                    <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                    <TableCell>{r.decision ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!list || list.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No recruitment entries.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
