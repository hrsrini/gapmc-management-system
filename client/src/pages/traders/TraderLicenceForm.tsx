import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { useScopedActiveYards } from "@/hooks/useScopedActiveYards";
import { ArrowLeft, FileCheck, Loader2, AlertCircle, Eye } from "lucide-react";
import {
  isValidEmailFormat,
  isStrictAadhaar12Digits,
  parseIndianMobile10Digits,
  sanitizeMobile10Input,
} from "@shared/india-validation";
import { traderLicenceUsesBmSupplement } from "@shared/m02-licence-bm-bk";
import { useUploadFilePreview } from "@/hooks/useUploadFilePreview";
import { AuthenticatedBlobPreviewDialog } from "@/components/attachment/AuthenticatedBlobPreviewDialog";
import { PanInput } from "@/components/inputs/PanInput";

const LICENCE_TYPES = ["Associated", "Functionary", "Hamali", "Weighman", "AssistantTrader"] as const;

interface LicenceRow {
  id: string;
  licenceNo?: string | null;
  parentLicenceId?: string | null;
  applicationKind?: string | null;
  firmName: string;
  firmType?: string | null;
  yardId: string;
  contactName?: string | null;
  mobile: string;
  email?: string | null;
  address?: string | null;
  aadhaarToken?: string | null;
  pan?: string | null;
  gstin?: string | null;
  licenceType: string;
  feeAmount?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  status: string;
  isNonGstEntity?: boolean | null;
  dvReturnRemarks?: string | null;
  workflowRevisionCount?: number | null;
  fatherSpouseName?: string | null;
  dateOfBirth?: string | null;
  emergencyContactMobile?: string | null;
  characterCertIssuer?: string | null;
  characterCertDate?: string | null;
  bmFormDocUrl?: string | null;
  bmFormDocFile?: string | null;
  parentLicenceFeeSnapshot?: number | null;
  renewalNoArrearsDeclared?: boolean | null;
}

async function readApiError(res: Response): Promise<string> {
  const t = await res.text();
  try {
    const j = JSON.parse(t) as { error?: string; message?: string };
    return j.message || j.error || t || res.statusText;
  } catch {
    return t || res.statusText;
  }
}

function parseOptionalHttpUrlClient(v: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const t = v.trim();
  if (!t) return { ok: true, value: null };
  if (t.length > 4000) return { ok: false, message: "URL must be at most 4000 characters." };
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, message: "URL must start with http:// or https://." };
    }
    return { ok: true, value: t };
  } catch {
    return { ok: false, message: "Enter a valid URL or leave blank." };
  }
}

export default function TraderLicenceForm() {
  const params = useParams<{ id?: string }>();
  const editId = params.id;
  const isNew = !editId;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canCreate = can("M-02", "Create");
  const canUpdate = can("M-02", "Update");

  const { data: yards = [], isLoading: yardsLoading } = useScopedActiveYards();
  const yardOptions = useMemo(
    () => yards.filter((y) => String(y.type ?? "").toLowerCase() === "yard"),
    [yards],
  );

  const [firmName, setFirmName] = useState("");
  const [firmType, setFirmType] = useState("");
  const [yardId, setYardId] = useState("");
  const [contactName, setContactName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  /** New application: optional 12-digit Aadhaar. Edit: optional replacement only (empty = keep stored value). */
  const [aadhaarInput, setAadhaarInput] = useState("");
  const [pan, setPan] = useState("");
  const [gstin, setGstin] = useState("");
  const [licenceType, setLicenceType] = useState<string>(LICENCE_TYPES[0]!);
  const [feeAmount, setFeeAmount] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [nonGst, setNonGst] = useState(false);
  const [applicationKind, setApplicationKind] = useState<"New" | "Renewal">("New");
  const [parentLicenceId, setParentLicenceId] = useState<string>("");
  const [fatherSpouseName, setFatherSpouseName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [emergencyContactMobile, setEmergencyContactMobile] = useState("");
  const [characterCertIssuer, setCharacterCertIssuer] = useState("");
  const [characterCertDate, setCharacterCertDate] = useState("");
  const [bmFormDocUrl, setBmFormDocUrl] = useState("");
  const bmFileInputRef = useRef<HTMLInputElement>(null);
  const [bmPendingFile, setBmPendingFile] = useState<File | null>(null);
  const [bmUploadedPreviewOpen, setBmUploadedPreviewOpen] = useState(false);
  const bmPendingPreviewUrl = useUploadFilePreview(bmPendingFile);
  const [renewalNoArrearsDeclared, setRenewalNoArrearsDeclared] = useState(false);

  const { data: licence, isLoading: licenceLoading } = useQuery<LicenceRow>({
    queryKey: ["/api/ioms/traders/licences", editId],
    enabled: Boolean(editId),
  });

  const issued = Boolean(licence?.licenceNo && String(licence.licenceNo).trim());

  useEffect(() => {
    if (!isNew) return;
    const sp = new URLSearchParams(window.location.search);
    const lt = sp.get("licenceType");
    if (lt && LICENCE_TYPES.includes(lt as (typeof LICENCE_TYPES)[number])) {
      setLicenceType(lt);
    }
  }, [isNew]);

  useEffect(() => {
    if (!licence) return;
    setFirmName(licence.firmName ?? "");
    setFirmType(licence.firmType ?? "");
    setYardId(licence.yardId ?? "");
    setContactName(licence.contactName ?? "");
    setMobile(sanitizeMobile10Input(licence.mobile ?? ""));
    setEmail(licence.email ?? "");
    setAddress(licence.address ?? "");
    setAadhaarInput("");
    setPan(licence.pan ?? "");
    setGstin(licence.gstin ?? "");
    setLicenceType(licence.licenceType || LICENCE_TYPES[0]!);
    setFeeAmount(licence.feeAmount != null ? String(licence.feeAmount) : "");
    setValidFrom(licence.validFrom?.slice(0, 10) ?? "");
    setValidTo(licence.validTo?.slice(0, 10) ?? "");
    setNonGst(Boolean(licence.isNonGstEntity));
    setApplicationKind((licence.applicationKind === "Renewal" ? "Renewal" : "New") as "New" | "Renewal");
    setParentLicenceId(licence.parentLicenceId ?? "");
    setFatherSpouseName(licence.fatherSpouseName ?? "");
    setDateOfBirth(licence.dateOfBirth?.slice(0, 10) ?? "");
    setEmergencyContactMobile(sanitizeMobile10Input(licence.emergencyContactMobile ?? ""));
    setCharacterCertIssuer(licence.characterCertIssuer ?? "");
    setCharacterCertDate(licence.characterCertDate?.slice(0, 10) ?? "");
    setBmFormDocUrl(licence.bmFormDocUrl ?? "");
    setRenewalNoArrearsDeclared(Boolean(licence.renewalNoArrearsDeclared));
  }, [licence]);

  const buildPayload = (status: "Draft" | "Pending"): Record<string, unknown> => {
    const mobileDigits = parseIndianMobile10Digits(mobile);
    const fee =
      feeAmount.trim() === "" ? null : Number(feeAmount);
    const aTrim = aadhaarInput.trim();
    const bmParsed = parseOptionalHttpUrlClient(bmFormDocUrl);
    const base: Record<string, unknown> = {
      firmName: firmName.trim(),
      firmType: firmType.trim() || null,
      yardId,
      contactName: contactName.trim() || null,
      mobile: mobileDigits,
      email: email.trim() ? email.trim().toLowerCase() : null,
      address: address.trim() || null,
      pan: pan.trim() || null,
      gstin: gstin.trim() || null,
      licenceType,
      feeAmount: fee != null && Number.isFinite(fee) ? fee : null,
      validFrom: validFrom.trim() || null,
      validTo: validTo.trim() || null,
      status,
      isNonGstEntity: nonGst,
      applicationKind,
      parentLicenceId: parentLicenceId.trim() || null,
      fatherSpouseName: fatherSpouseName.trim() || null,
      dateOfBirth: dateOfBirth.trim() || null,
      emergencyContactMobile: parseIndianMobile10Digits(emergencyContactMobile) || null,
      characterCertIssuer: characterCertIssuer.trim() || null,
      characterCertDate: characterCertDate.trim() || null,
      bmFormDocUrl: bmParsed.ok ? bmParsed.value : null,
      renewalNoArrearsDeclared,
    };
    if (isNew) {
      base.aadhaarToken = aTrim || null;
    } else if (aTrim) {
      base.aadhaarToken = aTrim;
    }
    return base;
  };

  const validate = (status: "Draft" | "Pending"): boolean => {
    if (!firmName.trim()) {
      toast({ title: "Validation", description: "Firm / trader name is required.", variant: "destructive" });
      return false;
    }
    if (!yardId) {
      toast({ title: "Validation", description: "Select a yard.", variant: "destructive" });
      return false;
    }
    const mobileDigits = parseIndianMobile10Digits(mobile);
    if (!mobileDigits) {
      toast({ title: "Validation", description: "Enter a valid 10-digit mobile number.", variant: "destructive" });
      return false;
    }
    if (email.trim() && !isValidEmailFormat(email.trim())) {
      toast({ title: "Validation", description: "Enter a valid email or leave it blank.", variant: "destructive" });
      return false;
    }
    const aTrim = aadhaarInput.trim();
    if (aTrim && !isStrictAadhaar12Digits(aTrim)) {
      toast({
        title: "Validation",
        description: "Aadhaar must be exactly 12 digits when entered.",
        variant: "destructive",
      });
      return false;
    }
    const bmUrlCheck = parseOptionalHttpUrlClient(bmFormDocUrl);
    if (!bmUrlCheck.ok) {
      toast({ title: "BM supporting document", description: bmUrlCheck.message, variant: "destructive" });
      return false;
    }
    if (status === "Pending") {
      if (applicationKind === "Renewal" && !renewalNoArrearsDeclared) {
        toast({
          title: "BK declaration",
          description: "Confirm no outstanding market / licence arrears on the previous licence before submitting.",
          variant: "destructive",
        });
        return false;
      }
      if (traderLicenceUsesBmSupplement(licenceType)) {
        if (!fatherSpouseName.trim()) {
          toast({
            title: "Form BM",
            description: "Father / spouse name is required for this licence type.",
            variant: "destructive",
          });
          return false;
        }
        if (!dateOfBirth.trim()) {
          toast({ title: "Form BM", description: "Date of birth is required.", variant: "destructive" });
          return false;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth.trim())) {
          toast({ title: "Form BM", description: "Date of birth must be YYYY-MM-DD.", variant: "destructive" });
          return false;
        }
        const em = parseIndianMobile10Digits(emergencyContactMobile);
        if (!em) {
          toast({
            title: "Form BM",
            description: "Emergency contact mobile (10 digits) is required.",
            variant: "destructive",
          });
          return false;
        }
        if (!characterCertIssuer.trim()) {
          toast({
            title: "Form BM",
            description: "Character certificate issuing authority is required.",
            variant: "destructive",
          });
          return false;
        }
        if (characterCertDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(characterCertDate.trim())) {
          toast({
            title: "Form BM",
            description: "Character certificate date must be YYYY-MM-DD or left blank.",
            variant: "destructive",
          });
          return false;
        }
      }
    }
    return true;
  };

  const saveMutation = useMutation({
    mutationFn: async ({ status }: { status: "Draft" | "Pending" }) => {
      const payload = buildPayload(status);
      if (isNew) {
        const res = await fetch("/api/ioms/traders/licences", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await readApiError(res));
        return (await res.json()) as LicenceRow;
      }
      const res = await fetch(`/api/ioms/traders/licences/${editId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      return (await res.json()) as LicenceRow;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/traders/licences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/traders/licences", row.id] });
      toast({ title: "Saved", description: "Licence application saved." });
      if (isNew) {
        setLocation(`/traders/licences/${row.id}`);
      } else {
        setLocation(`/traders/licences/${row.id}`);
      }
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const uploadBmMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/ioms/traders/licences/${encodeURIComponent(editId!)}/bm-form-document`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) throw new Error(await readApiError(res));
      return (await res.json()) as LicenceRow;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/traders/licences", editId] });
      if (bmFileInputRef.current) bmFileInputRef.current.value = "";
      setBmPendingFile(null);
      toast({ title: "Uploaded", description: "BM supporting document file saved." });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const deleteBmMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ioms/traders/licences/${encodeURIComponent(editId!)}/bm-form-document`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await readApiError(res));
      return (await res.json()) as LicenceRow;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/traders/licences", editId] });
      toast({ title: "Removed", description: "Uploaded BM file removed." });
    },
    onError: (e: Error) => toast({ title: "Remove failed", description: e.message, variant: "destructive" }),
  });

  if (!isNew && !canUpdate) {
    return (
      <AppShell breadcrumbs={[{ label: "Licences", href: "/traders/licences" }, { label: "Edit" }]}>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Not allowed</AlertTitle>
          <AlertDescription>You do not have permission to edit licences.</AlertDescription>
        </Alert>
      </AppShell>
    );
  }

  if (isNew && !canCreate) {
    return (
      <AppShell breadcrumbs={[{ label: "Licences", href: "/traders/licences" }, { label: "New" }]}>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Not allowed</AlertTitle>
          <AlertDescription>You do not have permission to create licences.</AlertDescription>
        </Alert>
      </AppShell>
    );
  }

  if (!isNew && licenceLoading) {
    return (
      <AppShell breadcrumbs={[{ label: "Licences", href: "/traders/licences" }, { label: "Edit" }]}>
        <Skeleton className="h-96 w-full max-w-3xl" />
      </AppShell>
    );
  }

  if (!isNew && issued) {
    return (
      <AppShell breadcrumbs={[{ label: "Licences", href: "/traders/licences" }, { label: "Edit" }]}>
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Licence issued</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This application has a licence number and can no longer be edited. Open the record to view details.
            </p>
            <Button asChild>
              <Link href={`/traders/licences/${editId}`}>View licence</Link>
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const saving = saveMutation.isPending;
  const onSave = (status: "Draft" | "Pending") => {
    if (!validate(status)) return;
    saveMutation.mutate({ status });
  };

  return (
    <AppShell
      breadcrumbs={[
        { label: "Licences", href: "/traders/licences" },
        { label: isNew ? "Apply for new licence" : "Edit application" },
      ]}
    >
      <div className="max-w-3xl space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/traders/licences">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to list
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCheck className="h-5 w-5" />
              {isNew ? "Apply for new licence (M-02)" : "Edit licence application"}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Save a draft anytime, or submit for review. If the application was returned in query mode, update the fields
              and submit again — revisions are recorded in the audit trail.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {!isNew && licence?.status === "Query" && licence.dvReturnRemarks ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Returned for correction</AlertTitle>
                <AlertDescription className="whitespace-pre-wrap">{licence.dvReturnRemarks}</AlertDescription>
              </Alert>
            ) : null}

            {!isNew ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Application kind</Label>
                  <Input value={applicationKind} readOnly />
                </div>
                <div className="space-y-1">
                  <Label>Parent licence (for renewals)</Label>
                  {parentLicenceId ? (
                    <Button variant="outline" size="sm" asChild className="w-fit">
                      <Link href={`/traders/licences/${encodeURIComponent(parentLicenceId)}`}>
                        View parent
                      </Link>
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground py-2">—</p>
                  )}
                </div>
              </div>
            ) : null}

            {applicationKind === "Renewal" ? (
              <div className="rounded-md border bg-muted/30 p-4 space-y-3">
                <p className="text-sm font-medium">Form BK — Section 54 renewal</p>
                {licence?.parentLicenceFeeSnapshot != null && Number.isFinite(Number(licence.parentLicenceFeeSnapshot)) ? (
                  <p className="text-sm text-muted-foreground">
                    Parent licence fee on file at renewal:{" "}
                    <span className="font-medium text-foreground">₹{Number(licence.parentLicenceFeeSnapshot).toLocaleString()}</span>
                  </p>
                ) : null}
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="bk-no-arrears"
                    checked={renewalNoArrearsDeclared}
                    onCheckedChange={(c) => setRenewalNoArrearsDeclared(c === true)}
                  />
                  <Label htmlFor="bk-no-arrears" className="font-normal cursor-pointer leading-snug">
                    I declare there are no outstanding market-fee or licence-fee arrears against the previous licence
                    (required to submit this renewal for review).
                  </Label>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Firm / trader name *</Label>
                <Input value={firmName} onChange={(e) => setFirmName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Firm type</Label>
                <Input value={firmType} onChange={(e) => setFirmType(e.target.value)} placeholder="e.g. Partnership" />
              </div>
              <div className="space-y-2">
                <Label>Yard *</Label>
                <Select value={yardId || "__none__"} onValueChange={(v) => setYardId(v === "__none__" ? "" : v)} disabled={yardsLoading}>
                  <SelectTrigger>
                    <SelectValue placeholder={yardsLoading ? "Loading…" : "Select yard"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select…</SelectItem>
                    {yardOptions.map((y) => (
                      <SelectItem key={y.id} value={y.id}>
                        {y.code ? `${y.code} — ${y.name}` : y.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Contact name</Label>
                <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Licence type *</Label>
                <Select value={licenceType} onValueChange={setLicenceType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LICENCE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {traderLicenceUsesBmSupplement(licenceType) ? (
                <div className="space-y-4 sm:col-span-2 rounded-md border p-4">
                  <p className="text-sm font-medium">Form BM — Market functionary</p>
                  <p className="text-xs text-muted-foreground">
                    Go-live may still require the full SRS functionary checklist, role-specific approvals, and photo
                    capture beyond the fields below.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Father / spouse name *</Label>
                      <Input value={fatherSpouseName} onChange={(e) => setFatherSpouseName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Date of birth *</Label>
                      <Input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Emergency contact mobile *</Label>
                      <Input
                        value={emergencyContactMobile}
                        onChange={(e) => setEmergencyContactMobile(sanitizeMobile10Input(e.target.value))}
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="10-digit mobile"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Character certificate — issuing authority *</Label>
                      <Input value={characterCertIssuer} onChange={(e) => setCharacterCertIssuer(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Character certificate — date</Label>
                      <Input type="date" value={characterCertDate} onChange={(e) => setCharacterCertDate(e.target.value)} />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Supporting document — URL (optional)</Label>
                      <Input
                        value={bmFormDocUrl}
                        onChange={(e) => setBmFormDocUrl(e.target.value)}
                        placeholder="https://… (scan or hosted file)"
                        autoComplete="off"
                      />
                      <p className="text-xs text-muted-foreground">
                        Paste a public https link to the supporting document if available; must start with http:// or https://.
                      </p>
                    </div>
                    {isNew ? (
                      <p className="text-xs text-muted-foreground sm:col-span-2">
                        Save the application once as a draft, then reopen this screen to upload a BM scan (PDF or image), or keep using a URL only.
                      </p>
                    ) : !issued && (canCreate || canUpdate) ? (
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Supporting document — file (optional)</Label>
                        <p className="text-xs text-muted-foreground">
                          PDF, PNG, or JPEG, max 10 MB. Stored in the application blob store. Replaces any previous upload.
                        </p>
                        {licence?.bmFormDocFile ? (
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-auto px-2 text-primary font-medium hover:text-primary"
                              onClick={() => setBmUploadedPreviewOpen(true)}
                            >
                              <Eye className="h-4 w-4 mr-1 inline" />
                              View uploaded file
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={deleteBmMutation.isPending}
                              onClick={() => deleteBmMutation.mutate()}
                            >
                              Remove file
                            </Button>
                          </div>
                        ) : null}
                        <div className="flex flex-col gap-2 max-w-xl">
                          <Input
                            ref={bmFileInputRef}
                            type="file"
                            accept=".pdf,.png,.jpeg,.jpg,application/pdf,image/png,image/jpeg"
                            className="max-w-xs cursor-pointer"
                            disabled={uploadBmMutation.isPending}
                            onChange={(e) => {
                              const f = e.target.files?.[0] ?? null;
                              e.target.value = "";
                              setBmPendingFile(f);
                            }}
                          />
                          {bmPendingPreviewUrl ? (
                            bmPendingFile?.type === "application/pdf" ? (
                              <iframe
                                title="BM file preview"
                                src={bmPendingPreviewUrl}
                                className="w-full h-44 rounded-md border bg-background"
                              />
                            ) : (
                              <img
                                src={bmPendingPreviewUrl}
                                alt=""
                                className="max-h-40 max-w-full rounded-md border object-contain"
                              />
                            )
                          ) : null}
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              disabled={uploadBmMutation.isPending || !bmPendingFile}
                              onClick={() => {
                                if (bmPendingFile) uploadBmMutation.mutate(bmPendingFile);
                              }}
                            >
                              {uploadBmMutation.isPending ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                  Uploading…
                                </>
                              ) : (
                                "Upload selected file"
                              )}
                            </Button>
                            {bmPendingFile ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={uploadBmMutation.isPending}
                                onClick={() => setBmPendingFile(null)}
                              >
                                Clear selection
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>Mobile *</Label>
                <Input
                  value={mobile}
                  onChange={(e) => setMobile(sanitizeMobile10Input(e.target.value))}
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="10-digit mobile"
                  autoComplete="tel-national"
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Address</Label>
                <Textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Aadhaar</Label>
                {!isNew && licence?.aadhaarToken ? (
                  <p className="text-sm text-muted-foreground rounded-md border bg-muted/40 px-3 py-2">
                    On file (masked):{" "}
                    <span className="font-mono tabular-nums text-foreground">{licence.aadhaarToken}</span>
                    . Leave the field below empty to keep it; enter 12 digits only to replace.
                  </p>
                ) : null}
                <Input
                  value={aadhaarInput}
                  onChange={(e) => setAadhaarInput(e.target.value.replace(/\D/g, "").slice(0, 12))}
                  inputMode="numeric"
                  maxLength={12}
                  placeholder={
                    isNew
                      ? "Optional — 12 digits"
                      : licence?.aadhaarToken
                        ? "Optional — 12 digits to replace stored Aadhaar"
                        : "Optional — 12 digits"
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>PAN</Label>
                <PanInput
                  id="trader-licence-pan"
                  value={pan}
                  onChange={setPan}
                  uniquenessExcludes={editId ? { excludeTraderLicenceId: editId } : undefined}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>GSTIN</Label>
                <Input value={gstin} onChange={(e) => setGstin(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Fee amount (₹)</Label>
                <Input value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} inputMode="decimal" />
              </div>
              <div className="space-y-2">
                <Label>Valid from</Label>
                <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Valid to</Label>
                <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Checkbox id="non-gst" checked={nonGst} onCheckedChange={(c) => setNonGst(c === true)} />
                <Label htmlFor="non-gst" className="font-normal cursor-pointer">
                  Declared non-GST entity
                </Label>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2 border-t">
              <Button type="button" variant="secondary" disabled={saving} onClick={() => onSave("Draft")}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Save draft
              </Button>
              <Button type="button" disabled={saving} onClick={() => onSave("Pending")}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {licence?.status === "Query" ? "Resubmit for review" : "Submit for review"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <AuthenticatedBlobPreviewDialog
        open={bmUploadedPreviewOpen}
        onOpenChange={setBmUploadedPreviewOpen}
        title="BM supporting document"
        fetchPath={
          editId
            ? `/api/ioms/traders/licences/${encodeURIComponent(editId)}/bm-form-document`
            : null
        }
      />
    </AppShell>
  );
}
