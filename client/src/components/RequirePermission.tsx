import type { ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import type { PermissionAction } from "@/context/AuthContext";
import AccessDenied from "@/pages/AccessDenied";

interface RequirePermissionProps {
  module: string;
  action: PermissionAction;
  children: ReactNode;
}

/**
 * Renders children only if the current user has the given module:action permission
 * (or ADMIN role). Otherwise renders the Access denied page.
 */
export function RequirePermission({ module, action, children }: RequirePermissionProps) {
  const { can } = useAuth();
  if (can(module, action)) return <>{children}</>;
  return <AccessDenied />;
}
