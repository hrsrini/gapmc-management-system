import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { formatInr } from "@/lib/formatInr";
import { ArrowLeft, FileStack, Loader2 } from "lucide-react";

interface RentInvoiceRow {
  id: string;
  invoiceNo?: string | null;
  periodMonth: string;
  assetId: string;
  yardId: string;
  tenantLicenceId: string;
  rentAmount: number;
  totalAmount: number;
  status: string;
  combinedBundleId?: string | null;
}

interface AssetRef {
  id: string;
  assetId: string;
}

export default function IomsRentCombinedInvoiceForm() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [periodMonth, setPeriodMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: invoices = [], isLoading } = useQuery<RentInvoiceRow[]>({
    queryKey: ["/api/ioms/rent/invoices"],
  });
  const { data: assets = [] } = useQuery<AssetRef[]>({ queryKey: ["/api/ioms/assets"] });
  const assetLabel = Object.fromEntries(assets.map((a) => [a.id, a.assetId]));

  const eligible = useMemo(() => {
    const pm = periodMonth.trim();
    return invoices.filter(
      (inv) =>
        inv.periodMonth === pm &&
        (inv.status === "Approved" || inv.status === "Overdue") &&
        !String(inv.combinedBundleId ?? "").trim(),
    );
  }, [invoices, periodMonth]);

  const groups = useMemo(() => {
    const m = new Map<string, RentInvoiceRow[]>();
    for (const inv of eligible) {
      const key = `${inv.yardId}::${inv.tenantLicenceId}`;
      const arr = m.get(key) ?? [];
      arr.push(inv);
      m.set(key, arr);
    }
    return Array.from(m.entries()).filter(([, rows]) => rows.length >= 2);
  }, [eligible]);

  const createMutation = useMutation({
    mutationFn: async (invoiceIds: string[]) => {
      const res = await fetch("/api/ioms/rent/combined-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ invoiceIds }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json() as Promise<{ id: string }>;
    },
    onSuccess: (data) => {
      toast({ title: "Combined invoice created", description: "Bundle PDF is available; individual premises PDFs are disabled." });
      setLocation(`/rent/ioms/combined-invoices/${data.id}`);
    },
    onError: (e: Error) => {
      toast({ title: "Create failed", description: e.message, variant: "destructive" });
    },
  });

  const toggle = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectedRows = eligible.filter((r) => selected.has(r.id));
  const sameGroup =
    selectedRows.length >= 2 &&
    selectedRows.every(
      (r) => r.yardId === selectedRows[0]!.yardId && r.tenantLicenceId === selectedRows[0]!.tenantLicenceId,
    );

  return (
    <AppShell
      breadcrumbs={[
        { label: "Rent (IOMS)", href: "/rent/ioms" },
        { label: "Combined invoices", href: "/rent/ioms/combined-invoices" },
        { label: "Create" },
      ]}
    >
      <Button variant="ghost" size="sm" className="mb-4" asChild>
        <Link href="/rent/ioms/combined-invoices">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileStack className="h-5 w-5" />
            Create combined tax invoice
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Select two or more approved invoices for the same tenant, yard, and billing month. Numbering reuses the yard/month sequence with a -CMB suffix.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="max-w-xs space-y-2">
            <Label htmlFor="periodMonth">Billing month (YYYY-MM)</Label>
            <Input
              id="periodMonth"
              value={periodMonth}
              onChange={(e) => {
                setPeriodMonth(e.target.value);
                setSelected(new Set());
              }}
              placeholder="2026-01"
            />
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading invoices…</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No eligible groups (need ≥2 unbundled Approved invoices for the same tenant and yard in this month).
            </p>
          ) : (
            <div className="space-y-6">
              {groups.map(([key, rows]) => (
                <div key={key} className="border rounded-md p-4 space-y-2">
                  <p className="text-sm font-medium">Tenant {rows[0]!.tenantLicenceId} · Yard {rows[0]!.yardId}</p>
                  {rows.map((inv: RentInvoiceRow) => (
                    <label key={inv.id} className="flex items-center gap-3 text-sm py-1">
                      <Checkbox
                        checked={selected.has(inv.id)}
                        onCheckedChange={(v) => toggle(inv.id, v === true)}
                      />
                      <span className="font-mono">{inv.invoiceNo ?? inv.id}</span>
                      <span>{assetLabel[inv.assetId] ?? inv.assetId}</span>
                      <span className="text-muted-foreground">{formatInr(inv.totalAmount)}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}

          <Button
            type="button"
            disabled={!sameGroup || createMutation.isPending}
            onClick={() => createMutation.mutate(Array.from(selected))}
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Create bundle ({selected.size} selected)
          </Button>
          {selected.size > 0 && !sameGroup ? (
            <p className="text-sm text-destructive">Selected invoices must share the same tenant and yard.</p>
          ) : null}
        </CardContent>
      </Card>
    </AppShell>
  );
}
