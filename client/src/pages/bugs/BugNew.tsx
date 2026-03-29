import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link } from "wouter";
import { ArrowLeft, Bug, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  BUG_TYPES,
  BUG_SUBTYPES,
  BUG_SEVERITIES,
  type BugType,
} from "@shared/bug-taxonomy";

export default function BugNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [bugType, setBugType] = useState<BugType>("UI");
  const [bugSubtype, setBugSubtype] = useState<string>(BUG_SUBTYPES.UI[0]!);
  const [severity, setSeverity] = useState<string>("medium");
  const [files, setFiles] = useState<FileList | null>(null);

  const subtypes = BUG_SUBTYPES[bugType] ?? BUG_SUBTYPES.Other;

  const mutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("description", description.trim());
      fd.append("bugType", bugType);
      fd.append("bugSubtype", bugSubtype);
      fd.append("severity", severity);
      if (files) {
        for (let i = 0; i < files.length; i++) {
          fd.append("files", files[i]!);
        }
      }
      const res = await fetch("/api/bugs", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = text || res.statusText;
        try {
          const j = JSON.parse(text) as { error?: string; details?: unknown };
          if (j.error) msg = j.error;
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }
      return JSON.parse(text) as { id: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bugs", "list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bugs/dashboard"] });
      toast({ title: "Bug reported", description: "Your ticket was created." });
      setLocation(`/bugs/${data.id}`);
    },
    onError: (e: Error) => {
      toast({
        title: "Could not submit",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  return (
    <AppShell
      breadcrumbs={[
        { label: "Bugs", href: "/bugs" },
        { label: "Report" },
      ]}
    >
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5" />
            Report a bug
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Attach up to 5 files (images, PDF, or plain text). Max 10 MB per file.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button asChild variant="ghost" size="sm" className="w-fit -mt-2">
            <Link href="/bugs">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to list
            </Link>
          </Button>
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short summary of the problem"
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">Description</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Steps to reproduce, expected vs actual behaviour…"
              rows={6}
              className="min-h-[120px]"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={bugType}
                onValueChange={(v) => {
                  const t = v as BugType;
                  setBugType(t);
                  const subs = BUG_SUBTYPES[t] ?? BUG_SUBTYPES.Other;
                  setBugSubtype(subs[0]!);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUG_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Subtype</Label>
              <Select value={bugSubtype} onValueChange={setBugSubtype}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {subtypes.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Severity</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUG_SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="files">Attachments (optional)</Label>
            <Input
              id="files"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,.pdf,.txt"
              onChange={(e) => setFiles(e.target.files)}
            />
          </div>
          <Button
            disabled={mutation.isPending || !title.trim() || !description.trim()}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting…
              </>
            ) : (
              "Submit bug"
            )}
          </Button>
        </CardContent>
      </Card>
    </AppShell>
  );
}
