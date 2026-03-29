import { Link, useLocation } from "wouter";
import { Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Floating entry to report a bug from any screen that uses AppShell. */
export function BugReportFab() {
  const [location] = useLocation();
  if (location.startsWith("/bugs/new")) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          asChild
          size="lg"
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg"
          aria-label="Report a bug"
        >
          <Link href="/bugs/new">
            <Bug className="h-6 w-6" />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">Report a bug</TooltipContent>
    </Tooltip>
  );
}
