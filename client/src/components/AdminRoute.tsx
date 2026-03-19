import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/context/AuthContext';

/** Allow access to Admin section if user has ADMIN role or any M-10 permission (API still enforces per-action permissions). */
function hasAdminAccess(
  roles: { tier: string }[] | undefined,
  permissions: { module: string; action: string }[] | undefined
): boolean {
  if (roles?.some((r) => r.tier === 'ADMIN')) return true;
  return Boolean(permissions?.some((p) => p.module === 'M-10'));
}

interface AdminRouteProps {
  children: React.ReactNode;
}

export function AdminRoute({ children }: AdminRouteProps) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const isAdmin = hasAdminAccess(user?.roles, user?.permissions);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      setLocation('/');
      return;
    }
    if (!isAdmin) {
      setLocation('/dashboard');
    }
  }, [isAuthenticated, isLoading, isAdmin, setLocation]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Redirecting...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
