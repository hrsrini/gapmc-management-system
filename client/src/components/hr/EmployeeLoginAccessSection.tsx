import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { KeyRound, Loader2 } from "lucide-react";
import { ADMIN_403_MESSAGE, fetchApiGet } from "@/lib/queryClient";
import { isValidEmailFormat, parseIndianMobile10Digits, sanitizeMobile10Input } from "@shared/india-validation";
import { getPasswordPolicyBrUsr10FirstViolation, passwordPolicyBrUsr10Hint } from "@shared/password-policy-br-usr-10";

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
  employeeId?: string | null;
  isActive: boolean;
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
  isActive?: boolean | null;
}

interface EmployeeLoginAccessSectionProps {
  employeeId: string;
  employeeStatus: string;
  displayName: string;
  workEmail?: string | null;
}

export function EmployeeLoginAccessSection({
  employeeId,
  employeeStatus,
  displayName,
  workEmail,
}: EmployeeLoginAccessSectionProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const canM10Read = can("M-10", "Read");
  const canCreate = can("M-10", "Create");
  const canUpdate = can("M-10", "Update");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set());
  const [selectedYardIds, setSelectedYardIds] = useState<Set<string>>(new Set());

  const profileUrl = `/api/hr/employees/${employeeId}/login-profile`;
  const {
    data: profile,
    isLoading: usersLoading,
    isError: usersError,
    error: usersErr,
  } = useQuery<{ login: User | null }>({
    queryKey: [profileUrl],
    queryFn: () => fetchApiGet<{ login: User | null }>(profileUrl),
    enabled: canM10Read && Boolean(employeeId),
  });

  const linkedUser = profile?.login ?? undefined;
  const isEditMode = Boolean(linkedUser);

  const {
    data: roles = [],
    isLoading: rolesLoading,
    isError: rolesError,
    error: rolesErr,
  } = useQuery<Role[]>({
    queryKey: ["/api/admin/roles"],
    enabled: canM10Read,
  });

  const {
    data: yards = [],
    isLoading: yardsLoading,
    isError: yardsError,
    error: yardsErr,
  } = useQuery<Yard[]>({
    queryKey: ["/api/admin/yards"],
    enabled: canM10Read,
  });

  const activeYards = useMemo(() => yards.filter((y) => y.isActive !== false), [yards]);

  useEffect(() => {
    if (linkedUser) {
      setEmail(linkedUser.email);
      setName(linkedUser.name);
      setUsername(linkedUser.username ?? "");
      setPhone(sanitizeMobile10Input(linkedUser.phone ?? ""));
      setIsActive(linkedUser.isActive);
      setPassword("");
      setConfirmPassword("");
      setSelectedRoleIds(new Set((linkedUser.roles ?? []).map((r) => r.id)));
      setSelectedYardIds(new Set((linkedUser.yards ?? []).map((y) => y.id)));
    } else {
      setEmail(workEmail?.trim() ? workEmail.trim() : "");
      setName(displayName);
      setUsername("");
      setPhone("");
      setIsActive(true);
      setPassword("");
      setConfirmPassword("");
      setSelectedRoleIds(new Set());
      setSelectedYardIds(new Set());
    }
  }, [linkedUser, displayName, workEmail]);

  useEffect(() => {
    if (employeeStatus !== "Active") {
      setIsActive(false);
    }
  }, [employeeStatus]);

  const accessDenied =
    usersError &&
    usersErr instanceof Error &&
    (usersErr.message.includes("403") ||
      usersErr.message.includes("Access denied") ||
      usersErr.message.includes("Insufficient"));

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
      const res = await fetch(`/api/hr/employees/${employeeId}/login`, {
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
      queryClient.invalidateQueries({ queryKey: ["/api/hr/employees"] });
      queryClient.invalidateQueries({ queryKey: [profileUrl] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/employees", employeeId] });
      toast({ title: "Login enabled", description: "They can sign in with email (or username) and the password you set." });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to create login", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (body: {
      email: string;
      name: string;
      username: string | null;
      phone: string | null;
      isActive: boolean;
      roleIds: string[];
      yardIds: string[];
      password?: string;
    }) => {
      const res = await fetch(`/api/hr/employees/${employeeId}/login`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/employees"] });
      queryClient.invalidateQueries({ queryKey: [profileUrl] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/employees", employeeId] });
      toast({ title: "Login settings saved" });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isEditMode && linkedUser) {
      if (password !== "" || confirmPassword !== "") {
        const pwdErr = getPasswordPolicyBrUsr10FirstViolation(password);
        if (pwdErr) {
          toast({ title: "Password does not meet policy", description: pwdErr, variant: "destructive" });
          return;
        }
        if (password !== confirmPassword) {
          toast({ title: "Passwords do not match", variant: "destructive" });
          return;
        }
      }
      if (!isValidEmailFormat(email)) {
        toast({ title: "Invalid email", description: "Please enter a valid email address.", variant: "destructive" });
        return;
      }
      const phoneTrimUpd = phone.trim();
      let phoneNorm: string | null = null;
      if (phoneTrimUpd) {
        const d = parseIndianMobile10Digits(phoneTrimUpd);
        if (!d) {
          toast({ title: "Invalid phone", description: "Use a valid 10-digit Indian mobile number.", variant: "destructive" });
          return;
        }
        phoneNorm = d;
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
        phone: phoneNorm,
        isActive: employeeStatus === "Active" ? isActive : false,
        roleIds: Array.from(selectedRoleIds),
        yardIds: Array.from(selectedYardIds),
      };
      if (!getPasswordPolicyBrUsr10FirstViolation(password)) body.password = password;
      updateMutation.mutate(body);
      return;
    }

    if (employeeStatus !== "Active") {
      toast({
        title: "Employee not active",
        description: "Only Active employees can be given a new login.",
        variant: "destructive",
      });
      return;
    }
    const pwdErrCreate = getPasswordPolicyBrUsr10FirstViolation(password);
    if (pwdErrCreate) {
      toast({ title: "Password does not meet policy", description: pwdErrCreate, variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (!isValidEmailFormat(email)) {
      toast({ title: "Invalid email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    const phoneTrim = phone.trim();
    let phoneOut: string | undefined;
    if (phoneTrim) {
      const d = parseIndianMobile10Digits(phoneTrim);
      if (!d) {
        toast({ title: "Invalid phone", description: "Use a valid 10-digit Indian mobile number.", variant: "destructive" });
        return;
      }
      phoneOut = d;
    }
    createMutation.mutate({
      email: email.trim(),
      name: name.trim(),
      username: username.trim() || undefined,
      phone: phoneOut,
      password,
      roleIds: Array.from(selectedRoleIds),
      yardIds: Array.from(selectedYardIds),
    });
  }

  if (!canM10Read) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            Login &amp; roles
          </CardTitle>
          <CardDescription>
            Assigning app login, roles, and yards for this employee requires <span className="font-medium">M-10</span> administration permission. Ask an administrator if you only have HR (M-01) access.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (usersError && accessDenied) {
    return (
      <Card className="border-amber-500/30 bg-amber-500/10">
        <CardHeader>
          <CardTitle className="text-base">Login &amp; roles</CardTitle>
          <CardDescription className="text-amber-800 dark:text-amber-200">{ADMIN_403_MESSAGE}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" />
          Login &amp; roles
        </CardTitle>
        <CardDescription>
          One login per employee (SRS §1.4). Checkboxes assign <span className="font-medium">roles</span> (DO/DV/DA, etc.); module rights for each role are set under Admin → Permission matrix. Locations limit yard-scoped data. HR status changes can deactivate sign-in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {usersLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : !isEditMode && !canCreate ? (
          <p className="text-sm text-muted-foreground">
            This employee does not have an app login yet. You need <span className="font-medium">M-10 Create</span> permission to enable one.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 max-w-3xl">
            {!isEditMode && employeeStatus !== "Active" && (
              <p className="text-sm text-amber-700 dark:text-amber-400 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                This employee is not Active. Activate the employee record before enabling a new login.
              </p>
            )}

            {isEditMode && (
              <p className="text-sm text-muted-foreground">
                Login is <span className="font-medium text-foreground">enabled</span> for this employee. Update credentials, roles, or locations below.
              </p>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="emp-access-email">Email *</Label>
                <Input
                  id="emp-access-email"
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(ev) => setEmail(ev.target.value)}
                  required
                  disabled={!canUpdate && isEditMode}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emp-access-name">Display name *</Label>
                <Input
                  id="emp-access-name"
                  value={name}
                  onChange={(ev) => setName(ev.target.value)}
                  required
                  disabled={!canUpdate && isEditMode}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emp-access-username">Username (optional)</Label>
                <Input
                  id="emp-access-username"
                  autoComplete="off"
                  placeholder="Sign-in alias"
                  value={username}
                  onChange={(ev) => setUsername(ev.target.value)}
                  disabled={!canUpdate && isEditMode}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emp-access-phone">Mobile number (optional)</Label>
                <Input
                  id="emp-access-phone"
                  value={phone}
                  onChange={(ev) => setPhone(sanitizeMobile10Input(ev.target.value))}
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="10-digit mobile"
                  autoComplete="tel-national"
                  disabled={!canUpdate && isEditMode}
                />
              </div>
            </div>

            {isEditMode && canUpdate && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="emp-access-active">Account active</Label>
                  <p className="text-xs text-muted-foreground">
                    {employeeStatus !== "Active"
                      ? "Employee is not Active in M-01; sign-in stays off until employment is Active again (US-M10-001)."
                      : "Inactive users cannot sign in."}
                  </p>
                </div>
                <Switch
                  id="emp-access-active"
                  checked={employeeStatus === "Active" ? isActive : false}
                  onCheckedChange={setIsActive}
                  disabled={employeeStatus !== "Active"}
                />
              </div>
            )}

            {(canCreate && !isEditMode) || (canUpdate && isEditMode) ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="emp-access-pw">{isEditMode ? "New password (optional)" : "Password *"}</Label>
                  <Input
                    id="emp-access-pw"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(ev) => setPassword(ev.target.value)}
                    required={!isEditMode}
                    minLength={isEditMode ? 0 : 12}
                    placeholder={isEditMode ? "Leave blank to keep" : undefined}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="emp-access-pw2">{isEditMode ? "Confirm new password" : "Confirm *"}</Label>
                  <Input
                    id="emp-access-pw2"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(ev) => setConfirmPassword(ev.target.value)}
                    required={!isEditMode}
                    minLength={isEditMode ? 0 : 12}
                    placeholder={isEditMode ? "—" : undefined}
                  />
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="flex flex-col rounded-md border">
                <div className="rounded-t-md border-b bg-muted/40 px-3 py-2 text-sm font-medium">Roles</div>
                <div className="space-y-2 p-3 max-h-48 overflow-y-auto">
                  {rolesLoading ? (
                    <Skeleton className="h-20 w-full" />
                  ) : rolesError && rolesErr instanceof Error ? (
                    <p className="text-xs text-destructive">{rolesErr.message}</p>
                  ) : roles.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No roles in database. Run M-10 seed.</p>
                  ) : (
                    roles.map((r) => (
                      <label key={r.id} className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox
                          checked={selectedRoleIds.has(r.id)}
                          onCheckedChange={() => toggleRole(r.id)}
                          disabled={(isEditMode && !canUpdate) || (!isEditMode && !canCreate)}
                        />
                        <span>
                          {r.name} <span className="text-muted-foreground">({r.tier})</span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              <div className="flex flex-col rounded-md border">
                <div className="rounded-t-md border-b bg-muted/40 px-3 py-2 text-sm font-medium">Locations (yards)</div>
                <div className="space-y-2 p-3 max-h-48 overflow-y-auto">
                  {yardsLoading ? (
                    <Skeleton className="h-20 w-full" />
                  ) : yardsError && yardsErr instanceof Error ? (
                    <p className="text-xs text-destructive">{yardsErr.message}</p>
                  ) : activeYards.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No yards. Add under Admin → Locations.</p>
                  ) : (
                    activeYards.map((y) => (
                      <label key={y.id} className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox
                          checked={selectedYardIds.has(y.id)}
                          onCheckedChange={() => toggleYard(y.id)}
                          disabled={(isEditMode && !canUpdate) || (!isEditMode && !canCreate)}
                        />
                        <span>{y.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {isEditMode
                ? `Change password only if needed; both fields must match. ${passwordPolicyBrUsr10Hint()}`
                : `${passwordPolicyBrUsr10Hint()} User signs in with email or username plus this password.`}
            </p>

            {((!isEditMode && canCreate) || (isEditMode && canUpdate)) && (
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {isEditMode ? "Saving…" : "Enabling login…"}
                  </>
                ) : isEditMode ? (
                  "Save login settings"
                ) : (
                  "Enable login"
                )}
              </Button>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
