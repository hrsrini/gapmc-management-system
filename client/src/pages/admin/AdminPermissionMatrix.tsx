import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { AlertCircle, Loader2, Grid3X3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ADMIN_403_MESSAGE } from "@/lib/queryClient";

const MODULE_NAMES: Record<string, string> = {
  "M-01": "HR",
  "M-02": "Traders & Assets",
  "M-03": "Rent / Tax",
  "M-04": "Market Fee & Check Post",
  "M-05": "Receipts",
  "M-06": "Vouchers",
  "M-07": "Fleet",
  "M-08": "Construction",
  "M-09": "Correspondence (Dak)",
  "M-10": "Admin (RBAC)",
};

function moduleDisplay(moduleCode: string): string {
  const name = MODULE_NAMES[moduleCode];
  return name ? `${moduleCode} (${name})` : moduleCode;
}

interface Permission {
  id: string;
  module: string;
  action: string;
}
interface Role {
  id: string;
  name: string;
  tier: string;
}
interface RolePermission {
  roleId: string;
  permissionId: string;
}

function cellKey(roleId: string, permissionId: string) {
  return `${roleId}:${permissionId}`;
}

export default function AdminPermissionMatrix() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const canUpdate = can("M-10", "Update");
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});

  const { data: permissions = [], isLoading: permLoading, isError: permError, error: permErr } = useQuery<Permission[]>({
    queryKey: ["/api/admin/permissions"],
  });
  const { data: roles = [], isLoading: rolesLoading, isError: rolesError, error: rolesErr } = useQuery<Role[]>({
    queryKey: ["/api/admin/roles"],
  });
  const { data: rolePerms = [], isError: rpError, error: rolePermsError } = useQuery<RolePermission[]>({
    queryKey: ["/api/admin/role-permissions"],
  });

  const anyError = permError || rolesError || rpError;
  const errorObj = rolePermsError ?? rolesErr ?? permErr;
  const isAccessDenied = anyError && (errorObj instanceof Error) && (errorObj.message.includes("403") || errorObj.message.includes("Access denied") || errorObj.message.includes("Insufficient"));

  const hasPerm = useCallback(
    (roleId: string, permissionId: string) =>
      rolePerms.some((rp) => rp.roleId === roleId && rp.permissionId === permissionId),
    [rolePerms]
  );

  const isChecked = useCallback(
    (roleId: string, permissionId: string) => {
      const key = cellKey(roleId, permissionId);
      if (key in optimistic) return optimistic[key];
      return hasPerm(roleId, permissionId);
    },
    [hasPerm, optimistic]
  );

  const toggleMutation = useMutation({
    mutationFn: async ({
      roleId,
      permissionId,
      assign,
    }: {
      roleId: string;
      permissionId: string;
      assign: boolean;
    }) => {
      if (assign) {
        const res = await fetch("/api/admin/role-permissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roleId, permissionId }),
          credentials: "include",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error ?? res.statusText);
        }
      } else {
        const res = await fetch(
          `/api/admin/role-permissions?roleId=${encodeURIComponent(roleId)}&permissionId=${encodeURIComponent(permissionId)}`,
          { method: "DELETE", credentials: "include" }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error ?? res.statusText);
        }
      }
    },
    onMutate: ({ roleId, permissionId, assign }) => {
      const key = cellKey(roleId, permissionId);
      setOptimistic((prev) => ({ ...prev, [key]: assign }));
    },
    onSuccess: (_data, { roleId, permissionId }) => {
      const key = cellKey(roleId, permissionId);
      setOptimistic((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/role-permissions"] });
    },
    onError: (e: Error, { roleId, permissionId }) => {
      const key = cellKey(roleId, permissionId);
      setOptimistic((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/role-permissions"] });
      toast({ title: "Failed to update permission", description: e.message, variant: "destructive" });
    },
  });

  const loading = permLoading || rolesLoading;
  const updatingKey =
    toggleMutation.isPending && toggleMutation.variables
      ? cellKey(toggleMutation.variables.roleId, toggleMutation.variables.permissionId)
      : null;

  const handleChange = (roleId: string, permissionId: string) => {
    if (!canUpdate) return;
    const checked = isChecked(roleId, permissionId);
    toggleMutation.mutate({ roleId, permissionId, assign: !checked });
  };

  if (anyError) {
    return (
      <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/users" }, { label: "Permission matrix" }]}>
        <Card className={isAccessDenied ? "bg-amber-500/10 border-amber-500/30" : "bg-destructive/10 border-destructive/20"}>
          <CardContent className="p-6 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              <span className={isAccessDenied ? "text-amber-700 dark:text-amber-400" : "text-destructive"}>
                {isAccessDenied ? ADMIN_403_MESSAGE : (errorObj instanceof Error ? errorObj.message : "Failed to load permission data.")}
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
    <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/users" }, { label: "Permission matrix" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Grid3X3 className="h-5 w-5" />
            Permission matrix (M-10)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Module × Action × Role. Click a cell to assign or remove the permission for that role.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Module</TableHead>
                    <TableHead>Action</TableHead>
                    {roles.map((r) => (
                      <TableHead key={r.id} className="text-center min-w-[90px]">
                        {r.tier}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {permissions.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium whitespace-nowrap">{moduleDisplay(p.module)}</TableCell>
                      <TableCell>{p.action}</TableCell>
                      {roles.map((r) => {
                        const checked = isChecked(r.id, p.id);
                        const key = cellKey(r.id, p.id);
                        const isUpdating = updatingKey === key;
                        return (
                          <TableCell key={r.id} className="text-center p-2 align-middle">
                            <div className="flex items-center justify-center gap-1 min-h-[2rem]">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={isUpdating || !canUpdate}
                                onChange={() => handleChange(r.id, p.id)}
                                onClick={(e) => e.stopPropagation()}
                                className={cn(
                                  "h-4 w-4 rounded border border-primary cursor-pointer",
                                  "focus:ring-2 focus:ring-ring focus:ring-offset-2",
                                  "disabled:cursor-not-allowed disabled:opacity-50",
                                  "accent-primary"
                                )}
                                aria-label={`${p.module} ${p.action} for ${r.tier}`}
                              />
                              {isUpdating && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />}
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {!loading && permissions.length === 0 && (
            <p className="text-sm text-muted-foreground py-4">No permissions defined. Seed the permissions table (M-10 seed).</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
