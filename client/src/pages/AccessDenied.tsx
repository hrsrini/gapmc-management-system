import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldX } from "lucide-react";
import { useAppHomeHref } from "@/hooks/useAppHomeHref";

export default function AccessDenied() {
  const homeHref = useAppHomeHref();
  return (
    <AppShell breadcrumbs={[{ label: "Access denied" }]}>
      <Card className="max-w-md mx-auto border-destructive/30 bg-destructive/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <ShieldX className="h-6 w-6" />
            Access denied
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            You don&apos;t have permission to perform this action. If you believe this is an error, contact your administrator.
          </p>
          <Button asChild variant="default">
            <Link href={homeHref}>Back to home</Link>
          </Button>
        </CardContent>
      </Card>
    </AppShell>
  );
}
