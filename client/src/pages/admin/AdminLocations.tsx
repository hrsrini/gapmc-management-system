import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, AlertCircle } from "lucide-react";

interface Yard {
  id: string;
  name: string;
  code: string;
  type: string;
  phone?: string | null;
  mobile?: string | null;
  address?: string | null;
  isActive: boolean;
}

export default function AdminLocations() {
  const { data: yards, isLoading, isError } = useQuery<Yard[]>({
    queryKey: ["/api/admin/yards"],
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/users" }, { label: "Locations" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load locations. Ensure IOMS M-10 schema is seeded.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/users" }, { label: "Locations (Yards & Check Posts)" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Locations
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            IOMS M-10: Yards and check posts. Seed with <code className="text-xs bg-muted px-1 rounded">npx tsx scripts/seed-ioms-m10.ts</code> if empty.
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(yards ?? []).map((y) => (
                  <TableRow key={y.id}>
                    <TableCell className="font-mono">{y.code}</TableCell>
                    <TableCell>{y.name}</TableCell>
                    <TableCell>
                      <Badge variant={y.type === "Yard" ? "default" : "secondary"}>{y.type}</Badge>
                    </TableCell>
                    <TableCell>{y.phone ?? y.mobile ?? "—"}</TableCell>
                    <TableCell>{y.isActive ? "Active" : "Inactive"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!yards || yards.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No locations. Run the M-10 seed script.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
