import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Send, ArrowLeft, Paperclip, Download, Trash2, AlertCircle, Eye, Loader2 } from "lucide-react";
import { formatYmdToDisplay } from "@/lib/dateFormat";
import { FormFileAttachments } from "@/components/forms/FormFileAttachments";
import { AuthenticatedBlobPreviewDialog } from "@/components/attachment/AuthenticatedBlobPreviewDialog";
import { filesToFileList } from "@/lib/filesToFileList";

interface Outward {
  id: string;
  yardId?: string | null;
  despatchNo?: string | null;
  despatchDate: string;
  toParty: string;
  toAddress?: string | null;
  subject: string;
  modeOfDespatch: string;
  inwardRefId?: string | null;
  fileRef?: string | null;
  despatchedBy?: string | null;
  attachments?: string[] | null;
}

interface YardRef {
  id: string;
  name: string;
}

export default function DakOutwardDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { can } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canUpdate = can("M-09", "Update");
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [attachmentPreviewOpen, setAttachmentPreviewOpen] = useState(false);
  const [attachmentPreviewPath, setAttachmentPreviewPath] = useState<string | null>(null);
  const [attachmentPreviewTitle, setAttachmentPreviewTitle] = useState("");

  const { data: outward, isLoading, isError } = useQuery<Outward>({
    queryKey: ["/api/ioms/dak/outward", id],
    enabled: !!id,
  });
  const { data: yards = [] } = useQuery<YardRef[]>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  const attachmentMutation = useMutation({
    mutationFn: async (files: FileList | null) => {
      if (!id || !files?.length) throw new Error("Choose at least one file.");
      const fd = new FormData();
      for (let i = 0; i < files.length; i++) fd.append("files", files[i]);
      const res = await fetch(`/api/ioms/dak/outward/${id}/attachments`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/dak/outward", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/dak/outward"] });
      toast({ title: "Attachments uploaded" });
      setPendingAttachments([]);
    },
    onError: (e: Error) => {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    },
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: async (fileName: string) => {
      const res = await fetch(`/api/ioms/dak/outward/${id}/files/${encodeURIComponent(fileName)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/dak/outward", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/dak/outward"] });
      toast({ title: "Attachment removed" });
    },
    onError: (e: Error) => {
      toast({ title: "Remove failed", description: e.message, variant: "destructive" });
    },
  });

  if (!id) return null;

  if (isLoading) {
    return (
      <AppShell breadcrumbs={[{ label: "Dak Outward", href: "/correspondence/outward" }, { label: "Detail" }]}>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-8 w-48 mb-4" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (isError || !outward) {
    return (
      <AppShell breadcrumbs={[{ label: "Dak Outward", href: "/correspondence/outward" }, { label: "Detail" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Outward not found.</span>
            <Button variant="outline" size="sm" onClick={() => setLocation("/correspondence/outward")}>
              Back to list
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Dak Outward", href: "/correspondence/outward" }, { label: outward.despatchNo ?? outward.id }]}>
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              {outward.despatchNo ?? outward.id}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setLocation("/correspondence/outward")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Despatch date</span>
              <br />
              {formatYmdToDisplay(outward.despatchDate)}
            </div>
            <div>
              <span className="text-muted-foreground">To</span>
              <br />
              {outward.toParty}
            </div>
            <div>
              <span className="text-muted-foreground">Mode</span>
              <br />
              {outward.modeOfDespatch}
            </div>
            <div>
              <span className="text-muted-foreground">Yard</span>
              <br />
              {outward.yardId ? (yardById[outward.yardId] ?? outward.yardId) : "—"}
            </div>
            {outward.toAddress && (
              <div className="md:col-span-2">
                <span className="text-muted-foreground">To address</span>
                <br />
                {outward.toAddress}
              </div>
            )}
            <div className="md:col-span-2">
              <span className="text-muted-foreground">Subject</span>
              <br />
              {outward.subject}
            </div>
            {outward.inwardRefId && (
              <div>
                <span className="text-muted-foreground">Inward ref</span>
                <br />
                {outward.inwardRefId}
              </div>
            )}
            {outward.despatchedBy && (
              <div>
                <span className="text-muted-foreground">Despatched by</span>
                <br />
                {outward.despatchedBy}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Paperclip className="h-4 w-4" />
              Attachments
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              PDF or images up to 8 MB each; max 20 files. Upload and remove require M-09 Update.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {canUpdate && (
              <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
                <FormFileAttachments
                  label="Files to upload"
                  description="Add files, review thumbnails, then upload to the server."
                  files={pendingAttachments}
                  onChange={setPendingAttachments}
                  accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  maxFiles={20}
                  maxBytesPerFile={8 * 1024 * 1024}
                  disabled={attachmentMutation.isPending}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={attachmentMutation.isPending || pendingAttachments.length === 0}
                    onClick={() => attachmentMutation.mutate(filesToFileList(pendingAttachments))}
                  >
                    {attachmentMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                    Upload selected
                  </Button>
                  {pendingAttachments.length > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={attachmentMutation.isPending}
                      onClick={() => setPendingAttachments([])}
                    >
                      Clear selection
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
            {(outward.attachments?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No attachments.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {(outward.attachments ?? []).map((name) => (
                  <li key={name} className="flex flex-wrap items-center gap-2 border rounded-md px-3 py-2">
                    <span className="font-mono text-xs break-all flex-1 min-w-0">{name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      title="Preview"
                      onClick={() => {
                        setAttachmentPreviewTitle(name);
                        setAttachmentPreviewPath(
                          `/api/ioms/dak/outward/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`,
                        );
                        setAttachmentPreviewOpen(true);
                      }}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                      <a
                        href={`/api/ioms/dak/outward/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                    {canUpdate && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={deleteAttachmentMutation.isPending}
                        onClick={() => deleteAttachmentMutation.mutate(name)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <AuthenticatedBlobPreviewDialog
        open={attachmentPreviewOpen}
        onOpenChange={setAttachmentPreviewOpen}
        title={attachmentPreviewTitle}
        fetchPath={attachmentPreviewPath}
      />
    </AppShell>
  );
}
