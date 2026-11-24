import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAppHomeHref } from "@/hooks/useAppHomeHref";

const STACK_KEY = "gapmc_in_app_nav_stack";
const MAX_STACK = 40;

function readStack(): string[] {
  try {
    const raw = sessionStorage.getItem(STACK_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function writeStack(stack: string[]): void {
  try {
    sessionStorage.setItem(STACK_KEY, JSON.stringify(stack.slice(-MAX_STACK)));
  } catch {
    /* ignore quota / private mode */
  }
}

function normalizePath(path: string): string {
  const p = String(path || "/")
    .split("?")[0]
    ?.split("#")[0] || "/";
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

function isAuthShellPath(path: string): boolean {
  const p = normalizePath(path);
  return p !== "/" && p !== "/login" && !p.startsWith("/verify");
}

function isHomePath(path: string, homeHref: string): boolean {
  const p = normalizePath(path);
  const home = normalizePath(homeHref);
  return p === home || p === "/dashboard" || p === "/welcome";
}

/**
 * Tracks in-app location history and provides a safe Back action that stays
 * inside the SPA (avoids returning to Login via browser history).
 */
export function useInAppBack() {
  const [location, setLocation] = useLocation();
  const homeHref = useAppHomeHref();
  const skippingPushRef = useRef(false);
  const [canGoBack, setCanGoBack] = useState(() => {
    const stack = readStack();
    return stack.length > 1;
  });

  useEffect(() => {
    const path = normalizePath(location);
    if (skippingPushRef.current) {
      skippingPushRef.current = false;
      const stack = readStack();
      setCanGoBack(stack.length > 1 || (!isHomePath(path, homeHref) && stack.length >= 1));
      return;
    }
    if (!isAuthShellPath(path)) return;

    const stack = readStack().filter(isAuthShellPath);
    // Avoid duplicate pushes (Strict Mode remount / same-route re-render).
    if (stack[stack.length - 1] !== path) {
      while (stack.length > 1 && stack[stack.length - 1] === stack[stack.length - 2]) {
        stack.pop();
      }
      stack.push(path);
      writeStack(stack);
    } else {
      writeStack(stack);
    }
    setCanGoBack(stack.length > 1 || !isHomePath(path, homeHref));
  }, [location, homeHref]);

  const goBack = useCallback(() => {
    const current = normalizePath(location);
    const stack = readStack().filter(isAuthShellPath);

    // Drop the current page; keep the previous entry as the new stack top.
    if (stack[stack.length - 1] === current) stack.pop();
    // Skip any residual non-app or duplicate tops.
    while (stack.length && (stack[stack.length - 1] === current || !isAuthShellPath(stack[stack.length - 1]!))) {
      stack.pop();
    }
    const prev = stack[stack.length - 1];
    writeStack(stack);

    skippingPushRef.current = true;
    if (prev && prev !== current) {
      setLocation(prev);
      setCanGoBack(stack.length > 1 || !isHomePath(prev, homeHref));
      return;
    }

    if (!isHomePath(current, homeHref)) {
      writeStack([normalizePath(homeHref)]);
      setLocation(homeHref);
      setCanGoBack(false);
      return;
    }

    skippingPushRef.current = false;
    setCanGoBack(false);
  }, [homeHref, location, setLocation]);

  return { goBack, canGoBack, location, homeHref };
}
