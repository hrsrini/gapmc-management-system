import { QueryClient, QueryFunction } from "@tanstack/react-query";

export const AUTH_401_EVENT = "gapmc:auth-401";
export const AUTH_403_EVENT = "gapmc:auth-403";

function notify401(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AUTH_401_EVENT));
  }
}

function notify403(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AUTH_403_EVENT));
  }
}

/** Parse `{ error?: string }` from JSON API errors (e.g. `sendApiError`); fall back to body text. */
export async function readApiErrorMessage(res: Response): Promise<string> {
  const text = (await res.text()) || res.statusText;
  const trimmed = text.trim();
  if (!trimmed) return res.statusText;
  try {
    const j = JSON.parse(trimmed) as { error?: unknown };
    if (typeof j.error === "string" && j.error.length > 0) return j.error;
  } catch {
    /* not JSON */
  }
  return trimmed;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const msg = await readApiErrorMessage(res);
    throw new Error(`${res.status}: ${msg}`);
  }
}

/** Message shown when admin API returns 403 (user not ADMIN). */
export const ADMIN_403_MESSAGE =
  "Access denied. Log in as administrator (admin@gapmc.local / GapmcAdmin@2026!) for Roles, Locations, Permission matrix, and other admin tools. App accounts are managed under HR → Employees (Login & roles). Run npm run db:seed-ioms-m10 if the admin user does not exist.";

/** GET /api/... with the same 401/403 handling as the default queryFn (for custom query keys). */
export async function fetchApiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (res.status === 401) {
    notify401();
    const msg = await readApiErrorMessage(res);
    throw new Error(`${res.status}: ${msg}`);
  }
  if (res.status === 403) {
    notify403();
    const text = await res.text();
    let msg = ADMIN_403_MESSAGE;
    try {
      const d = JSON.parse(text) as { error?: string };
      if (typeof d?.error === "string") msg = d.error;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }

  await throwIfResNotOk(res);
  return res.json() as Promise<T>;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  if (res.status === 401) notify401();
  else if (res.status === 403) notify403();
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";

export function getQueryFn<T>(options: {
  on401: UnauthorizedBehavior;
}): QueryFunction<T> {
  const { on401: unauthorizedBehavior } = options;
  return async ({ queryKey }) => {
    const url = (Array.isArray(queryKey) ? queryKey.join("/") : queryKey) as string;
    try {
      return await fetchApiGet<T>(url);
    } catch (e) {
      if (unauthorizedBehavior === "returnNull" && e instanceof Error && e.message.startsWith("401:")) {
        return null as T;
      }
      throw e;
    }
  };
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
