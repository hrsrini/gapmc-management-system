import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Bug,
  AlertCircle,
  Loader2,
  Paperclip,
  MessageSquare,
} from "lucide-react";
import { BUG_STATUSES } from "@shared/bug-taxonomy";

interface Ticket {
  id: string;
  ticketNo: string;
  title: string;
  description: string;
  bugType: string;
  bugSubtype: string;
  severity: string;
  status: string;
  reporterUserId: string;
  assignedToUserId: string | null;
  resolutionSummary: string | null;
  closedByUserId: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DetailResponse {
  ticket: Ticket;
  reporter: { name: string; email: string };
  assignee: { name: string; email: string } | null;
  attachments: {
    id: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
  }[];
  comments: {
    id: string;
    userId: string;
    body: string;
    createdAt: string;
    authorName: string;
  }[];
  canComment: boolean;
}

interface EmployeeAssignee {
  id: string;
  userId: string | null;
  firstName: string;
  middleName?: string | null;
  surname: string;
  empId?: string | null;
  workEmail?: string | null;
  status: string;
}

export default function BugDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = Boolean(user?.roles?.some((r) => r.tier === "ADMIN"));

  const { data, isLoading, isError } = useQuery<DetailResponse>({
    queryKey: [`/api/bugs/${id}`],
    enabled: Boolean(id),
  });

  const { data: employees = [] } = useQuery<EmployeeAssignee[]>({
    queryKey: ["/api/hr/employees"],
    enabled: isAdmin,
  });

  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<string>("");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [resolution, setResolution] = useState<string>("");

  useEffect(() => {
    if (!data?.ticket) return;
    const tick = data.ticket;
    setStatus(tick.status);
    setAssigneeId(tick.assignedToUserId ?? "__none__");
    setResolution(tick.resolutionSummary ?? "");
  }, [id, data?.ticket?.updatedAt, data?.ticket?.id]);

  const patchMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { status };
      body.assignedToUserId = assigneeId === "__none__" ? null : assigneeId;
      body.resolutionSummary = resolution.trim() || null;
      return apiRequest("PATCH", `/api/bugs/${id}`, body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [`/api/bugs/${id}`] });
      await queryClient.invalidateQueries({ queryKey: ["bugs", "list"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/bugs/dashboard"] });
      toast({ title: "Ticket updated" });
    },
    onError: (e: Error) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  const commentMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/bugs/${id}/comments`, { body: comment.trim() });
    },
    onSuccess: async () => {
      setComment("");
      await queryClient.invalidateQueries({ queryKey: [`/api/bugs/${id}`] });
      toast({ title: "Comment added" });
    },
    onError: (e: Error) => {
      toast({ title: "Comment failed", description: e.message, variant: "destructive" });
    },
  });

  const assigneeOptions = useMemo(() => {
    return employees
      .filter((e) => e.userId && e.status === "Active")
      .map((e) => {
        const name = [e.firstName, e.middleName, e.surname].filter(Boolean).join(" ");
        const tag = e.empId ?? e.id;
        const email = e.workEmail ? ` · ${e.workEmail}` : "";
        return { id: e.userId!, label: `${name} (${tag})${email}` };
      });
  }, [employees]);

  if (isError || !id) {
    return (
      <AppShell breadcrumbs={[{ label: "Bugs", href: "/bugs" }, { label: "Not found" }]}>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-2 py-6 text-destructive">
            <AlertCircle className="h-5 w-5" />
            Could not load this bug.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (isLoading || !data) {
    return (
      <AppShell breadcrumbs={[{ label: "Bugs", href: "/bugs" }, { label: "…" }]}>
        <Skeleton className="h-96 w-full" />
      </AppShell>
    );
  }

  const t = data.ticket;

  return (
    <AppShell
      breadcrumbs={[
        { label: "Bugs", href: "/bugs" },
        { label: t.ticketNo },
      ]}
    >
      <div className="space-y-6 max-w-4xl">
        <Button asChild variant="ghost" size="sm">
          <Link href="/bugs">
            <ArrowLeft className="h-4 w-4 mr-2" />
            All bugs
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-xl">
                <Bug className="h-5 w-5 shrink-0" />
                <span className="font-mono text-base text-muted-foreground">{t.ticketNo}</span>
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{t.status.replace(/_/g, " ")}</Badge>
                <Badge variant="outline">{t.severity}</Badge>
              </div>
            </div>
            <h2 className="text-lg font-semibold pt-2">{t.title}</h2>
            <p className="text-sm text-muted-foreground">
              Reported by {data.reporter.name} · {t.bugType} / {t.bugSubtype} ·{" "}
              {t.createdAt?.slice(0, 16)?.replace("T", " ")}
            </p>
            {data.assignee && (
              <p className="text-sm">Assigned to: {data.assignee.name}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-muted-foreground">Description</Label>
              <p className="mt-1 whitespace-pre-wrap text-sm">{t.description}</p>
            </div>
            {t.resolutionSummary && (
              <div className="rounded-md border bg-muted/40 p-3">
                <Label className="text-muted-foreground">Resolution</Label>
                <p className="mt-1 whitespace-pre-wrap text-sm">{t.resolutionSummary}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {data.attachments.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Paperclip className="h-4 w-4" />
                Attachments
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {data.attachments.map((a) => (
                <a
                  key={a.id}
                  href={`/api/bugs/${t.id}/attachments/${a.id}/download`}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {a.originalFilename}
                </a>
              ))}
            </CardContent>
          </Card>
        )}

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Admin — manage ticket</CardTitle>
              <p className="text-sm text-muted-foreground">
                Update status, assignee, and resolution notes. Assignees are employees with an active app login (HR → Login &amp; roles).
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BUG_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Assign to</Label>
                  <Select value={assigneeId || "__none__"} onValueChange={setAssigneeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Unassigned</SelectItem>
                      {assigneeOptions.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Resolution summary</Label>
                <Textarea
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  rows={4}
                  placeholder="What was done to fix or close this ticket…"
                />
              </div>
              <Button
                onClick={() => patchMutation.mutate()}
                disabled={patchMutation.isPending}
              >
                {patchMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Comments
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {data.comments.length === 0 && (
                <p className="text-sm text-muted-foreground">No comments yet.</p>
              )}
              {data.comments.map((c) => (
                <div key={c.id} className="rounded-md border p-3 text-sm">
                  <div className="flex justify-between gap-2 text-muted-foreground text-xs mb-1">
                    <span className="font-medium text-foreground">{c.authorName}</span>
                    <span>{c.createdAt?.slice(0, 16)?.replace("T", " ")}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </div>
              ))}
            </div>
            {data.canComment ? (
              <div className="space-y-2 pt-2 border-t">
                <Label htmlFor="comment">Add comment</Label>
                <Textarea
                  id="comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  placeholder="Updates or extra context…"
                />
                <Button
                  size="sm"
                  disabled={!comment.trim() || commentMutation.isPending}
                  onClick={() => commentMutation.mutate()}
                >
                  {commentMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Post comment"
                  )}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground pt-2 border-t">
                Only the reporter or an administrator can add comments on this ticket.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
