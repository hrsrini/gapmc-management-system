import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, AlertCircle } from "lucide-react";
import { ADMIN_403_MESSAGE } from "@/lib/queryClient";

interface User {
  id: string;
  email: string;
  username?: string | null;
  name: string;
  phone?: string | null;
  isActive: boolean;
  createdAt?: string | null;
}

export default function AdminUsers() {
  const { data: users, isLoading, isError, error } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
  });

  const isAccessDenied = isError && (error instanceof Error) && (error.message.includes("403") || error.message.includes("Access denied") || error.message.includes("Insufficient"));

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/users" }, { label: "Users" }]}>
        <Card className={isAccessDenied ? "bg-amber-500/10 border-amber-500/30" : "bg-destructive/10 border-destructive/20"}>
          <CardContent className="p-6 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              <span className={isAccessDenied ? "text-amber-700 dark:text-amber-400" : "text-destructive"}>
                {isAccessDenied ? ADMIN_403_MESSAGE : (error instanceof Error ? error.message : "Failed to load users.")}
              </span>
            </div>
            {isAccessDenied && (
              <p className="text-sm text-muted-foreground">Log out and sign in as admin@gapmc.local to access this section.</p>
            )}
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/users" }, { label: "Users" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Users
          </CardTitle>
          <p className="text-sm text-muted-foreground">IOMS M-10: System users and role assignment.</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(users ?? []).map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.name}</TableCell>
                    <TableCell className="font-mono text-sm">{u.email}</TableCell>
                    <TableCell className="font-mono text-sm">{u.username ?? "—"}</TableCell>
                    <TableCell>{u.phone ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={u.isActive ? "default" : "secondary"}>{u.isActive ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!users || users.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No users. Run the M-10 seed script to create an admin user.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
