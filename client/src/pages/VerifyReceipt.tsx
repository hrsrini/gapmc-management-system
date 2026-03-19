import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle } from "lucide-react";

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
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-6 w-6 text-green-600" />
            Receipt verified
          </CardTitle>
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
            <span>{data.createdAt ? new Date(data.createdAt).toLocaleString() : "—"}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
