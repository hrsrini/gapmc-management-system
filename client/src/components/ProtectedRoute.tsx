import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/context/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Allow access even when forcePasswordChange is set (change-password page). */
  allowForcePasswordChange?: boolean;
}

export function ProtectedRoute({ children, allowForcePasswordChange = false }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [location, setLocation] = useLocation();

  const mustChangePassword =
    Boolean(user?.forcePasswordChange) &&
    !user?.isAdmin &&
    !(user?.roles ?? []).some((r) => r.tier === 'ADMIN');

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation('/');
      return;
    }
    if (
      !isLoading &&
      isAuthenticated &&
      mustChangePassword &&
      !allowForcePasswordChange &&
      location !== '/change-password'
    ) {
      setLocation('/change-password');
    }
  }, [isAuthenticated, isLoading, setLocation, mustChangePassword, allowForcePasswordChange, location]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  if (mustChangePassword && !allowForcePasswordChange) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Redirecting to change password...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
