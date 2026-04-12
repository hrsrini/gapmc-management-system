import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, Printer } from "lucide-react";
import { formatDisplayDateTime } from "@/lib/dateFormat";

interface VerifyResult {
  receiptNo: string;
  amount: number;
  totalAmount: number;
  revenueHead: string;
  paymentMode: string;
  status: string;
  createdAt: string;
}

export default function VerifyReceipt() {
  const { receiptNo } = useParams<{ receiptNo: string }>();
  const verifyUrl = receiptNo ? `/api/ioms/receipts/verify/${encodeURIComponent(receiptNo)}` : "";
  const { data, isLoading, isError } = useQuery<VerifyResult>({
    queryKey: [verifyUrl],
    enabled: !!receiptNo,
  });

  if (!receiptNo) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Use a receipt number in the URL: /verify/GAPLMB/...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
        <Card className="w-full max-w-md border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="h-6 w-6" />
              Receipt not found
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground font-mono text-sm break-all">{receiptNo}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30 print:p-8 print:bg-white">
      <Card className="w-full max-w-md print:shadow-none print:border">
        <CardHeader className="print:space-y-2">
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-6 w-6 text-green-600" />
            Receipt verified
          </CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit print:hidden"
            onClick={() => window.print()}
          >
            <Printer className="h-4 w-4 mr-2" />
            Print / save as PDF
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Receipt No</span>
            <span className="font-mono font-medium">{data.receiptNo}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Amount</span>
            <span>₹{Number(data.totalAmount).toLocaleString("en-IN")}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Revenue head</span>
            <span>{data.revenueHead}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Payment mode</span>
            <span>{data.paymentMode}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <span className="font-medium">{data.status}</span>
          </div>
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Created</span>
            <span>{data.createdAt ? formatDisplayDateTime(data.createdAt) : "—"}</span>
          </div>
          <div className="flex flex-col items-center gap-2 pt-4 border-t print:break-inside-avoid">
            <span className="text-xs text-muted-foreground print:hidden">Scan to open verification page</span>
            <img
              src={`/api/ioms/receipts/public/qr?receiptNo=${encodeURIComponent(data.receiptNo)}`}
              alt=""
              width={240}
              height={240}
              className="rounded-md border bg-white p-2 print:block"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
