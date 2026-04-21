import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Receipt, ArrowLeft, AlertCircle, ExternalLink, Download, QrCode } from "lucide-react";
import QRCode from "qrcode";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatDisplayDateTime } from "@/lib/dateFormat";

interface IomsReceipt {
  id: string;
  receiptNo: string;
  yardId: string;
  revenueHead: string;
  payerName?: string | null;
  payerType?: string | null;
  payerRefId?: string | null;
  amount: number;
  cgst?: number | null;
  sgst?: number | null;
  totalAmount: number;
  paymentMode: string;
  gatewayRef?: string | null;
  chequeNo?: string | null;
  bankName?: string | null;
  chequeDate?: string | null;
  sourceModule?: string | null;
  sourceRecordId?: string | null;
  qrCodeUrl?: string | null;
  pdfUrl?: string | null;
  status: string;
  createdBy: string;
  createdAt: string;
}
interface YardRef {
  id: string;
  name: string;
}

export default function IomsReceiptDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { can } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [gatewayTxnId, setGatewayTxnId] = useState<string | null>(null);

  const { data: receipt, isLoading, isError } = useQuery<IomsReceipt>({
    queryKey: ["/api/ioms/receipts", id],
    enabled: !!id,
  });
  const { data: yards = [] } = useQuery<YardRef[]>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  const canMockPay = can("M-05", "Create");

  const initiatePaymentMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ioms/receipts/${id}/payments/initiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ gateway: "MockGateway" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json() as Promise<{ gatewayTxnId: string }>;
    },
    onSuccess: (data) => {
      setGatewayTxnId(data.gatewayTxnId);
      toast({ title: "Payment initiated", description: `gatewayTxnId: ${data.gatewayTxnId}` });
    },
    onError: (e: Error) => toast({ title: "Payment initiate failed", description: e.message, variant: "destructive" }),
  });

  const callbackPaidMutation = useMutation({
    mutationFn: async () => {
      if (!gatewayTxnId) throw new Error("No gatewayTxnId to callback");
      const res = await fetch(`/api/ioms/receipts/${id}/payments/dev-simulate-callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ gatewayTxnId, status: "Paid", gatewayRef: "MOCK_REF" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      setGatewayTxnId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/receipts", id] });
      toast({ title: "Receipt marked as Paid (mock)", description: `Receipt updated.` });
    },
    onError: (e: Error) => toast({ title: "Callback failed", description: e.message, variant: "destructive" }),
  });

  const verifyUrl = useMemo(() => {
    if (!receipt?.receiptNo) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/verify/${encodeURIComponent(receipt.receiptNo)}`;
  }, [receipt?.receiptNo]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!verifyUrl) return;
      try {
        const url = await QRCode.toDataURL(verifyUrl, { margin: 2, width: 256 });
        if (!cancelled) setQrDataUrl(url);
      } catch {
        if (!cancelled) setQrDataUrl("");
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [verifyUrl]);

  const downloadQrPng = () => {
    if (!qrDataUrl || !receipt?.receiptNo) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `${receipt.receiptNo}-qr.png`;
    a.click();
  };

  const downloadServerPdf = async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/ioms/receipts/${id}/pdf`, { credentials: "include" });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `receipt-${(receipt?.receiptNo ?? id).replace(/[^\w.-]+/g, "_")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "PDF downloaded", description: "Server-generated receipt PDF." });
    } catch (e: unknown) {
      toast({
        title: "PDF failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (!id) setLocation("/receipts/ioms");
  }, [id, setLocation]);
  if (!id) return null;
  if (isLoading || receipt === undefined) {
    return (
      <AppShell breadcrumbs={[{ label: "Receipts", href: "/receipts" }, { label: "IOMS Receipt" }]}>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-8 w-48 mb-4" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </AppShell>
    );
  }
  if (isError || !receipt) {
    return (
      <AppShell breadcrumbs={[{ label: "Receipts", href: "/receipts" }, { label: "IOMS Receipt" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Receipt not found.</span>
            <Button variant="outline" size="sm" onClick={() => setLocation("/receipts/ioms")}>Back to list</Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Receipts", href: "/receipts" }, { label: receipt.receiptNo }]}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            {receipt.receiptNo}
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/receipts/ioms")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/verify/${encodeURIComponent(receipt.receiptNo)}`} target="_blank" rel="noopener noreferrer">
                Public verify <ExternalLink className="h-4 w-4 ml-1" />
              </a>
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadServerPdf()}>
              <Download className="h-4 w-4 mr-1" /> PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div><span className="text-muted-foreground">Yard</span><br />{yardById[receipt.yardId] ?? receipt.yardId}</div>
            <div><span className="text-muted-foreground">Revenue head</span><br />{receipt.revenueHead}</div>
            <div><span className="text-muted-foreground">Payer</span><br />{receipt.payerName ?? "—"}</div>
            <div><span className="text-muted-foreground">Status</span><br /><Badge variant={receipt.status === "Paid" ? "default" : "secondary"}>{receipt.status}</Badge></div>
            <div><span className="text-muted-foreground">Amount</span><br />₹{receipt.amount.toLocaleString()}</div>
            <div><span className="text-muted-foreground">CGST / SGST</span><br />₹{(receipt.cgst ?? 0).toLocaleString()} / ₹{(receipt.sgst ?? 0).toLocaleString()}</div>
            <div><span className="text-muted-foreground">Total</span><br />₹{receipt.totalAmount.toLocaleString()}</div>
            <div><span className="text-muted-foreground">Payment mode</span><br />{receipt.paymentMode}</div>
            {receipt.gatewayRef && <div><span className="text-muted-foreground">Gateway ref</span><br />{receipt.gatewayRef}</div>}
            {receipt.chequeNo && <div><span className="text-muted-foreground">Cheque no</span><br />{receipt.chequeNo} {receipt.bankName ? `(${receipt.bankName})` : ""}</div>}
            {receipt.sourceModule && <div><span className="text-muted-foreground">Source</span><br />{receipt.sourceModule} {receipt.sourceRecordId ?? ""}</div>}
            <div><span className="text-muted-foreground">Created</span><br />{formatDisplayDateTime(receipt.createdAt)} by {receipt.createdBy}</div>
            {canMockPay && receipt.status === "Pending" && (
              <div className="md:col-span-2">
                <span className="text-muted-foreground">Payment (Mock)</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {!gatewayTxnId ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => initiatePaymentMutation.mutate()}
                      disabled={initiatePaymentMutation.isPending}
                    >
                      Initiate payment
                    </Button>
                  ) : (
                    <>
                      <div className="text-xs text-muted-foreground break-all pt-1">
                        gatewayTxnId: {gatewayTxnId}
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => callbackPaidMutation.mutate()}
                        disabled={callbackPaidMutation.isPending}
                      >
                        Simulate Paid
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
            <div className="md:col-span-2">
              <span className="text-muted-foreground">QR</span><br />
              <div className="flex flex-col md:flex-row md:items-center gap-4 mt-2">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="Receipt QR code" className="h-40 w-40 border rounded" />
                ) : (
                  <div className="h-40 w-40 border rounded flex items-center justify-center text-muted-foreground">
                    <QrCode className="h-8 w-8" />
                  </div>
                )}
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground break-all">
                    {verifyUrl ? <>QR encodes public verify URL: <span className="font-mono">{verifyUrl}</span></> : "—"}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={downloadQrPng} disabled={!qrDataUrl}>
                      <Download className="h-4 w-4 mr-1" /> Download QR (PNG)
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <a href={verifyUrl} target="_blank" rel="noopener noreferrer">
                        Open verify link <ExternalLink className="h-4 w-4 ml-1" />
                      </a>
                    </Button>
                    {receipt.qrCodeUrl && (
                      <Button size="sm" variant="ghost" asChild>
                        <a href={receipt.qrCodeUrl} target="_blank" rel="noopener noreferrer">Legacy QR URL</a>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {receipt.pdfUrl && (
              <div className="md:col-span-2">
                <span className="text-muted-foreground">PDF</span><br />
                <a href={receipt.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-primary text-sm">Download PDF</a>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
