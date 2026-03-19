import { useEffect } from "react";
import { useLocation } from "wouter";
import { toast } from "@/hooks/use-toast";
import { AUTH_403_EVENT } from "@/lib/queryClient";

export function Auth403Listener() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    const on403 = () => {
      toast({
        title: "Access denied",
        description: "You don't have permission for this action.",
        variant: "destructive",
      });
      setLocation("/access-denied");
    };
    window.addEventListener(AUTH_403_EVENT, on403);
    return () => window.removeEventListener(AUTH_403_EVENT, on403);
  }, [setLocation]);
  return null;
}
