import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Download, FileText, MapPin } from "lucide-react";
import { fetchApiGet } from "@/lib/queryClient";

type PostingPerson = {
  nameLine: string;
  designation: string;
  primaryLocationLabel: string;
  additionalChargeLabels: string[];
};

type PostingBlock = {
  key: string;
  title: string;
  people: PostingPerson[];
};

type PostingReport = {
  title: string;
  updatedOnDisplay: string;
  yards: PostingBlock[];
  checkposts: PostingBlock[];
  hoSections: PostingBlock[];
  hoExecutive: PostingBlock;
};

async function downloadPostingReport(format: "xlsx" | "pdf") {
  const res = await fetch(`/api/hr/reports/employee-posting?format=${format}`, { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(cd);
  const filename = match?.[1] ?? `Employee_Posting_Report.${format === "xlsx" ? "xlsx" : "pdf"}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function BlockPreview({ block, indexLabel }: { block: PostingBlock; indexLabel?: string }) {
  return (
    <div className="rounded-md border overflow-hidden">
      <div className="grid grid-cols-[3rem_1fr] bg-muted text-xs font-medium">
        <div className="p-2 border-r text-center">Sr. Nos.</div>
        <div className="p-2">{indexLabel ? `${indexLabel}. ${block.title}` : block.title}</div>
      </div>
      {block.people.length === 0 ? (
        <div className="p-3 text-sm text-muted-foreground">No employees</div>
      ) : (
        block.people.map((p, i) => (
          <div key={`${block.key}-${i}`} className="grid grid-cols-[3rem_1fr] border-t text-sm">
            <div className="p-2 border-r text-center tabular-nums">{i + 1}</div>
            <div className="p-2">
              <div className="font-medium">{p.nameLine}</div>
              <div className="text-muted-foreground">{p.designation}</div>
              {p.additionalChargeLabels.length > 0 ? (
                <div className="text-xs text-muted-foreground mt-1">
                  Additional Charge: {p.additionalChargeLabels.join("; ")}
                </div>
              ) : null}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default function HrEmployeePostingReport() {
  const { toast } = useToast();
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);

  const { data, isLoading, error } = useQuery<PostingReport>({
    queryKey: ["/api/hr/reports/employee-posting"],
    queryFn: () => fetchApiGet<PostingReport>("/api/hr/reports/employee-posting"),
  });

  async function onExport(format: "xlsx" | "pdf") {
    setExporting(format);
    try {
      await downloadPostingReport(format);
      toast({
        title: "Downloaded",
        description: format === "xlsx" ? "Excel report downloaded." : "PDF report downloaded.",
      });
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Could not export report.",
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  }

  return (
    <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Employee Posting Report" }]}>
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Employee Posting Report
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Primary Location Posted and Additional Charge Locations for Active employees (Admin only).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={exporting != null || isLoading}
              onClick={() => onExport("xlsx")}
            >
              <Download className="h-4 w-4 mr-1" />
              {exporting === "xlsx" ? "Exporting…" : "Export Excel"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={exporting != null || isLoading}
              onClick={() => onExport("pdf")}
            >
              <FileText className="h-4 w-4 mr-1" />
              {exporting === "pdf" ? "Exporting…" : "Export PDF"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? <Skeleton className="h-64 w-full" /> : null}
          {error ? (
            <p className="text-sm text-destructive">
              {(error as Error).message || "Failed to load posting report."}
            </p>
          ) : null}
          {data ? (
            <>
              <h2 className="text-center font-semibold">{data.title}</h2>

              {data.yards.length > 0 ? (
                <section className="space-y-3">
                  <h3 className="font-semibold text-sm tracking-wide">YARDS</h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {data.yards.map((b, i) => (
                      <BlockPreview key={b.key} block={b} indexLabel={String(i + 1)} />
                    ))}
                  </div>
                </section>
              ) : null}

              {data.checkposts.length > 0 ? (
                <section className="space-y-3">
                  <h3 className="font-semibold text-sm tracking-wide">CHECKPOSTS</h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {data.checkposts.map((b, i) => (
                      <BlockPreview key={b.key} block={b} indexLabel={String(i + 1)} />
                    ))}
                  </div>
                </section>
              ) : null}

              {(data.hoSections.length > 0 || data.hoExecutive.people.length > 0) ? (
                <section className="space-y-3">
                  <h3 className="font-semibold text-sm tracking-wide">HEAD OFFICE</h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {data.hoSections.map((b) => (
                      <BlockPreview key={b.key} block={b} />
                    ))}
                    {data.hoExecutive.people.length > 0 ? (
                      <BlockPreview block={data.hoExecutive} />
                    ) : null}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
    </AppShell>
  );
}
