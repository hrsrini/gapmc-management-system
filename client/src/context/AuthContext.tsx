import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { AUTH_401_EVENT } from '@/lib/queryClient';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** Employee master (M-01); every app user must have this (server-enforced). */
  employeeId: string;
  employeeEmpId?: string | null;
  roles?: { id: string; tier: string; name: string }[];
  yardIds?: string[];
  /** Resolved from role_permissions via assigned roles; used for permission-based access. */
  permissions?: { module: string; action: string }[];
}

interface LoginResult {
  ok: boolean;
  error?: string;
  /** US-M10-003 */
  mfaRequired?: boolean;
  mfaEnrolled?: boolean;
  mfaMessage?: string;
}

/** Map older API / proxy messages so UI always mentions username + email. */
function normalizeLoginErrorMessage(raw: string): string {
  return raw
    .replace(/\bInvalid email or password\b/gi, 'Invalid email/username or password')
    .replace(/\bInvalid credentials\b/gi, 'Invalid email/username or password');
}

/** Accept camelCase or snake_case from JSON (defensive). */
function employeeIdFromApiUser(u: Record<string, unknown>): string | undefined {
  const a = u.employeeId;
  if (typeof a === 'string' && a.length > 0) return a;
  const b = u.employee_id;
  if (typeof b === 'string' && b.length > 0) return b;
  return undefined;
}

function authUserFromApiPayload(raw: unknown): AuthUser | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const eid = employeeIdFromApiUser(u);
  if (typeof u.id !== 'string' || typeof u.email !== 'string' || !eid) return null;
  return {
    id: u.id,
    email: u.email,
    name: (typeof u.name === 'string' ? u.name : u.email) as string,
    employeeId: eid,
    employeeEmpId:
      typeof u.employeeEmpId === 'string'
        ? u.employeeEmpId
        : typeof u.employee_emp_id === 'string'
          ? u.employee_emp_id
          : null,
    roles: u.roles as AuthUser['roles'],
    yardIds: u.yardIds as AuthUser['yardIds'],
    permissions: u.permissions as AuthUser['permissions'],
  };
}

export type PermissionAction = 'Read' | 'Create' | 'Update' | 'Delete' | 'Approve';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  /** True if user has ADMIN role or has the given module:action in permissions. */
  can: (module: string, action: PermissionAction) => boolean;
  /** `identifier` may be email address or username (case-insensitive). */
  login: (identifier: string, password: string, mfaCode?: string) => Promise<LoginResult>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_STORAGE_KEY = 'gapmc_auth_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          const authUser = authUserFromApiPayload(data?.user);
          if (authUser) {
            setUser(authUser);
            setIsAuthenticated(true);
            localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authUser));
            setIsLoading(false);
            return;
          }
        }
        const stored = localStorage.getItem(AUTH_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as AuthUser;
          if (parsed?.id && parsed?.email && typeof parsed.employeeId === 'string') {
            setUser(parsed);
            setIsAuthenticated(true);
          }
        }
      } catch {
        const stored = localStorage.getItem(AUTH_STORAGE_KEY);
        if (!cancelled && stored) {
          try {
            const parsed = JSON.parse(stored) as AuthUser;
            if (parsed?.id && parsed?.email && typeof parsed.employeeId === 'string') {
              setUser(parsed);
              setIsAuthenticated(true);
            }
          } catch { /* ignore */ }
        }
      }
      if (!cancelled) setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const on401 = () => {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      setUser(null);
      setIsAuthenticated(false);
      setLocation('/');
    };
    window.addEventListener(AUTH_401_EVENT, on401);
    return () => window.removeEventListener(AUTH_401_EVENT, on401);
  }, [setLocation]);

  const login = async (identifier: string, password: string, mfaCode?: string): Promise<LoginResult> => {
    try {
      const trimmed = identifier.trim();
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: trimmed, email: trimmed, password, ...(mfaCode ? { mfaCode } : {}) }),
        credentials: 'include',
      });
      const contentType = res.headers.get('content-type') ?? '';
      const isJson = contentType.includes('application/json');
      const data = isJson ? await res.json().catch(() => ({})) : {};
      if (isJson && data?.mfaRequired) {
        return {
          ok: false,
          mfaRequired: true,
          mfaEnrolled: Boolean(data?.enrolled),
          mfaMessage: typeof data?.message === 'string' ? data.message : undefined,
          error: typeof data?.message === 'string' ? data.message : 'MFA required',
        };
      }
      if (!res.ok) {
        const raw = typeof data?.error === 'string' ? data.error : 'Invalid email/username or password';
        return { ok: false, error: normalizeLoginErrorMessage(raw) };
      }
      let authUser = authUserFromApiPayload(data?.user);
      if (!authUser) {
        const meRes = await fetch('/api/auth/me', { credentials: 'include' });
        const meCt = meRes.headers.get('content-type') ?? '';
        if (meRes.ok && meCt.includes('application/json')) {
          const meData = await meRes.json().catch(() => ({}));
          authUser = authUserFromApiPayload(meData?.user);
        }
      }
      if (!authUser) {
        return {
          ok: false,
          error: isJson
            ? 'Profile after login is incomplete. Usually another old app is still bound to port 5000: stop all Node processes, run only one `npm run dev`, open the URL it prints (often http://localhost:5000), hard-refresh (Ctrl+Shift+R). Verify with `npm run login-smoke`.'
            : 'Login API did not respond with JSON. Start the app with "npm run dev" (not Vite alone) so /api is available.',
        };
      }
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authUser));
      setUser(authUser);
      setIsAuthenticated(true);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network or server error';
      return { ok: false, error: msg };
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch { /* ignore */ }
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setIsAuthenticated(false);
    setUser(null);
    setLocation('/');
  };

  const can = (module: string, action: PermissionAction): boolean => {
    if (!user) return false;
    const isAdmin = user.roles?.some((r) => r.tier === 'ADMIN');
    if (isAdmin) return true;
    return Boolean(user.permissions?.some((p) => p.module === module && p.action === action));
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, user, can, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
