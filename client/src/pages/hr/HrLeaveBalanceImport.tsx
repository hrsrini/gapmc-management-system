import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Upload } from "lucide-react";

interface ImportRow {
  employeeId: string;
  leaveType: string;
  balanceDays: number;
  setOffDays?: number;
  setOffExpiryDate?: string | null;
}

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
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json() as Promise<{ upserted: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/leave-balances"] });
      toast({ title: "Import complete", description: `${data.upserted} balance row(s) upserted.` });
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

  return (
    <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Import leave balances" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import leave opening balances
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Paste JSON from staff Excel export. Each row needs <code className="text-xs bg-muted px-1 rounded">employeeId</code>,{" "}
            <code className="text-xs bg-muted px-1 rounded">leaveType</code>, and{" "}
            <code className="text-xs bg-muted px-1 rounded">balanceDays</code>. Optional:{" "}
            <code className="text-xs bg-muted px-1 rounded">setOffDays</code>,{" "}
            <code className="text-xs bg-muted px-1 rounded">setOffExpiryDate</code>.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="cutover-date">Cutover date (metadata)</Label>
            <Input id="cutover-date" type="date" value={cutoverDate} onChange={(e) => setCutoverDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="balance-json">Balances JSON</Label>
            <Textarea
              id="balance-json"
              rows={14}
              className="font-mono text-xs"
              placeholder={`[\n  { "employeeId": "...", "leaveType": "EL", "balanceDays": 15, "setOffDays": 0 }\n]`}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
            />
          </div>
          <Button type="button" onClick={handleImport} disabled={importMutation.isPending}>
            Import balances
          </Button>
        </CardContent>
      </Card>
    </AppShell>
  );
}
