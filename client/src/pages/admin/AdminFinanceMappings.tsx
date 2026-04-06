import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { BookMarked, Loader2 } from "lucide-react";
import { useState } from "react";

interface TallyLedger {
  id: string;
  ledgerName: string;
  primaryGroup: string;
  statementClass: string;
}

interface ExpenditureHead {
  id: string;
  code: string;
  description: string;
  tallyLedgerId?: string | null;
}

export default function AdminFinanceMappings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [localMap, setLocalMap] = useState<Record<string, string>>({});

  const { data: ledgers = [], isLoading: ledgersLoading } = useQuery<TallyLedger[]>({
    queryKey: ["/api/ioms/reference/tally-ledgers"],
  });

  const { data: heads = [], isLoading: headsLoading } = useQuery<ExpenditureHead[]>({
    queryKey: ["/api/ioms/expenditure-heads"],
  });

  const mutation = useMutation({
    mutationFn: async ({ headId, tallyLedgerId }: { headId: string; tallyLedgerId: string | null }) => {
      const res = await apiRequest("PUT", `/api/admin/expenditure-heads/${headId}/tally-ledger`, {
        tallyLedgerId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/expenditure-heads"] });
      toast({ title: "Mapping saved" });
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  function valueFor(h: ExpenditureHead): string {
    return localMap[h.id] ?? h.tallyLedgerId ?? "__none__";
  }

  return (
    <AppShell
      breadcrumbs={[
        { label: "Admin", href: "/admin/users" },
        { label: "Finance mappings" },
      ]}
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookMarked className="h-7 w-7" />
            Tally ledger mappings
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Link expenditure heads to the seeded chart of accounts. Tally CSV export uses these mappings.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Expenditure head → Tally ledger</CardTitle>
            <CardDescription>M-06 payment vouchers; admin-only updates.</CardDescription>
          </CardHeader>
          <CardContent>
            {headsLoading || ledgersLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Tally ledger</TableHead>
                    <TableHead className="w-[120px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {heads.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="font-mono text-sm">{h.code}</TableCell>
                      <TableCell>{h.description}</TableCell>
                      <TableCell>
                        <Select
                          value={valueFor(h)}
                          onValueChange={(v) => setLocalMap((m) => ({ ...m, [h.id]: v }))}
                        >
                          <SelectTrigger className="w-[280px]">
                            <SelectValue placeholder="Select ledger" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— None —</SelectItem>
                            {ledgers.map((l) => (
                              <SelectItem key={l.id} value={l.id}>
                                {l.ledgerName} ({l.primaryGroup})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          disabled={mutation.isPending}
                          onClick={() => {
                            const v = valueFor(h);
                            mutation.mutate({
                              headId: h.id,
                              tallyLedgerId: v === "__none__" ? null : v,
                            });
                          }}
                        >
                          Save
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ledger catalogue</CardTitle>
            <CardDescription>Read-only list from <code className="text-xs">tally_ledgers</code> (seed from PDF).</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[320px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Class</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledgers.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.ledgerName}</TableCell>
                    <TableCell>{l.primaryGroup}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{l.statementClass}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
