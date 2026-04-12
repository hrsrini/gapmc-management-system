import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, Clock, Database } from "lucide-react";
import { formatDisplayDateTime } from "@/lib/dateFormat";

interface HealthResponse {
  status: "ok" | "degraded";
  database: "ok" | "error";
  uptimeSeconds: number;
  timestamp: string;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

export default function Health() {
  const { data, isLoading, error, refetch } = useQuery<HealthResponse>({
    queryKey: ["/api/health"],
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Health Check</CardTitle>
            <CardDescription>Checking server and database status…</CardDescription>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <XCircle className="h-6 w-6 text-destructive" />
              Health Check Unavailable
            </CardTitle>
            <CardDescription>
              Could not reach the server. Ensure the backend is running (e.g. <code className="text-xs bg-muted px-1 rounded">npm run dev</code>).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{String(error?.message ?? "Unknown error")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isHealthy = data.status === "ok";
  const dbOk = data.database === "ok";

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <Card className={`w-full max-w-md ${isHealthy ? "" : "border-amber-500"}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isHealthy ? (
              <CheckCircle2 className="h-6 w-6 text-green-600" />
            ) : (
              <XCircle className="h-6 w-6 text-amber-600" />
            )}
            Health Check
          </CardTitle>
          <CardDescription>
            Server and database status. This page is used for monitoring and does not require login.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <span className="flex items-center gap-2 font-medium">
              <Database className="h-4 w-4" />
              Database
            </span>
            <Badge variant={dbOk ? "default" : "destructive"}>
              {dbOk ? "Connected" : "Disconnected"}
            </Badge>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <span className="flex items-center gap-2 font-medium">
              <Clock className="h-4 w-4" />
              Uptime
            </span>
            <span className="text-sm text-muted-foreground">
              {formatUptime(data.uptimeSeconds)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Last checked: {formatDisplayDateTime(data.timestamp)}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-sm text-primary hover:underline"
          >
            Refresh
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
