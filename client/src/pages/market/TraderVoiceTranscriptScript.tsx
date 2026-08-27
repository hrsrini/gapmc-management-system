import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, fetchApiGet } from "@/lib/queryClient";
import { TRADER_VOICE_SCENARIOS_DEFAULT } from "@shared/trader-voice-transcript-default";
import { AlertCircle, BookOpen, Mic, RefreshCw, RotateCcw, Save } from "lucide-react";

type ApiStep =
  | "verify"
  | "session_create"
  | "lines_add"
  | "lines_update"
  | "session_status"
  | "submit"
  | "none";

interface Scenario {
  id: string;
  sortOrder: number;
  title: string;
  description: string;
  apiStep: ApiStep;
  enabled: boolean;
  body: string;
}

interface ScriptResponse {
  key: string;
  version: number;
  scenarios: Scenario[];
  script: string;
  isDefault: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

const API_STEP_LABEL: Record<ApiStep, string> = {
  verify: "Verify trader",
  session_create: "Open session",
  lines_add: "Add purchase line(s)",
  lines_update: "Correct line",
  session_status: "Session status",
  submit: "Submit session",
  none: "—",
};

function errMessage(e: unknown): string {
  if (!(e instanceof Error)) return "Request failed";
  const m = e.message;
  const jsonStart = m.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(m.slice(jsonStart)) as { message?: string; error?: string };
      return parsed.message || parsed.error || m;
    } catch {
      /* fall through */
    }
  }
  return m.replace(/^\d+:\s*/, "");
}

function renderScriptHtml(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const text = para.join(" ").trim();
    if (text) {
      out.push(`<p>${esc(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</p>`);
    }
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith("## ")) {
      flush();
      out.push(`<h3 class="text-base font-semibold mt-4 mb-2">${esc(line.slice(3))}</h3>`);
      continue;
    }
    if (line.startsWith("# ")) {
      flush();
      out.push(`<h2 class="text-lg font-semibold mt-2 mb-2">${esc(line.slice(2))}</h2>`);
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out.join("\n");
}

export default function TraderVoiceTranscriptScript() {
  const { can } = useAuth();
  const canRead = can("M-04", "Read");
  const canUpdate = can("M-04", "Update");
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Scenario | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<ScriptResponse>({
    queryKey: ["/api/ioms/market/voice-transcript-script"],
    enabled: canRead,
    queryFn: () => fetchApiGet("/api/ioms/market/voice-transcript-script"),
  });

  const scenarios = useMemo(() => {
    const fromApi = data?.scenarios;
    const list =
      Array.isArray(fromApi) && fromApi.length > 0
        ? fromApi
        : (TRADER_VOICE_SCENARIOS_DEFAULT.scenarios as Scenario[]);
    return [...list].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [data?.scenarios]);

  useEffect(() => {
    if (!scenarios.length) return;
    if (!selectedId || !scenarios.some((s) => s.id === selectedId)) {
      setSelectedId(scenarios[0].id);
    }
  }, [scenarios, selectedId]);

  const selected = scenarios.find((s) => s.id === selectedId) ?? null;

  useEffect(() => {
    if (!editing && selected) setDraft({ ...selected });
  }, [selected, editing]);

  const saveMutation = useMutation({
    mutationFn: async (scenario: Scenario) => {
      const res = await apiRequest("PUT", "/api/ioms/market/voice-transcript-script", { scenario });
      return (await res.json()) as ScriptResponse;
    },
    onSuccess: async () => {
      toast({ title: "Sample script saved", description: "This flow type is updated for the AI calling app." });
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ["/api/ioms/market/voice-transcript-script"] });
    },
    onError: (e) => toast({ title: "Save failed", description: errMessage(e), variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async (scenario: Scenario) => {
      const res = await apiRequest("PUT", "/api/ioms/market/voice-transcript-script", {
        scenario: { id: scenario.id, enabled: scenario.enabled },
      });
      return (await res.json()) as ScriptResponse;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/api/ioms/market/voice-transcript-script"] });
    },
    onError: (e) => toast({ title: "Update failed", description: errMessage(e), variant: "destructive" }),
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ioms/market/voice-transcript-script/reset", {});
      return (await res.json()) as ScriptResponse;
    },
    onSuccess: async () => {
      toast({ title: "Reset to sample defaults", description: "All flow types restored from the source transcript samples." });
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ["/api/ioms/market/voice-transcript-script"] });
    },
    onError: (e) => toast({ title: "Reset failed", description: errMessage(e), variant: "destructive" }),
  });

  if (!canRead) {
    return (
      <AppShell>
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">M-04 Read permission required.</CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <BookOpen className="h-5 w-5" />
                AI calling sample scripts
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
                Typical sample dialogues from the Trader Transaction Recording transcript. Configure each flow type
                (verify, capture, multi-line, correction, submit, …), enable or disable it, and the AI calling app
                uses the same structure to manage sessions.
              </p>
              {data && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {data.isDefault ? (
                    <Badge variant="secondary">Default samples</Badge>
                  ) : (
                    <Badge>Customized</Badge>
                  )}
                  <span>
                    {scenarios.filter((s) => s.enabled).length}/{scenarios.length} types enabled
                  </span>
                  {data.updatedAt && <span>· Updated {data.updatedAt.slice(0, 16).replace("T", " ")}</span>}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/market/voice-sessions">
                  <Mic className="h-4 w-4 mr-2" />
                  Voice sessions
                </Link>
              </Button>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              {canUpdate && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!confirm("Reset all flow types to the original transcript samples?")) return;
                    resetMutation.mutate();
                  }}
                  disabled={resetMutation.isPending}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset all
                </Button>
              )}
            </div>
          </CardHeader>
        </Card>

        {isError && (
          <div className="flex items-center gap-2 text-sm text-destructive px-1">
            <AlertCircle className="h-4 w-4" />
            {errMessage(error)}
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-80 w-full" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-medium">Flow types</CardTitle>
              </CardHeader>
              <CardContent className="p-2 pt-0 space-y-1 max-h-[70vh] overflow-y-auto">
                {scenarios.map((s) => {
                  const active = s.id === selectedId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        if (editing && draft && draft.id !== s.id) {
                          if (!confirm("Discard unsaved changes for this type?")) return;
                          setEditing(false);
                        }
                        setSelectedId(s.id);
                      }}
                      className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
                        active ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium leading-snug">
                          {s.sortOrder}. {s.title}
                        </span>
                        {!s.enabled && (
                          <Badge variant={active ? "outline" : "secondary"} className="shrink-0 text-[10px]">
                            Off
                          </Badge>
                        )}
                      </div>
                      <p className={`text-xs mt-0.5 line-clamp-2 ${active ? "opacity-90" : "text-muted-foreground"}`}>
                        {API_STEP_LABEL[s.apiStep] || s.apiStep}
                      </p>
                    </button>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-base">
                    {selected ? `${selected.sortOrder}. ${selected.title}` : "Select a type"}
                  </CardTitle>
                  {selected && (
                    <p className="mt-1 text-sm text-muted-foreground">{selected.description}</p>
                  )}
                  {selected && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      API step: <code className="text-xs">{selected.apiStep}</code> ·{" "}
                      {API_STEP_LABEL[selected.apiStep]}
                    </p>
                  )}
                </div>
                {selected && canUpdate && (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={editing ? Boolean(draft?.enabled) : selected.enabled}
                        disabled={editing ? false : toggleMutation.isPending}
                        onCheckedChange={(on) => {
                          if (editing && draft) {
                            setDraft({ ...draft, enabled: on });
                            return;
                          }
                          toggleMutation.mutate({ ...selected, enabled: on });
                        }}
                      />
                      <span className="text-sm">Enabled</span>
                    </div>
                    {!editing ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          setDraft({ ...selected });
                          setEditing(true);
                        }}
                      >
                        Edit sample
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          onClick={() => draft && saveMutation.mutate(draft)}
                          disabled={!draft || saveMutation.isPending}
                        >
                          <Save className="h-4 w-4 mr-2" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setDraft(selected ? { ...selected } : null);
                            setEditing(false);
                          }}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {!selected ? (
                  <p className="text-sm text-muted-foreground">Choose a flow type on the left.</p>
                ) : editing && draft ? (
                  <>
                    <div className="space-y-1">
                      <Label>Title</Label>
                      <Input
                        value={draft.title}
                        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Description</Label>
                      <Input
                        value={draft.description}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Sample dialogue (markdown)</Label>
                      <Textarea
                        value={draft.body}
                        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                        className="min-h-[22rem] font-mono text-sm"
                        spellCheck={false}
                      />
                      <p className="text-xs text-muted-foreground">
                        These are typical samples (names, quantities, places). Edit wording for your yards; the calling
                        app should treat values as examples of the conversation pattern.
                      </p>
                    </div>
                  </>
                ) : (
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none rounded-md border p-4 max-h-[60vh] overflow-y-auto bg-muted/20"
                    dangerouslySetInnerHTML={{ __html: renderScriptHtml(selected.body) }}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
