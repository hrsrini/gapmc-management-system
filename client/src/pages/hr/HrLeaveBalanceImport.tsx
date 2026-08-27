import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { ArrowLeft, Copy, Upload } from "lucide-react";

interface ImportRow {
  employeeId: string;
  leaveType: string;
  balanceDays: number;
  setOffDays?: number;
  setOffExpiryDate?: string | null;
}

const SAMPLE_MANDATORY = `[
  { "employeeId": "EMP-010", "leaveType": "CL", "balanceDays": 8 },
  { "employeeId": "EMP-010", "leaveType": "RH", "balanceDays": 2 }
]`;

const SAMPLE_FULL = `[
  {
    "employeeId": "EMP-010",
    "leaveType": "EL",
    "balanceDays": 90,
    "setOffDays": 15,
    "setOffExpiryDate": "2026-12-31"
  },
  {
    "employeeId": "EMP-010",
    "leaveType": "CL",
    "balanceDays": 8,
    "setOffDays": 0,
    "setOffExpiryDate": null
  },
  {
    "employeeId": "EMP-011",
    "leaveType": "RH",
    "balanceDays": 2,
    "setOffDays": 0
  }
]`;

const LEAVE_TYPE_CODES = [
  "EL — Earned Leave",
  "HPL — Half Pay Leave",
  "COMMUTED — Commuted Leave",
  "CL — Casual Leave",
  "RH — Restricted Holiday",
  "SPL_H — Special Holiday",
  "ML — Maternity Leave",
  "PL — Paternity Leave",
  "EOL — Extraordinary Leave",
  "CCL — Child Care Leave",
] as const;

export default function HrLeaveBalanceImport() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [jsonText, setJsonText] = useState("");
  const [cutoverDate, setCutoverDate] = useState(new Date().toISOString().slice(0, 10));

  const importMutation = useMutation({
    mutationFn: async (body: { balances: ImportRow[]; cutoverDate: string }) => {
      const res = await fetch("/api/hr/leave-balances/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const details = (err as { details?: { skipped?: { employeeId: string; reason: string }[] } }).details;
        const skippedHint =
          details?.skipped?.length
            ? ` Skipped: ${details.skipped.map((s) => `${s.employeeId} (${s.reason})`).join("; ")}`
            : "";
        throw new Error(((err as { error?: string }).error ?? res.statusText) + skippedHint);
      }
      return res.json() as Promise<{ upserted: number; skipped?: { employeeId: string; leaveType: string; reason: string }[] }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/leave-balances"] });
      const skipped = data.skipped?.length ?? 0;
      toast({
        title: "Import complete",
        description:
          skipped > 0
            ? `${data.upserted} row(s) upserted; ${skipped} skipped (unknown employeeId or invalid row).`
            : `${data.upserted} balance row(s) upserted.`,
      });
      setJsonText("");
    },
    onError: (e: Error) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  function handleImport() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      toast({ title: "Invalid JSON", description: "Paste a JSON array of balance rows.", variant: "destructive" });
      return;
    }
    const balances = Array.isArray(parsed) ? parsed : (parsed as { balances?: ImportRow[] }).balances;
    if (!Array.isArray(balances) || balances.length === 0) {
      toast({ title: "Empty import", description: "Provide a non-empty balances array.", variant: "destructive" });
      return;
    }
    importMutation.mutate({ balances, cutoverDate });
  }

  async function copySample(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: `${label} copied to clipboard.` });
    } catch {
      toast({ title: "Copy failed", description: "Select the sample and copy manually.", variant: "destructive" });
    }
  }

  return (
    <AppShell
      breadcrumbs={[
        { label: "HR", href: "/hr/employees" },
        { label: "Leave opening balances", href: "/hr/leave-balances" },
        { label: "Import" },
      ]}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import leave opening balances
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Paste a JSON <strong>array</strong> of balance rows (or an object with a{" "}
            <code className="text-xs bg-muted px-1 rounded">balances</code> array), then click{" "}
            <strong>Import balances</strong>. Existing rows for the same employee + leave type are updated
            (upsert).
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-md border bg-muted/30 p-4 space-y-4 text-sm">
            <div>
              <h3 className="font-medium mb-2">How to upload</h3>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Prepare a JSON array using the field rules and samples below (replace EMP-010 with real employee codes).</li>
                <li>Paste the JSON into the Balances JSON box (or click Load sample).</li>
                <li>Optionally set Cutover date (stored as import metadata only).</li>
                <li>Click Import balances, then open Leave opening balances to verify.</li>
              </ol>
            </div>

            <div>
              <h3 className="font-medium mb-2">Fields</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="py-1.5 pr-3 font-medium">Field</th>
                      <th className="py-1.5 pr-3 font-medium">Required</th>
                      <th className="py-1.5 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="text-muted-foreground">
                    <tr className="border-b align-top">
                      <td className="py-1.5 pr-3">
                        <code className="text-xs bg-muted px-1 rounded text-foreground">employeeId</code>
                      </td>
                      <td className="py-1.5 pr-3">Yes</td>
                      <td className="py-1.5">
                        Employee code <code className="text-xs bg-muted px-1 rounded text-foreground">EMP-NNN</code>{" "}
                        (preferred) or internal system id. Must already exist in Employees.
                      </td>
                    </tr>
                    <tr className="border-b align-top">
                      <td className="py-1.5 pr-3">
                        <code className="text-xs bg-muted px-1 rounded text-foreground">leaveType</code>
                      </td>
                      <td className="py-1.5 pr-3">Yes</td>
                      <td className="py-1.5">
                        Standard code only (same as Leave Application). One row per employee + type.
                      </td>
                    </tr>
                    <tr className="border-b align-top">
                      <td className="py-1.5 pr-3">
                        <code className="text-xs bg-muted px-1 rounded text-foreground">balanceDays</code>
                      </td>
                      <td className="py-1.5 pr-3">Yes</td>
                      <td className="py-1.5">Number ≥ 0 (decimals allowed, e.g. 0.5).</td>
                    </tr>
                    <tr className="border-b align-top">
                      <td className="py-1.5 pr-3">
                        <code className="text-xs bg-muted px-1 rounded text-foreground">setOffDays</code>
                      </td>
                      <td className="py-1.5 pr-3">No</td>
                      <td className="py-1.5">EL set-off bucket days; defaults to 0 if omitted.</td>
                    </tr>
                    <tr className="align-top">
                      <td className="py-1.5 pr-3">
                        <code className="text-xs bg-muted px-1 rounded text-foreground">setOffExpiryDate</code>
                      </td>
                      <td className="py-1.5 pr-3">No</td>
                      <td className="py-1.5">
                        YYYY-MM-DD when set-off expires; use <code className="text-xs bg-muted px-1 rounded text-foreground">null</code>{" "}
                        or omit if none.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="font-medium mb-2">Allowed leaveType codes</h3>
              <ul className="grid gap-1 sm:grid-cols-2 text-muted-foreground">
                {LEAVE_TYPE_CODES.map((c) => (
                  <li key={c}>
                    <code className="text-xs bg-muted px-1 rounded text-foreground">{c.split(" — ")[0]}</code>
                    {" — "}
                    {c.split(" — ")[1]}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">Sample — mandatory fields only</h3>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setJsonText(SAMPLE_MANDATORY)}>
                    Load sample
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => copySample(SAMPLE_MANDATORY, "Mandatory sample")}>
                    <Copy className="h-3.5 w-3.5 mr-1" />
                    Copy
                  </Button>
                </div>
              </div>
              <pre className="overflow-x-auto rounded-md border bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre">
                {SAMPLE_MANDATORY}
              </pre>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">Sample — all fields</h3>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setJsonText(SAMPLE_FULL)}>
                    Load sample
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => copySample(SAMPLE_FULL, "Full sample")}>
                    <Copy className="h-3.5 w-3.5 mr-1" />
                    Copy
                  </Button>
                </div>
              </div>
              <pre className="overflow-x-auto rounded-md border bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre">
                {SAMPLE_FULL}
              </pre>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="cutover-date">
              Cutover date (go-live / as-of date for opening balances; audit metadata only — does not change balances)
            </Label>
            <Input id="cutover-date" type="date" value={cutoverDate} onChange={(e) => setCutoverDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="balance-json">Balances JSON</Label>
            <Textarea
              id="balance-json"
              rows={14}
              className="font-mono text-xs"
              placeholder={SAMPLE_MANDATORY}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" asChild>
              <Link href="/hr/leave-balances">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to balances
              </Link>
            </Button>
            <Button type="button" onClick={handleImport} disabled={importMutation.isPending || !jsonText.trim()}>
              Import balances
            </Button>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
