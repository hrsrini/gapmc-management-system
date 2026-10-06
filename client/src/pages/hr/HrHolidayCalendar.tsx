import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { Calendar, Plus, Pencil, Trash2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface HolidayRow {
  id: string;
  year: number;
  date: string;
  name: string;
  category: string;
  isTentative: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

const CATEGORIES = ["Public", "Special", "Restricted", "AdHoc"] as const;

const categoryColor: Record<string, string> = {
  Public: "bg-red-100 text-red-800",
  Special: "bg-blue-100 text-blue-800",
  Restricted: "bg-amber-100 text-amber-800",
  AdHoc: "bg-green-100 text-green-800",
};

const HOLIDAY_YEAR_END = 2040;

/** Display / form date: DD-MM-YYYY. Storage API remains YYYY-MM-DD. */
function isoToDdMmYyyy(iso: string | null | undefined): string {
  const raw = String(iso ?? "").trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return raw;
}

function ddMmYyyyToIso(display: string | null | undefined): string | null {
  const raw = String(display ?? "").trim();
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 1900 || yyyy > HOLIDAY_YEAR_END) return null;
  const iso = `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const check = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(check.getTime())) return null;
  if (check.getFullYear() !== yyyy || check.getMonth() + 1 !== mm || check.getDate() !== dd) return null;
  return iso;
}

export default function HrHolidayCalendar() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const canWrite = can("M-01", "Create");

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(Math.min(Math.max(currentYear, 2025), HOLIDAY_YEAR_END));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<HolidayRow | null>(null);
  const [formDate, setFormDate] = useState("");
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState<string>("Public");
  const [formTentative, setFormTentative] = useState(false);

  const { data: holidays = [], isLoading } = useQuery<HolidayRow[]>({
    queryKey: ["/api/hr/holidays", selectedYear],
    queryFn: () => fetch(`/api/hr/holidays?year=${selectedYear}`).then((r) => r.json()),
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: { id?: string; date: string; name: string; category: string; isTentative: boolean }) => {
      const url = payload.id ? `/api/hr/holidays/${payload.id}` : "/api/hr/holidays";
      const method = payload.id ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/holidays", selectedYear] });
      toast({ title: "Holiday saved" });
      closeDialog();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/hr/holidays/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/holidays", selectedYear] });
      toast({ title: "Holiday deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openCreate = useCallback(() => {
    setEditRow(null);
    setFormDate("");
    setFormName("");
    setFormCategory("Public");
    setFormTentative(false);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((row: HolidayRow) => {
    setEditRow(row);
    setFormDate(isoToDdMmYyyy(row.date));
    setFormName(row.name);
    setFormCategory(row.category);
    setFormTentative(row.isTentative);
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setEditRow(null);
  }, []);

  const handleSave = useCallback(() => {
    const isoDate = ddMmYyyyToIso(formDate);
    if (!isoDate) {
      toast({
        title: "Invalid date",
        description: "Enter date as DD-MM-YYYY (e.g. 25-12-2026).",
        variant: "destructive",
      });
      return;
    }
    if (!formName.trim() || !formCategory) {
      toast({ title: "All fields required", variant: "destructive" });
      return;
    }
    saveMutation.mutate({
      id: editRow?.id,
      date: isoDate,
      name: formName.trim(),
      category: formCategory,
      isTentative: formTentative,
    });
  }, [formDate, formName, formCategory, formTentative, editRow, saveMutation, toast]);

  const yearOptions = useMemo(() => {
    const start = Math.min(currentYear - 1, selectedYear, 2025);
    const end = HOLIDAY_YEAR_END;
    const years: number[] = [];
    for (let y = start; y <= end; y++) years.push(y);
    return years;
  }, [currentYear, selectedYear]);

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              <CardTitle>Holiday Calendar</CardTitle>
            </div>
            <div className="flex items-center gap-3">
              <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canWrite && (
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4 mr-1" /> Add Holiday
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : holidays.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No holidays for {selectedYear}. Add holidays or use bulk import.</p>
            ) : (
              <div className="border rounded-md overflow-auto max-h-[60vh]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="p-2 text-left">Date</th>
                      <th className="p-2 text-left">Holiday Name</th>
                      <th className="p-2 text-left">Category</th>
                      <th className="p-2 text-left">Tentative</th>
                      {canWrite && <th className="p-2"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {holidays.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="p-2 font-mono">{isoToDdMmYyyy(r.date)}</td>
                        <td className="p-2">{r.name}</td>
                        <td className="p-2"><Badge className={categoryColor[r.category] ?? ""}>{r.category}</Badge></td>
                        <td className="p-2">{r.isTentative ? <Badge variant="outline">Tentative</Badge> : null}</td>
                        {canWrite && (
                          <td className="p-2">
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" className="text-destructive" onClick={() => { if (confirm(`Delete "${r.name}" on ${isoToDdMmYyyy(r.date)}?`)) deleteMutation.mutate(r.id); }}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-4 flex gap-4 text-sm text-muted-foreground">
              <span>
                <Badge className={categoryColor.Public}>Public</Badge> {holidays.filter((h) => h.category === "Public").length}
              </span>
              <span>
                <Badge className={categoryColor.Special}>Special</Badge> {holidays.filter((h) => h.category === "Special").length}
              </span>
              <span>
                <Badge className={categoryColor.Restricted}>Restricted</Badge> {holidays.filter((h) => h.category === "Restricted").length}
              </span>
              <span>
                <Badge className={categoryColor.AdHoc}>AdHoc</Badge> {holidays.filter((h) => h.category === "AdHoc").length}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editRow ? "Edit Holiday" : "Add Holiday"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Date (DD-MM-YYYY)</Label>
              <Input
                type="text"
                inputMode="numeric"
                placeholder="DD-MM-YYYY"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">Example: 25-12-2026</p>
            </div>
            <div>
              <Label>Holiday Name</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Republic Day" />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={formCategory} onValueChange={setFormCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="tentative" checked={formTentative} onChange={(e) => setFormTentative(e.target.checked)} />
              <Label htmlFor="tentative">Moon-dependent / Tentative (date may change)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
