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

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
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

/** Message shown when admin API returns 403 (user not ADMIN). */
export const ADMIN_403_MESSAGE =
  "Access denied. Log in as administrator (admin@gapmc.local / Apmc@2026) to use Users, Roles, and Permission matrix. Run npm run db:seed-ioms-m10 if the admin user does not exist.";

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = (Array.isArray(queryKey) ? queryKey.join("/") : queryKey) as string;
    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (res.status === 401) {
      notify401();
      if (unauthorizedBehavior === "returnNull") return null;
    }
    if (res.status === 403) {
      notify403();
      const text = await res.text();
      let msg = ADMIN_403_MESSAGE;
      try {
        const d = JSON.parse(text) as { error?: string };
        if (typeof d?.error === "string") msg = d.error;
      } catch {
        // use default msg
      }
      throw new Error(msg);
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

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
