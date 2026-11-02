import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldAlert } from "lucide-react";
import {
  getPasswordPolicyBrUsr10FirstViolation,
  passwordPolicyBrUsr10Hint,
} from "@shared/password-policy-br-usr-10";

type PolicyInfo = {
  isAdmin: boolean;
  minLength: number;
  hint: string;
  forcePasswordChange: boolean;
  canVoluntaryChange: boolean;
};

export default function ChangePassword() {
  const { user, logout, refreshUser } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [policy, setPolicy] = useState<PolicyInfo | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const isAdmin = Boolean(user?.isAdmin ?? user?.roles?.some((r) => r.tier === "ADMIN"));
  const force = Boolean(user?.forcePasswordChange);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/password-policy", { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as PolicyInfo;
        if (!cancelled) setPolicy(data);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Non-admin voluntary: allowed anytime. Admin only when force-change.
    if (user && isAdmin && !force) {
      setLocation("/welcome");
    }
  }, [user, isAdmin, force, setLocation]);

  const clientViolation = useMemo(() => {
    if (!newPassword) return null;
    return getPasswordPolicyBrUsr10FirstViolation(newPassword, {
      isAdmin: policy?.isAdmin ?? isAdmin,
      forbiddenSubstrings: [
        user?.email,
        user?.email?.split("@")[0],
        user?.employeeEmpId,
      ],
    });
  }, [newPassword, policy?.isAdmin, isAdmin, user?.email, user?.employeeEmpId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setFormError("Current password, new password, and confirm password are required.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError("New Password and Confirm Password do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setFormError("New Password must be different from the Current Password.");
      return;
    }
    if (clientViolation) {
      setFormError(clientViolation);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(
          (data as { error?: string }).error ??
            (data as { message?: string }).message ??
            "Failed to change password",
        );
        return;
      }
      toast({
        title: "Password changed",
        description:
          (data as { message?: string }).message ??
          "Please log in again using your new password.",
      });
      await logout();
      setLocation("/");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setSubmitting(false);
      void refreshUser?.();
    }
  }

  const hint = policy?.hint ?? passwordPolicyBrUsr10Hint(isAdmin);

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-lg shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />
            {force ? "Change password required" : "Change password"}
          </CardTitle>
          <CardDescription>
            {force
              ? "For security, you must set a new password before using the application."
              : "Update your account password."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTitle>Keep your password secure</AlertTitle>
            <AlertDescription>
              Please keep your password secure and do not share it with anyone. If you forget your
              password, please contact the System Administrator to have your password reset.
              Self-service password recovery is not available.
            </AlertDescription>
          </Alert>

          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Password policy</p>
            <p>{hint}</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>At least one uppercase letter (A–Z)</li>
              <li>At least one lowercase letter (a–z)</li>
              <li>At least one numeric character (0–9)</li>
              <li>At least one special character (@, #, $, %, &amp;, *, etc.)</li>
              <li>New password must differ from current password</li>
              <li>Must not contain User ID / Employee ID / email</li>
            </ul>
          </div>

          <form className="space-y-3" onSubmit={onSubmit} autoComplete="off">
            <div className="space-y-1">
              <Label htmlFor="cur-pwd">Current / temporary password</Label>
              <Input
                id="cur-pwd"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-pwd">New password</Label>
              <Input
                id="new-pwd"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              {clientViolation ? (
                <p className="text-xs text-destructive">{clientViolation}</p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirm-pwd">Confirm new password</Label>
              <Input
                id="confirm-pwd"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Change password
              </Button>
              {!force ? (
                <Button type="button" variant="outline" onClick={() => setLocation("/welcome")}>
                  Cancel
                </Button>
              ) : (
                <Button type="button" variant="ghost" onClick={() => void logout().then(() => setLocation("/"))}>
                  Sign out
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
