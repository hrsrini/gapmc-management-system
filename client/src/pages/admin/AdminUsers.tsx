import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Users, AlertCircle, Plus, Loader2, Pencil } from "lucide-react";
import { ADMIN_403_MESSAGE } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";

interface UserRoleRef {
  id: string;
  name: string;
  tier: string;
}

interface UserYardRef {
  id: string;
  name: string;
}

interface User {
  id: string;
  email: string;
  username?: string | null;
  name: string;
  phone?: string | null;
  isActive: boolean;
  createdAt?: string | null;
  roles?: UserRoleRef[];
  yards?: UserYardRef[];
}

interface Role {
  id: string;
  name: string;
  tier: string;
}

interface Yard {
  id: string;
  name: string;
}

export default function AdminUsers() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const canCreate = can("M-10", "Create");
  const canUpdate = can("M-10", "Update");

  const [open, setOpen] = useState(false);
  /** null = create mode; set to user id when editing */
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set());
  const [selectedYardIds, setSelectedYardIds] = useState<Set<string>>(new Set());

  const { data: users, isLoading, isError, error } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
  });

  // Load as soon as this page mounts (same M-10 Read as user list). Waiting until the dialog
  // opens caused empty Roles/Locations until fetch finished, and `enabled: open && (canCreate || canUpdate)`
  // could block fetches in edge cases where `can()` did not match server rules.
  const {
    data: roles = [],
    isLoading: rolesLoading,
    isError: rolesError,
    error: rolesErr,
  } = useQuery<Role[]>({
    queryKey: ["/api/admin/roles"],
  });

  const {
    data: yards = [],
    isLoading: yardsLoading,
    isError: yardsError,
    error: yardsErr,
  } = useQuery<Yard[]>({
    queryKey: ["/api/admin/yards"],
  });


  const isAccessDenied =
    isError &&
    error instanceof Error &&
    (error.message.includes("403") ||
      error.message.includes("Access denied") ||
      error.message.includes("Insufficient"));

  function resetForm() {
    setEmail("");
    setName("");
    setUsername("");
    setPhone("");
    setIsActive(true);
    setPassword("");
    setConfirmPassword("");
    setSelectedRoleIds(new Set());
    setSelectedYardIds(new Set());
  }

  function loadUserIntoForm(u: User) {
    setEmail(u.email);
    setName(u.name);
    setUsername(u.username ?? "");
    setPhone(u.phone ?? "");
    setIsActive(u.isActive);
    setPassword("");
    setConfirmPassword("");
    setSelectedRoleIds(new Set((u.roles ?? []).map((r) => r.id)));
    setSelectedYardIds(new Set((u.yards ?? []).map((y) => y.id)));
  }

  function handleDialogOpenChange(v: boolean) {
    setOpen(v);
    if (!v) {
      resetForm();
      setEditingUserId(null);
    }
  }

  function openCreate() {
    setEditingUserId(null);
    resetForm();
    setOpen(true);
  }

  function openEdit(u: User) {
    loadUserIntoForm(u);
    setEditingUserId(u.id);
    setOpen(true);
  }

  function toggleRole(roleId: string) {
    setSelectedRoleIds((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }

  function toggleYard(yardId: string) {
    setSelectedYardIds((prev) => {
      const next = new Set(prev);
      if (next.has(yardId)) next.delete(yardId);
      else next.add(yardId);
      return next;
    });
  }

  const createMutation = useMutation({
    mutationFn: async (body: {
      email: string;
      name: string;
      username?: string;
      phone?: string;
      password: string;
      roleIds: string[];
      yardIds: string[];
    }) => {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data as User;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User created", description: "They can sign in with email (or username) and the password you set." });
      handleDialogOpenChange(false);
    },
    onError: (e: Error) =>
      toast({ title: "Failed to create user", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (args: {
      id: string;
      body: {
        email: string;
        name: string;
        username: string | null;
        phone: string | null;
        isActive: boolean;
        roleIds: string[];
        yardIds: string[];
        password?: string;
      };
    }) => {
      const res = await fetch(`/api/admin/users/${args.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args.body),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User updated" });
      handleDialogOpenChange(false);
    },
    onError: (e: Error) =>
      toast({ title: "Failed to update user", description: e.message, variant: "destructive" }),
  });

  const isEditMode = editingUserId != null;
  const saving = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isEditMode && editingUserId) {
      if (password !== "" || confirmPassword !== "") {
        if (password.length < 8) {
          toast({ title: "Password too short", description: "Use at least 8 characters or leave both blank.", variant: "destructive" });
          return;
        }
        if (password !== confirmPassword) {
          toast({ title: "Passwords do not match", variant: "destructive" });
          return;
        }
      }
      const body: {
        email: string;
        name: string;
        username: string | null;
        phone: string | null;
        isActive: boolean;
        roleIds: string[];
        yardIds: string[];
        password?: string;
      } = {
        email: email.trim(),
        name: name.trim(),
        username: username.trim() === "" ? null : username.trim().toLowerCase(),
        phone: phone.trim() === "" ? null : phone.trim(),
        isActive,
        roleIds: [...selectedRoleIds],
        yardIds: [...selectedYardIds],
      };
      if (password.length >= 8) body.password = password;
      updateMutation.mutate({ id: editingUserId, body });
      return;
    }

    if (password.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      email: email.trim(),
      name: name.trim(),
      username: username.trim() || undefined,
      phone: phone.trim() || undefined,
      password,
      roleIds: [...selectedRoleIds],
      yardIds: [...selectedYardIds],
    });
  }

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/users" }, { label: "Users" }]}>
        <Card className={isAccessDenied ? "bg-amber-500/10 border-amber-500/30" : "bg-destructive/10 border-destructive/20"}>
          <CardContent className="p-6 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              <span className={isAccessDenied ? "text-amber-700 dark:text-amber-400" : "text-destructive"}>
                {isAccessDenied
                  ? ADMIN_403_MESSAGE
                  : error instanceof Error
                    ? error.message
                    : "Failed to load users."}
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
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Users
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              IOMS M-10: Roles and yards per user. Add or edit to change assignments.
            </p>
          </div>
          {canCreate && (
            <Button type="button" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Add user
            </Button>
          )}
        </CardHeader>

        <Dialog open={open} onOpenChange={handleDialogOpenChange}>
          {/*
            Single scroll on DialogContent avoids broken flex-1 + footer overlap inside Radix Dialog.
            No nested scrollbars on Roles/Locations — one vertical scroll for the whole form.
          */}
          <DialogContent className="flex max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-y-auto overflow-x-hidden p-0 sm:w-full">
            <div className="sticky top-0 z-10 border-b bg-background px-6 pb-3 pt-6 pr-14">
              <DialogHeader className="space-y-0 text-left">
                <DialogTitle>{isEditMode ? "Edit user" : "Create user"}</DialogTitle>
              </DialogHeader>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col">
              <div className="flex flex-col gap-4 px-6 py-4">
                <div className="space-y-2">
                  <Label htmlFor="user-email">Email *</Label>
                  <Input
                    id="user-email"
                    type="email"
                    autoComplete="off"
                    value={email}
                    onChange={(ev) => setEmail(ev.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="user-name">Display name *</Label>
                  <Input id="user-name" value={name} onChange={(ev) => setName(ev.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="user-username">Username (optional)</Label>
                  <Input
                    id="user-username"
                    autoComplete="off"
                    placeholder="Sign-in alias"
                    value={username}
                    onChange={(ev) => setUsername(ev.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="user-phone">Phone (optional)</Label>
                  <Input id="user-phone" value={phone} onChange={(ev) => setPhone(ev.target.value)} />
                </div>

                {isEditMode && (
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="user-active">Account active</Label>
                      <p className="text-xs text-muted-foreground">Inactive users cannot sign in.</p>
                    </div>
                    <Switch id="user-active" checked={isActive} onCheckedChange={setIsActive} />
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="user-password">{isEditMode ? "New password (optional)" : "Password *"}</Label>
                    <Input
                      id="user-password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(ev) => setPassword(ev.target.value)}
                      required={!isEditMode}
                      minLength={isEditMode ? 0 : 8}
                      placeholder={isEditMode ? "Leave blank to keep" : undefined}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="user-password2">{isEditMode ? "Confirm new password" : "Confirm *"}</Label>
                    <Input
                      id="user-password2"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(ev) => setConfirmPassword(ev.target.value)}
                      required={!isEditMode}
                      minLength={isEditMode ? 0 : 8}
                      placeholder={isEditMode ? "—" : undefined}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {isEditMode
                    ? "Change password only if needed; both fields must match and be at least 8 characters."
                    : "Minimum 8 characters. User signs in with email or username plus this password."}
                </p>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col rounded-md border">
                    <div className="rounded-t-md border-b bg-muted/40 px-3 py-2 text-sm font-medium">Roles</div>
                    <div className="space-y-2 p-3">
                      {rolesLoading ? (
                        <div className="space-y-2">
                          <Skeleton className="h-8 w-full" />
                          <Skeleton className="h-8 w-full" />
                          <Skeleton className="h-8 max-w-[85%]" />
                        </div>
                      ) : rolesError && rolesErr instanceof Error ? (
                        <p className="text-xs text-destructive">{rolesErr.message}</p>
                      ) : roles.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No roles in database. Run M-10 seed.</p>
                      ) : (
                        roles.map((r) => (
                          <label key={r.id} className="flex cursor-pointer items-center gap-2 text-sm">
                            <Checkbox checked={selectedRoleIds.has(r.id)} onCheckedChange={() => toggleRole(r.id)} />
                            <span>
                              {r.name} <span className="text-muted-foreground">({r.tier})</span>
                            </span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col rounded-md border">
                    <div className="rounded-t-md border-b bg-muted/40 px-3 py-2 text-sm font-medium">
                      Locations (yards)
                    </div>
                    <div className="space-y-2 p-3">
                      {yardsLoading ? (
                        <div className="space-y-2">
                          <Skeleton className="h-8 w-full" />
                          <Skeleton className="h-8 w-full" />
                          <Skeleton className="h-8 max-w-[85%]" />
                        </div>
                      ) : yardsError && yardsErr instanceof Error ? (
                        <p className="text-xs text-destructive">{yardsErr.message}</p>
                      ) : yards.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No yards. Add under Admin → Locations.</p>
                      ) : (
                        yards.map((y) => (
                          <label key={y.id} className="flex cursor-pointer items-center gap-2 text-sm">
                            <Checkbox checked={selectedYardIds.has(y.id)} onCheckedChange={() => toggleYard(y.id)} />
                            <span>{y.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-muted-foreground">
                  Roles control module permissions; yards limit which markets&apos; data the user sees.
                </p>
              </div>

              <div className="border-t bg-background px-6 py-4">
                <DialogFooter className="gap-2 sm:justify-end sm:gap-0">
                  <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {isEditMode ? "Saving…" : "Creating…"}
                      </>
                    ) : isEditMode ? (
                      "Save changes"
                    ) : (
                      "Create user"
                    )}
                  </Button>
                </DialogFooter>
              </div>
            </form>
          </DialogContent>
        </Dialog>

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
                  <TableHead className="min-w-[200px]">Roles</TableHead>
                  <TableHead className="min-w-[160px]">Locations</TableHead>
                  <TableHead>Status</TableHead>
                  {canUpdate && <TableHead className="w-[100px] text-right">Actions</TableHead>}
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
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {(u.roles?.length ?? 0) > 0 ? (
                          u.roles!.map((r) => (
                            <Badge key={r.id} variant="outline" className="font-normal text-xs">
                              {r.name}
                              <span className="text-muted-foreground ml-1">({r.tier})</span>
                            </Badge>
                          ))
                        ) : (
                          <span className="text-sm text-muted-foreground">No roles</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {(u.yards?.length ?? 0) > 0 ? (
                          u.yards!.map((y) => (
                            <Badge key={y.id} variant="secondary" className="font-normal text-xs">
                              {y.name}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-sm text-muted-foreground">None</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.isActive ? "default" : "secondary"}>{u.isActive ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    {canUpdate && (
                      <TableCell className="text-right">
                        <Button type="button" variant="outline" size="sm" onClick={() => openEdit(u)}>
                          <Pencil className="h-3.5 w-3.5 mr-1" />
                          Edit
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!users || users.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No users. Run the M-10 seed script or use Add user.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
