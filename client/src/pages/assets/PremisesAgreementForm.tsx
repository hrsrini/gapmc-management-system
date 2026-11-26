import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useScopedActiveYards } from "@/hooks/useScopedActiveYards";
import { useYardLabels } from "@/hooks/useYardLabels";
import { filterYardTypeLocations } from "@/lib/legacyYardMatch";
import { inferAgreementTypeFromDates } from "@shared/premises-allocation";
import { splitDepositByArea } from "@shared/premises-agreement";
import { formatInr } from "@/lib/formatInr";
import { premisesAreaNumber } from "@/lib/premisesAgreementUi";
import { Search, X } from "lucide-react";

type VacantPremises = {
  id: string;
  premisesId: string;
  assetType: string;
  area: number | string | null;
  location: string | null;
  reason?: string;
};

type UnifiedEntity = { id: string; kind: string; refId: string; displayName?: string; name?: string; status?: string };

type MappedYard = { yardId: string; status: string; yardName?: string | null; yardCode?: string | null };

function safeReturnTo(raw: string): string {
  const t = raw.trim();
  if (!t.startsWith("/") || t.startsWith("//") || t.includes("://")) return "/assets/agreements";
  return t;
}

export default function PremisesAgreementForm() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [searchParams] = useSearchParams();
  const { data: yardsRaw = [] } = useScopedActiveYards();
  const { getYardName } = useYardLabels();
  const scopedYards = useMemo(() => filterYardTypeLocations(yardsRaw), [yardsRaw]);

  const prefillTrack = String(searchParams.get("track") ?? "").trim();
  const prefillRefId = String(searchParams.get("refId") ?? "").trim();
  const prefillYardId = String(searchParams.get("yardId") ?? "").trim();
  const returnTo = safeReturnTo(String(searchParams.get("returnTo") ?? ""));
  const lockedFromSource =
    Boolean(prefillRefId) && (prefillTrack === "TrackA" || prefillTrack === "TrackB");

  const [track, setTrack] = useState<"TrackA" | "TrackB">(
    prefillTrack === "TrackB" ? "TrackB" : "TrackA",
  );
  const [entityKey, setEntityKey] = useState(
    prefillRefId
      ? `${prefillTrack === "TrackB" ? "TrackB" : "TrackA"}:${prefillRefId}`
      : "",
  );
  const [yardId, setYardId] = useState(prefillYardId);
  const [allotmentDate, setAllotmentDate] = useState(new Date().toISOString().slice(0, 10));
  const [allotmentRef, setAllotmentRef] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [agreementTypeOverride, setAgreementTypeOverride] = useState("auto");
  const [revisionMode, setRevisionMode] = useState("StandardConsecutiveRenewal");
  const [periodNumber, setPeriodNumber] = useState("1");
  const [frequency, setFrequency] = useState("3");
  const [renewalTenure, setRenewalTenure] = useState("11");
  const [deposit, setDeposit] = useState("");
  const [penaltyClause, setPenaltyClause] = useState("");
  const [penaltyMethod, setPenaltyMethod] = useState("FixedPerDay");
  const [penaltyRate, setPenaltyRate] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [rents, setRents] = useState<Record<string, string>>({});
  const [commonRent, setCommonRent] = useState("");
  const [premisesSearch, setPremisesSearch] = useState("");
  const [selectorOpen, setSelectorOpen] = useState(false);

  const clearPremisesSelection = () => {
    setSelected({});
    setRents({});
    setSelectorOpen(false);
  };

  const { data: entities = [] } = useQuery<UnifiedEntity[]>({ queryKey: ["/api/ioms/unified-entities"] });

  const entityOptions = useMemo(() => {
    return entities
      .filter((e) => (track === "TrackA" ? e.kind === "TrackA" : e.kind === "TrackB"))
      .filter((e) => !e.status || e.status === "Active")
      .map((e) => ({
        value: `${e.kind}:${e.refId}`,
        label: e.displayName || e.name || e.refId,
        refId: e.refId,
      }));
  }, [entities, track]);

  useEffect(() => {
    if (!prefillRefId) return;
    const kind = prefillTrack === "TrackB" ? "TrackB" : "TrackA";
    setTrack(kind);
    setEntityKey(`${kind}:${prefillRefId}`);
    if (prefillYardId) setYardId(prefillYardId);
  }, [prefillRefId, prefillTrack, prefillYardId]);

  const selectedEntity =
    entityOptions.find((e) => e.value === entityKey) ||
    (prefillRefId ? entityOptions.find((e) => e.refId === prefillRefId) : undefined) ||
    (lockedFromSource && prefillRefId
      ? {
          value: `${prefillTrack === "TrackB" ? "TrackB" : "TrackA"}:${prefillRefId}`,
          label: prefillRefId,
          refId: prefillRefId,
        }
      : undefined);

  const allotteeRefId = selectedEntity?.refId ?? "";

  const { data: allotteeDetail } = useQuery<{
    name?: string;
    firmName?: string;
    mappedYards?: MappedYard[];
  }>({
    queryKey: [
      track === "TrackA"
        ? `/api/ioms/traders/licences/${encodeURIComponent(allotteeRefId)}`
        : `/api/ioms/entities/${encodeURIComponent(allotteeRefId)}`,
    ],
    enabled: Boolean(allotteeRefId),
  });

  const mappedActiveYards = useMemo(() => {
    const rows = (allotteeDetail?.mappedYards ?? []).filter((m) => m.status === "Active");
    return rows.map((m) => ({
      id: m.yardId,
      name: m.yardName || m.yardCode || getYardName(m.yardId),
    }));
  }, [allotteeDetail?.mappedYards, getYardName]);

  /** Yard choices: mapped Active yards for selected allottee ∩ user scope; else all scoped yards. */
  const yardOptions = useMemo(() => {
    if (!allotteeRefId) return scopedYards.map((y) => ({ id: y.id, name: y.name ?? y.code }));
    if (mappedActiveYards.length > 0) {
      const scopedIds = new Set(scopedYards.map((y) => y.id));
      const mapped = mappedActiveYards.filter((y) => scopedIds.has(y.id));
      return mapped.length > 0 ? mapped : mappedActiveYards;
    }
    return [];
  }, [allotteeRefId, mappedActiveYards, scopedYards]);

  useEffect(() => {
    if (!allotteeRefId) return;
    if (yardOptions.length === 0) {
      if (yardId) setYardId("");
      return;
    }
    if (yardId && yardOptions.some((y) => y.id === yardId)) return;
    const preferred =
      (prefillYardId && yardOptions.some((y) => y.id === prefillYardId) && prefillYardId) ||
      yardOptions[0]?.id ||
      "";
    if (preferred !== yardId) {
      setYardId(preferred);
      clearPremisesSelection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allotteeRefId, yardOptions, prefillYardId]);

  const vacantQs = yardId ? `/api/ioms/premises-agreements/vacant-premises?yardId=${encodeURIComponent(yardId)}` : "";
  const { data: vacant } = useQuery<{
    eligible: VacantPremises[];
    unavailable: Array<VacantPremises & { reason?: string }>;
  }>({
    queryKey: [vacantQs],
    enabled: Boolean(yardId),
  });

  const selectedPremises = (vacant?.eligible ?? []).filter((p) => selected[p.id]);
  const areas = selectedPremises.map((p) => premisesAreaNumber(p.area));
  const depositShares = splitDepositByArea(Number(deposit) || 0, areas);
  const totalArea = areas.reduce((s, a) => s + a, 0);
  const totalRent = selectedPremises.reduce((s, p) => s + (Number(rents[p.id]) || 0), 0);

  const inferredType = fromDate && toDate ? inferAgreementTypeFromDates(fromDate, toDate) : null;
  const canCreate =
    Boolean(selectedEntity && yardId && fromDate && toDate && selectedPremises.length > 0) &&
    fromDate <= toDate &&
    selectedPremises.every((p) => Number(rents[p.id] || 0) > 0);

  const allotteeLabel =
    selectedEntity?.label && selectedEntity.label !== selectedEntity.refId
      ? selectedEntity.label
      : allotteeDetail?.firmName || allotteeDetail?.name || selectedEntity?.label || "—";

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEntity) throw new Error("Select allottee");
      if (!yardId) throw new Error("Select location / yard");
      if (fromDate > toDate) throw new Error("Agreement To must be on or after Agreement From.");
      const agreementType =
        agreementTypeOverride === "auto"
          ? inferredType ?? "RentalAgreement"
          : agreementTypeOverride;
      const body = {
        track,
        traderLicenceId: track === "TrackA" ? selectedEntity.refId : undefined,
        entityId: track === "TrackB" ? selectedEntity.refId : undefined,
        yardId,
        allotteeName: allotteeLabel,
        allotmentDate,
        agreementRef: allotmentRef || undefined,
        fromDate,
        toDate,
        agreementType,
        rentRevisionMode: revisionMode,
        agreementPeriodNumber: Number(periodNumber) || 1,
        rentRevisionFrequency: Number(frequency) || 3,
        renewalTenureMonths: Number(renewalTenure) || undefined,
        totalSecurityDeposit: Number(deposit) || 0,
        penaltyClauseRef: penaltyClause || undefined,
        penaltyMethod,
        penaltyRate: Number(penaltyRate) || 0,
        premises: selectedPremises.map((p, i) => ({
          assetId: p.id,
          monthlyRent: Number(rents[p.id] || 0),
          areaSqm: areas[i],
        })),
      };
      const res = await fetch("/api/ioms/premises-agreements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string; message?: string }).error ||
            (data as { message?: string }).message ||
            res.statusText,
        );
      }
      return data as { id: string };
    },
    onSuccess: (data) => {
      toast({ title: "Draft agreement created" });
      setLocation(`/assets/agreements/${data.id}`);
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const eligibleFiltered = (vacant?.eligible ?? []).filter((p) => {
    const q = premisesSearch.trim().toLowerCase();
    if (!q) return true;
    return p.premisesId.toLowerCase().includes(q) || p.assetType.toLowerCase().includes(q);
  });

  const yardLabel = getYardName(yardId, "yard");

  return (
    <AppShell
      breadcrumbs={
        lockedFromSource
          ? [
              { label: track === "TrackA" ? "Licences" : "Entities", href: returnTo },
              { label: "New premises allotment" },
            ]
          : [
              { label: "Assets", href: "/assets" },
              { label: "Premises allocations", href: "/assets/agreements" },
              { label: "New allotment" },
            ]
      }
    >
      <div className="space-y-4 max-w-5xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">New premises allocation (draft)</h1>
            <p className="text-sm text-muted-foreground">
              Allocate one or more vacant premises to this tenant under a single agreement. Tenancy becomes Active only
              after DA approval.
            </p>
          </div>
          <Button asChild variant="ghost" size="icon">
            <Link href={returnTo}>
              <X className="h-5 w-5" />
            </Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>A. Tenant and location</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Track</Label>
              {lockedFromSource ? (
                <>
                  <Input
                    readOnly
                    value={track === "TrackA" ? "Track A (trader licence)" : "Track B (entity)"}
                  />
                  <p className="text-xs text-muted-foreground">Fixed from the source record.</p>
                </>
              ) : (
                <Select
                  value={track}
                  onValueChange={(v) => {
                    setTrack(v as "TrackA" | "TrackB");
                    setEntityKey("");
                    setYardId("");
                    clearPremisesSelection();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TrackA">Track A (trader licence)</SelectItem>
                    <SelectItem value="TrackB">Track B (entity)</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1">
              <Label>Allottee name *</Label>
              {lockedFromSource ? (
                <>
                  <Input readOnly value={allotteeLabel} />
                  <p className="text-xs text-muted-foreground">Taken from the licence / entity master.</p>
                </>
              ) : (
                <>
                  <Select
                    value={entityKey || undefined}
                    onValueChange={(v) => {
                      setEntityKey(v);
                      setYardId("");
                      clearPremisesSelection();
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select allottee" />
                    </SelectTrigger>
                    <SelectContent>
                      {entityOptions.map((e) => (
                        <SelectItem key={e.value} value={e.value}>
                          {e.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Taken from the licence / entity master.</p>
                </>
              )}
            </div>
            <div className="space-y-1">
              <Label>Location / Yard *</Label>
              <Select
                value={yardId || undefined}
                onValueChange={(v) => {
                  if (
                    selectedPremises.length > 0 &&
                    !window.confirm(
                      `Change yard? This clears the ${selectedPremises.length} selected premises.`,
                    )
                  ) {
                    return;
                  }
                  setYardId(v);
                  clearPremisesSelection();
                }}
                disabled={!allotteeRefId || yardOptions.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      !allotteeRefId
                        ? "Select allottee first"
                        : yardOptions.length === 0
                          ? "No Active mapped locations"
                          : "Select yard"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {yardOptions.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Only Active mapped locations for this allottee. All premises in one agreement must be in the same yard.
              </p>
            </div>
            <div className="space-y-1">
              <Label>Allotment date *</Label>
              <Input type="date" value={allotmentDate} onChange={(e) => setAllotmentDate(e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Allotment reference no.</Label>
              <Input value={allotmentRef} onChange={(e) => setAllotmentRef(e.target.value)} placeholder="Optional" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>B. Agreement details</CardTitle>
            <p className="text-sm text-muted-foreground">Entered once — applies to every premises below.</p>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Agreement from *</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Agreement to *</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm sm:col-span-2">
              Inferred agreement kind: {inferredType ? `from dates (${inferredType})` : "—"}
              {fromDate && toDate && fromDate > toDate ? (
                <span className="text-destructive"> — To must be on or after From</span>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label>Agreement type override</Label>
              <Select value={agreementTypeOverride} onValueChange={setAgreementTypeOverride}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto from dates</SelectItem>
                  <SelectItem value="RentalAgreement">RentalAgreement</SelectItem>
                  <SelectItem value="LeaseAgreement">LeaseAgreement</SelectItem>
                  <SelectItem value="LeaveAndLicence">LeaveAndLicence</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Rent revision mode *</Label>
              <Select value={revisionMode} onValueChange={setRevisionMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="StandardConsecutiveRenewal">Standard consecutive renewal</SelectItem>
                  <SelectItem value="PwdCertificate">PWD certificate</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Agreement Period Number</Label>
              <Input value={periodNumber} onChange={(e) => setPeriodNumber(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Defaults to 1 for a new agreement. Enter manually for migrated records. Goes up by 1 on each renewal.
              </p>
            </div>
            <div className="space-y-1">
              <Label>Rent Revision Frequency (agreement periods)</Label>
              <Input value={frequency} onChange={(e) => setFrequency(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                With 3, rent is revised at the start of Period 4.
              </p>
            </div>
            <div className="space-y-1">
              <Label>Renewal tenure (months)</Label>
              <Input value={renewalTenure} onChange={(e) => setRenewalTenure(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Penalty clause ref.</Label>
              <Input
                value={penaltyClause}
                onChange={(e) => setPenaltyClause(e.target.value)}
                placeholder="Clause no. in the agreement"
              />
            </div>
            <div className="space-y-1">
              <Label>Penalty calculation method</Label>
              <Select value={penaltyMethod} onValueChange={setPenaltyMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FixedPerDay">Fixed amount per day of delay</SelectItem>
                  <SelectItem value="PerDayOfRent">Per day of rent (rate × daily rent × days)</SelectItem>
                  <SelectItem value="PercentOfMonthlyRent">Percentage of rent</SelectItem>
                  <SelectItem value="Flat">Lump sum</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Penalty rate</Label>
              <Input
                value={penaltyRate}
                onChange={(e) => setPenaltyRate(e.target.value)}
                placeholder="As per agreement"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>C. Premises, rent and security deposit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Add vacant premises *</Label>
              <div className="flex flex-wrap gap-2">
                {selectedPremises.map((p) => (
                  <Badge key={p.id} variant="secondary" className="gap-1 pr-1">
                    {p.premisesId} · {p.assetType}
                    <button
                      type="button"
                      className="rounded-sm px-1 hover:bg-muted"
                      onClick={() => setSelected((s) => ({ ...s, [p.id]: false }))}
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
              <Button type="button" variant="outline" disabled={!yardId} onClick={() => setSelectorOpen((o) => !o)}>
                <Search className="h-4 w-4 mr-1" />
                {selectorOpen ? "Hide selector" : "Open premises selector"}
              </Button>
            </div>

            {selectorOpen && (
              <div className="border rounded-lg p-3 space-y-3 bg-muted/20">
                <Input
                  placeholder="Type premises ID or type…"
                  value={premisesSearch}
                  onChange={(e) => setPremisesSearch(e.target.value)}
                />
                <p className="text-sm">
                  Vacant in <strong>{yardLabel}</strong> · {eligibleFiltered.length} available · tick to add
                </p>
                <div className="max-h-56 overflow-auto divide-y border rounded-md bg-background">
                  {eligibleFiltered.map((p) => (
                    <label key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={Boolean(selected[p.id])}
                        onCheckedChange={(c) => setSelected((s) => ({ ...s, [p.id]: Boolean(c) }))}
                      />
                      <span className="font-mono w-36">{p.premisesId}</span>
                      <span className="w-24 text-muted-foreground">{p.assetType}</span>
                      <span className="ml-auto text-muted-foreground">
                        {premisesAreaNumber(p.area).toFixed(1)} sq m
                      </span>
                    </label>
                  ))}
                </div>
                {(vacant?.unavailable?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-1">Not available (cannot be selected)</p>
                    <div className="space-y-1 opacity-70">
                      {(vacant?.unavailable ?? []).map((u) => (
                        <div key={u.id} className="flex items-center gap-2 text-sm px-1">
                          <span className="font-mono">{u.premisesId}</span>
                          <Badge variant="outline" className="bg-orange-500/10 text-orange-800 border-orange-500/20">
                            {u.reason ?? "Unavailable"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {selectedPremises.length} selected · {totalArea.toFixed(1)} sq m total
                  </span>
                  <Button type="button" onClick={() => setSelectorOpen(false)}>
                    Done
                  </Button>
                </div>
                <Alert>
                  <AlertDescription>
                    If the yard is changed after premises are selected, confirm before clearing the selection.
                  </AlertDescription>
                </Alert>
              </div>
            )}

            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <Label>Common monthly rent (Rs.)</Label>
                <Input className="w-40" value={commonRent} onChange={(e) => setCommonRent(e.target.value)} />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const next = { ...rents };
                  for (const p of selectedPremises) next[p.id] = commonRent;
                  setRents(next);
                }}
              >
                Apply to all
              </Button>
              <div className="space-y-1">
                <Label>Total security deposit (Rs.)</Label>
                <Input className="w-40" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              One deposit for the agreement, split by area. Collection / SECDEP receipt is handled after draft create
              via Security deposits. If a premises is vacated later, only its share is refunded.
            </p>

            {selectedPremises.length > 0 && (
              <div className="border rounded-md overflow-hidden">
                <div className="px-3 py-2 bg-muted/40 text-sm flex items-center gap-2">
                  <Badge variant="secondary">{selectedPremises.length} selected</Badge>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="p-2">Premises</th>
                      <th className="p-2">Type</th>
                      <th className="p-2">Area (sq m)</th>
                      <th className="p-2">Monthly rent (Rs.)</th>
                      <th className="p-2">Deposit share (Rs.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPremises.map((p, i) => (
                      <tr key={p.id} className="border-b">
                        <td className="p-2 font-mono">{p.premisesId}</td>
                        <td className="p-2">{p.assetType}</td>
                        <td className="p-2">{areas[i]?.toFixed(1)}</td>
                        <td className="p-2">
                          <Input
                            className="w-28 h-8"
                            value={rents[p.id] ?? ""}
                            onChange={(e) => setRents((r) => ({ ...r, [p.id]: e.target.value }))}
                          />
                        </td>
                        <td className="p-2">{formatInr(depositShares[i] ?? 0)}</td>
                      </tr>
                    ))}
                    <tr className="bg-muted/30 font-medium">
                      <td className="p-2" colSpan={2}>
                        Total
                      </td>
                      <td className="p-2">{totalArea.toFixed(1)}</td>
                      <td className="p-2">{formatInr(totalRent)}</td>
                      <td className="p-2">{formatInr(Number(deposit) || 0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3 sticky bottom-0 bg-background/95 py-3 border-t">
          <p className="text-sm text-muted-foreground">
            {selectedPremises.length} premises · {formatInr(totalRent)} / month · {formatInr(Number(deposit) || 0)}{" "}
            deposit
          </p>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={returnTo}>Cancel</Link>
            </Button>
            <Button disabled={!canCreate || createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? "Creating…" : "Create draft"}
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
