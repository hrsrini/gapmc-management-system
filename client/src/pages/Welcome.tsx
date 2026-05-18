import { useAuth } from "@/context/AuthContext";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Leaf, Sparkles } from "lucide-react";

export default function Welcome() {
  const { user } = useAuth();
  const displayName = user?.name?.trim() || user?.email || "there";

  return (
    <AppShell breadcrumbs={[{ label: "Welcome" }]}>
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
        <Card className="w-full max-w-2xl border-border/80 shadow-sm">
          <CardContent className="p-8 sm:p-10 text-center space-y-6">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Leaf className="h-8 w-8" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Goa APMC</p>
              <h1 className="text-3xl font-bold tracking-tight text-foreground" data-testid="text-welcome">
                Welcome, {displayName}
              </h1>
              <p className="text-muted-foreground text-base max-w-md mx-auto">
                You are signed in to the Integrated Online Management System. Use the menu on the left to open the
                modules assigned to your role.
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground inline-flex items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" />
              <span>Select a section from the sidebar to get started.</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
