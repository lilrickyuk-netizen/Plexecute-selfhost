import { CrisisBanner } from "@/components/SafetyPanel";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { appendTranscript } from "@/lib/voice-input";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, Camera, MapPin, ChevronDown, Plus, Trash2, Check } from "lucide-react";
import { estimateMealPhoto } from "@/lib/meal-photo.functions";
import { downscaleImage } from "@/components/MealPhotoEstimate";
import { supabase } from "@/integrations/supabase/client";
import { useSafety } from "@/components/SafetyPanel";
import { clearCoachChat, getCoachUsage, sendCoachMessage } from "@/lib/coach.functions";
import {
  PLATFORM_REQUEST_LIMIT_MS,
  PROGRESS_SILENCE_MS,
  type CoachProgressEvent,
} from "@/lib/coach-turn-budget";

type TurnResult = { ok: boolean; error: string | null; reply: string | null; fallback?: string };
const UNAVAILABLE = "AI assistance is temporarily unavailable. Your plan still works.";

/** After a dropped connection, the turn keeps running on the server; wait for its saved reply. */
async function waitForSavedReply(sinceIso: string, maxMs = 240_000): Promise<boolean> {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000));
    const { data } = await supabase
      .from("coach_messages")
      .select("id")
      .eq("role", "assistant")
      .gt("created_at", sinceIso)
      .limit(1);
    if (data?.length) return true;
  }
  return false;
}
import { approveWeekPlan, proposeWeekPlan } from "@/lib/planning.functions";
import { decideCoachAction } from "@/lib/coach-actions.functions";
import { toast } from "sonner";
import { Link, useNavigate } from "@tanstack/react-router";
import { COACH_MODES, type CoachAction, type CoachMode } from "@/lib/coach-tools";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Tool, ToolContent } from "@/components/ai-elements/tool";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/_authenticated/app/coach")({
  head: () => ({
    meta: [
      { title: "Coach | Plexecute" },
      {
        name: "description",
        content: "Your Plexecute coach, using your real plan, goals and engines.",
      },
      { property: "og:title", content: "Coach | Plexecute" },
      {
        property: "og:description",
        content: "Your Plexecute coach, using your real plan, goals and engines.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { session?: string } =>
    typeof s["session"] === "string" && /^[0-9a-f-]{36}$/i.test(s["session"])
      ? { session: s["session"] }
      : {},
  component: Coach,
});

function Coach() {
  const qc = useQueryClient();
  const send = useServerFn(sendCoachMessage);
  const usageFn = useServerFn(getCoachUsage);
  const clearFn = useServerFn(clearCoachChat);
  const { data: msgs = [] } = useQuery({
    queryKey: ["coach"],
    refetchInterval: 3000,
    queryFn: async () => {
      const { data } = await supabase
        .from("coach_messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      return (data ?? []).reverse();
    },
  });
  const { data: safety } = useSafety();
  const { data: usage } = useQuery({ queryKey: ["coach-usage"], queryFn: () => usageFn() });
  const { session: sessionId } = Route.useSearch();
  const { data: sessionTitle } = useQuery({
    queryKey: ["block-title", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      if (!sessionId) return null;
      return (
        (await supabase.from("plan_blocks").select("title").eq("id", sessionId).maybeSingle()).data
          ?.title ?? null
      );
    },
  });
  const [text, setText] = useState("");
  const [mode, setMode] = useState<CoachMode>("COACH");
  const [pending, setPending] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const estimatePhoto = useServerFn(estimateMealPhoto);
  const [photo, setPhoto] = useState<{ id: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  // Phone GPS is only read when the member taps the pin, and only sent with their next message.
  const [loc, setLoc] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  function shareLocation() {
    if (loc) return setLoc(null);
    if (!("geolocation" in navigator))
      return void toast.error("This device can't share its location.");
    setLocBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: Math.round(p.coords.accuracy),
        });
        setLocBusy(false);
        toast.success("Your location will be sent with your next message.");
      },
      (e) => {
        setLocBusy(false);
        toast.error(
          e.code === 1
            ? "Location permission was turned down. Allow it in your phone or browser settings."
            : "Couldn't find your location. Try again outside or with GPS on.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }
  const photoRef = useRef<HTMLInputElement>(null);
  async function attachPhoto(f: File | undefined) {
    if (!f) return;
    setPhotoBusy(true);
    try {
      const v = await estimatePhoto({ data: { image: await downscaleImage(f) } });
      setPhoto({ id: v.id });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPhotoBusy(false);
      if (photoRef.current) photoRef.current.value = "";
    }
  }
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [greeting, setGreeting] = useState("Hello");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");
  }, []);
  // Only return focus to the box after a message the member sent has finished,
  // never on first opening the page (they may want to pick a suggestion first).
  const wasPending = useRef(false);
  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    if (document.activeElement === document.body || document.activeElement === inputRef.current) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [pending]);

  async function clearChat() {
    setClearBusy(true);
    try {
      const r = await clearFn();
      if (r.ok) {
        setConfirmClear(false);
        toast.success("Coach chat cleared. You can start fresh.");
        qc.invalidateQueries({ queryKey: ["coach"] });
      } else toast.error(r.error || "Couldn't clear the chat. Try again.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setClearBusy(false);
    }
  }
  const exhausted = usage?.ended ?? false;

  async function submit() {
    const m = text.trim() || (photo?.id ? "How many calories are in this?" : "");
    if (!m || exhausted || pending || photoBusy) return;
    const mealEstimateId = photo?.id ?? null;
    const location = loc;
    setLoc(null);
    setPhoto(null);
    setText("");
    setPending(m);
    setStage(null);
    setErr(null);
    const sentAt = new Date(Date.now() - 2000).toISOString();
    try {
      let r: TurnResult | null = null;
      let failed = false;
      try {
        const stream = (await send({
          data: {
            message: m,
            mode,
            mealEstimateId,
            stream: true,
            ...(location ? { location } : {}),
            ...(sessionId && sessionTitle ? { sessionId } : {}),
          },
        })) as unknown as ReadableStream<CoachProgressEvent<TurnResult>>;
        const reader = stream.getReader();
        for (;;) {
          // Progress arrives every few seconds; a long silence means the connection was cut.
          let silence: ReturnType<typeof setTimeout> | undefined;
          const next = await Promise.race([
            reader.read(),
            new Promise<null>(
              (res) => (silence = setTimeout(() => res(null), PROGRESS_SILENCE_MS)),
            ),
          ]).finally(() => clearTimeout(silence));
          if (!next) {
            reader.cancel().catch(() => undefined);
            break;
          }
          const { done, value } = next;
          if (done) break;
          if (value.type === "progress") setStage(value.stage);
          else if (value.type === "result") r = value.result;
          else failed = true;
        }
      } catch (e) {
        // The connection dropped (phone signal, app in background); the reply is still being prepared.
        console.error("coach stream interrupted", e);
      }
      if (!r && !failed) {
        setStage("Still working on it. Your reply will appear here.");
        // The server always saves its reply before the request limit, so wait only that long.
        if (
          await waitForSavedReply(
            sentAt,
            Math.max(15_000, Date.parse(sentAt) + PLATFORM_REQUEST_LIMIT_MS + 15_000 - Date.now()),
          )
        )
          return;
        failed = true;
      }
      if (!r) {
        setErr(UNAVAILABLE);
        return;
      }
      if (!r.ok)
        setErr(
          r.fallback
            ? r.fallback
            : r.error === "restricted"
              ? "You paused use of your data, so the coach is off. Turn it back on in Settings, Privacy."
              : r.error === "limit"
                ? "You've used today's coach turns."
                : r.error === "paused"
                  ? "The coach is paused for a short while. Your plan and sessions still work as normal."
                  : r.error === "busy" || r.error === "rate_limited"
                    ? "The coach is busy. Try again in a minute."
                    : UNAVAILABLE,
        );
    } catch (e) {
      console.error("coach send failed", e);
      setErr(UNAVAILABLE);
    } finally {
      setPending(null);
      setStage(null);
      qc.invalidateQueries({ queryKey: ["coach"] });
      qc.invalidateQueries({ queryKey: ["coach-usage"] });
      qc.invalidateQueries({ queryKey: ["safety"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["commitments"] });
      qc.invalidateQueries({ queryKey: ["scheduled-calls"] });
    }
  }

  return (
    <div className="member-coach flex flex-col">
      <div className="member-coach-modebar">
        <DropdownMenu>
          <DropdownMenuTrigger className="member-coach-sub member-coach-mode-trigger">
            {COACH_MODES.find((x) => x.key === mode)?.label ?? "Coach"}{" "}
            <ChevronDown className="inline h-3.5 w-3.5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="member-coach-mode-menu">
            {COACH_MODES.map((md) => (
              <DropdownMenuItem
                key={md.key}
                onSelect={() => setMode(md.key)}
                data-active={md.key === mode ? "" : undefined}
                className="member-coach-mode-item"
              >
                <span className="min-w-0 flex-1 truncate">{md.label}</span>
                {md.key === mode ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {usage?.tier === "free" && usage.ended && !safety?.policy.blockUpsell && (
        <div
          className="mt-3 flex items-center justify-between gap-3 rounded-[12px] border border-border p-3 text-xs text-muted-foreground"
          role="status"
        >
          <span>
            You've used today's free coach turns. They reset at midnight, and your plan keeps
            working. Pro includes far more coaching.
          </span>
          <Link
            to="/app/billing"
            search={{ status: undefined }}
            className="shrink-0 text-foreground underline"
          >
            See plans
          </Link>
        </div>
      )}
      <div className="mt-3">
        <CrisisBanner />
      </div>
      <Conversation className="member-coach-conversation" aria-label="Conversation with Coach">
        <ConversationContent className="member-coach-transcript">
          {msgs.length === 0 && !pending && (
            <Message from="assistant" className="member-coach-message">
              <MessageContent className="member-coach-assistant">
                <p className="font-semibold">{greeting}! I'm your Coach.</p>
                <p className="text-muted-foreground">
                  I help you think, plan, execute and make progress. What would you like to work on
                  today?
                </p>
              </MessageContent>
            </Message>
          )}
          {msgs.map((m) => (
            <Bubble
              key={m.id}
              role={m.role}
              content={
                m.role === "user" && m.content
                  ? m.content.replace(
                      /\n\n\[Member is asking from inside the session [\s\S]*?\]$/,
                      "",
                    )
                  : m.content
              }
              createdAt={m.created_at}
              actions={(m.actions ?? []) as CoachAction[]}
              tools={(m.tool_trace ?? []) as { tool: string }[]}
            />
          ))}
          {pending && (
            <>
              <Bubble role="user" content={pending} />
              <Shimmer className="text-sm text-muted-foreground" aria-live="polite">
                {stage ? `${stage}…` : "Coach is thinking…"}
              </Shimmer>
            </>
          )}
          {err && (
            <p className="rounded-[14px] border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              {err}
            </p>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {exhausted ? (
        <div className="mt-4 rounded-[14px] border border-border bg-card p-4 text-sm">
          <p>You've used today's free coach turns. They reset tomorrow.</p>
          <p className="mt-1 text-muted-foreground">
            Pro and Execute include 200 coach turns a day.{" "}
            <Link
              to="/app/billing"
              search={{ status: undefined }}
              className="text-primary underline"
            >
              Compare plans
            </Link>
          </p>
        </div>
      ) : (
        <PromptInput
          onSubmit={() => submit()}
          className="member-coach-composer"
          accept="image/jpeg,image/png,image/webp"
          onError={({ message }) => toast.error(message)}
        >
          {sessionId && sessionTitle && (
            <p
              className="w-full basis-full px-2 pt-1 text-xs text-muted-foreground"
              data-testid="coach-session-context"
            >
              Asking about your session: <span className="text-foreground">{sessionTitle}</span>
            </p>
          )}
          <PromptInputTextarea
            ref={inputRef}
            aria-label="Message your coach"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={1}
            maxLength={2000}
            placeholder="Tell Coach what you need…"
            className="member-coach-textarea"
            onPaste={(event) => {
              const file = Array.from(event.clipboardData.files).find((f) =>
                f.type.startsWith("image/"),
              );
              if (file) {
                event.preventDefault();
                void attachPhoto(file);
              }
            }}
          />
          {(photo || photoBusy) && (
            <p
              className="basis-full px-2 text-xs text-muted-foreground"
              data-testid="coach-photo-state"
            >
              {photoBusy
                ? "Estimating your meal photo…"
                : "Meal photo attached. Ask about it or just send."}
            </p>
          )}
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            aria-label="Attach meal photo"
            onChange={(e) => void attachPhoto(e.target.files?.[0])}
          />
          <PromptInputFooter className="member-coach-footer">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                type="button"
                aria-label="More options"
                aria-expanded={toolsOpen}
                onClick={() => setToolsOpen(!toolsOpen)}
                className="member-coach-plus"
              >
                <Plus aria-hidden />
              </Button>
              {toolsOpen && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    title="Add a meal photo"
                    aria-label="Add a meal photo"
                    disabled={!!pending || photoBusy}
                    onClick={() => photoRef.current?.click()}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <Camera className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    title={loc ? "Location attached — tap to remove" : "Share my current location"}
                    aria-label={loc ? "Remove shared location" : "Share my current location"}
                    aria-pressed={!!loc}
                    disabled={!!pending || locBusy}
                    onClick={shareLocation}
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background disabled:opacity-50 ${loc ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <MapPin className="h-4 w-4" aria-hidden />
                  </Button>
                  <div className="member-coach-mode-pills" role="group" aria-label="Coach mode">
                    {COACH_MODES.map((md) => (
                      <button
                        key={md.key}
                        type="button"
                        title={md.hint}
                        aria-pressed={md.key === mode}
                        onClick={() => setMode(md.key)}
                        className={`member-coach-mode-pill ${md.key === mode ? "member-coach-mode-pill-on" : ""}`}
                      >
                        {md.label}
                      </button>
                    ))}
                  </div>
                  {confirmClear ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        className="member-coach-clear-confirm"
                        disabled={clearBusy}
                        onClick={() => void clearChat()}
                      >
                        {clearBusy ? "Clearing…" : "Clear all"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="member-coach-clear-cancel"
                        disabled={clearBusy}
                        onClick={() => setConfirmClear(false)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      title="Clear chat"
                      aria-label="Clear chat"
                      disabled={!!pending}
                      onClick={() => setConfirmClear(true)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <VoiceInputButton
                label="Speak your message"
                disabled={!!pending}
                onTranscript={(t) => {
                  setText((cur) => appendTranscript(cur, t));
                  inputRef.current?.focus({ preventScroll: true });
                }}
              />
              <PromptInputSubmit
                variant="ghost"
                status={pending ? "submitted" : "ready"}
                disabled={(!text.trim() && !photo) || !!pending || photoBusy}
                aria-label="Send"
                title="Send message"
                className="member-coach-send"
              >
                <ArrowUp aria-hidden />
              </PromptInputSubmit>
            </div>
          </PromptInputFooter>
        </PromptInput>
      )}
      <p className="member-coach-disclaimer text-center text-muted-foreground">
        Replies are written by AI and can be wrong. Not medical advice.{" "}
        <Link to="/legal/$doc" params={{ doc: "ai" }} className="underline">
          How AI is used
        </Link>
      </p>
    </div>
  );
}

function Bubble({
  role,
  content,
  actions = [],
  tools = [],
  createdAt,
}: {
  role: string;
  content: string;
  actions?: CoachAction[];
  tools?: { tool: string }[];
  createdAt?: string;
}) {
  const isUser = role === "user";
  const located = isUser && /\n\n\[Member's current phone location[\s\S]*\]$/.test(content);
  const shown = isUser
    ? content.replace(/\n\n\[Member's current phone location[\s\S]*\]$/, "")
    : content;
  const photo = /\n\n\[Meal photo estimate [^\]]*\]$/.test(shown);
  return (
    <Message from={isUser ? "user" : "assistant"} className="member-coach-message">
      <MessageContent className={isUser ? "member-coach-user" : "member-coach-assistant"}>
        {photo && <span className="text-xs text-muted-foreground">Meal photo attached</span>}
        {located && <span className="text-xs text-muted-foreground">Location shared</span>}
        {isUser ? (
          <p className="whitespace-pre-wrap">
            {shown.replace(/\n\n\[Meal photo estimate [^\]]*\]$/, "")}
          </p>
        ) : (
          <MessageResponse>{content}</MessageResponse>
        )}
      </MessageContent>
      {createdAt && (
        <time
          dateTime={createdAt}
          className={`text-[10px] text-muted-foreground ${isUser ? "text-right" : ""}`}
        >
          {new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </time>
      )}
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a, i) => (
            <ActionButton key={i} a={a} />
          ))}
        </div>
      )}
      {tools.length > 0 && (
        <Tool defaultOpen={false} className="member-coach-tools">
          <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
            Checked your context
            <ChevronDown className="size-3" aria-hidden />
          </CollapsibleTrigger>
          <ToolContent className="text-xs text-muted-foreground">
            {[...new Set(tools.map((t) => t.tool.replace(/^get_|_/g, " ").trim()))].join(", ")}
          </ToolContent>
        </Tool>
      )}
    </Message>
  );
}

function ConfirmCard({ a }: { a: Extract<CoachAction, { kind: "confirm" | "approve_plan" }> }) {
  const decide = useServerFn(decideCoachAction);
  const approve = useServerFn(approveWeekPlan);
  const qc = useQueryClient();
  const key = a.kind === "confirm" ? a.id : a.proposalId;
  const { data: saved } = useQuery({
    queryKey: ["coach-decision", key],
    queryFn: async () => {
      if (a.kind === "confirm") {
        const { data } = await supabase
          .from("coach_pending_actions")
          .select("status")
          .eq("id", a.id)
          .maybeSingle();
        return data?.status ?? "pending";
      }
      const { data } = await supabase
        .from("plan_versions")
        .select("status")
        .eq("id", a.proposalId)
        .maybeSingle();
      return data?.status === "proposed" ? "pending" : (data?.status ?? "pending");
    },
  });
  const [busy, setBusy] = useState(false);
  const state = saved ?? "pending";
  async function run(decision: "confirm" | "cancel") {
    setBusy(true);
    try {
      if (a.kind === "confirm") await decide({ data: { id: a.id, decision } });
      else if (decision === "confirm")
        await approve({ data: { proposalId: a.proposalId, mode: "permanent", trialDays: 14 } });
      toast.success(
        decision === "confirm" ? "Done. Your plan is updated." : "Cancelled. Nothing changed.",
      );
      await qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const done = state !== "pending";
  return (
    <div
      className="w-full rounded-[14px] border border-execute/50 bg-card p-3 text-sm"
      role="group"
      aria-label="Confirm change"
    >
      <p className="font-medium">{a.label}</p>
      <p className="mt-1 text-xs text-muted-foreground">{a.reason}</p>
      {done ? (
        <p className="mt-2 text-xs font-semibold text-execute">
          {state === "confirmed" || state === "approved" || state === "superseded"
            ? "Done"
            : state === "cancelled" || state === "rejected"
              ? "Cancelled"
              : state}
        </p>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            className="rounded-full bg-execute px-3 py-1 text-xs text-execute-foreground"
            disabled={busy}
            onClick={() => run("confirm")}
          >
            {busy ? "Working…" : a.kind === "confirm" ? "Confirm" : "Approve"}
          </Button>
          {a.kind === "confirm" && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-full border border-border px-3 py-1 text-xs"
              disabled={busy}
              onClick={() => run("cancel")}
            >
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({ a }: { a: CoachAction }) {
  if (a.kind === "confirm" || a.kind === "approve_plan") return <ConfirmCard a={a} />;
  return <PlainAction a={a} />;
}

function PlainAction({ a }: { a: Exclude<CoachAction, { kind: "confirm" | "approve_plan" }> }) {
  const propose = useServerFn(proposeWeekPlan);
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const cls =
    "rounded-full border border-execute px-3 py-1 text-xs text-execute hover:bg-execute hover:text-execute-foreground";
  if (a.kind === "replan")
    return (
      <Button
        variant="outline"
        size="sm"
        className={cls}
        title={a.reason}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await propose({ data: { trigger: "manual" } });
            nav({ to: "/app/plan" });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Building…" : a.label}
      </Button>
    );
  return (
    <Link
      to={a.to.split("?")[0] ?? "/app/coach"}
      search={
        a.to.includes("?")
          ? (Object.fromEntries(new URLSearchParams(a.to.split("?")[1])) as never)
          : (true as never)
      }
      className={cls}
      title={a.reason}
    >
      {a.label}
    </Link>
  );
}
