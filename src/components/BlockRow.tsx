import { CLASS_LABEL, type EvidenceClass } from "@/lib/verification";
import { VoiceInputButton, WithVoice } from "@/components/VoiceInputButton";
import { appendTranscript } from "@/lib/voice-input";
const EVIDENCE_SHORT: Record<string, string> = {
  verified_external: "verified by device",
  supported: "supported by logs",
  self_reported: "self-reported",
  unknown: "no evidence",
};
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { setSessionCall } from "@/lib/calling.functions";
import {
  Check,
  CircleDashed,
  MoreHorizontal,
  Play,
  ShieldAlert,
  SkipForward,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import type { Block } from "@/lib/data";
import { useSetBlockStatus } from "@/lib/data";
import type { PlanBlockActionInput } from "@/lib/planning.functions";
import { fmtTime } from "@/lib/scheduler";
import { useProfile } from "@/lib/data";
import { OPEN_STATES, STATE_LABEL, type ExecState } from "@/lib/execution";
import { KIND_LABELS, type OccurrenceKind } from "@/lib/occurrences";
import { Button } from "@/components/ui/button";
import {
  LAPSE_OPTIONS,
  MISSED_REASONS,
  REASON_LABEL,
  lapseMessage,
  type MissedReason,
} from "@/lib/behaviour";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function StatusTag({ status, evidence }: { status: string; evidence?: string | undefined }) {
  if (status === "done")
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-success"
        title={CLASS_LABEL[(evidence ?? "self_reported") as EvidenceClass]}
      >
        <Check className="h-3.5 w-3.5" /> Done ·{" "}
        {EVIDENCE_SHORT[evidence ?? "self_reported"] ?? "self-reported"}
      </span>
    );
  if (status === "skipped")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-warning">
        <SkipForward className="h-3.5 w-3.5" /> Skipped
      </span>
    );
  if (status === "in_progress")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-execute">
        <Play className="h-3.5 w-3.5" /> In progress
      </span>
    );
  if (status === "safety_stopped")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <ShieldAlert className="h-3.5 w-3.5" /> Stopped for safety
      </span>
    );
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${status === "due" ? "text-execute" : status === "expired" ? "text-warning" : "text-muted-foreground"}`}
    >
      <CircleDashed className="h-3.5 w-3.5" />{" "}
      {STATE_LABEL[status as ExecState] ?? status.replace("_", " ")}
    </span>
  );
}

type ReasonAction = "skip" | "partial" | "blocked" | "safety_stop";
const REASON_COPY: Record<ReasonAction, { title: string; placeholder: string }> = {
  skip: {
    title: "Why are you skipping this session?",
    placeholder: "e.g. ran out of time, feeling unwell",
  },
  partial: { title: "What did you complete?", placeholder: "e.g. 20 of 45 minutes" },
  blocked: {
    title: "What's blocking this session?",
    placeholder: "e.g. gym closed, meeting overran",
  },
  safety_stop: {
    title: "What made you stop?",
    placeholder: "e.g. chest pain, dizziness, sharp joint pain",
  },
};

export function BlockRow({
  block,
  compact,
  objective,
}: {
  block: Block;
  compact?: boolean;
  objective?: string | undefined;
}) {
  const profileTz = useProfile().data?.timezone ?? null;
  const set = useSetBlockStatus();
  const [reason, setReason] = useState<ReasonAction | null>(null);
  const [note, setNote] = useState("");
  const [why, setWhy] = useState<MissedReason | null>(null);
  const [after, setAfter] = useState<MissedReason | null>(null);
  const needsReason = reason === "skip" || reason === "partial" || reason === "blocked";
  const run = (input: PlanBlockActionInput, msg?: string) =>
    set.mutate(input, {
      onSuccess: () => msg && toast.success(msg),
      onError: (e) => toast.error((e as Error).message),
    });
  const open = OPEN_STATES.includes(block.status as ExecState);
  const qc = useQueryClient();
  const setCall = useServerFn(setSessionCall);
  async function toggleCall() {
    const on = !(block as { call_requested?: boolean }).call_requested;
    const r = await setCall({ data: { blockId: block.id, on } });
    if (!r.ok) {
      toast.error(r.error ?? "Couldn't update that session.");
      return;
    }
    toast.success(on ? "We'll call you when it's due" : "No call for this session");
    qc.invalidateQueries();
  }
  const active = block.status === "in_progress";

  function submitReason() {
    if (!reason) return;
    if (reason === "safety_stop") {
      if (!note.trim()) return;
      run(
        { blockId: block.id, action: reason, note: note.trim() },
        "Stopped. If symptoms persist, seek medical help.",
      );
    } else {
      if (!why) return;
      run({ blockId: block.id, action: reason, missedReason: why, note: note.trim() || undefined });
      setAfter(why);
    }
    if (reason === "safety_stop")
      toast.message("If you have chest pain, fainting or severe breathlessness, call 999 now.");
    setReason(null);
    setNote("");
    setWhy(null);
  }

  return (
    <div className="member-block-row flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card p-4">
      <div className="w-14 shrink-0 font-display text-sm tabular-nums text-muted-foreground">
        {fmtTime(block.starts_at, profileTz)}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={`truncate font-medium ${block.status === "done" ? "text-muted-foreground line-through" : ""}`}
        >
          <Link
            to="/app/session/$id"
            params={{ id: block.id }}
            className="hover:text-execute"
            data-testid="open-session"
          >
            {block.title}
          </Link>
        </div>
        {objective && <p className="mt-0.5 truncate text-xs text-execute/90">{objective}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs text-muted-foreground">
            {KIND_LABELS[
              (block as { occurrence_kind?: OccurrenceKind }).occurrence_kind ?? "other"
            ] ?? "Task"}{" "}
            · {block.duration_min} min
          </span>
          <StatusTag status={block.status} evidence={(block as { evidence?: string }).evidence} />
          {block.interruption_count > 0 && (
            <span className="text-xs text-muted-foreground">
              Snoozed ×{block.interruption_count}
            </span>
          )}
          {(block as { call_requested?: boolean }).call_requested && (
            <span className="text-xs text-execute">Call on</span>
          )}
        </div>
      </div>
      {!compact &&
        (open || active ? (
          <div className="member-block-actions flex flex-wrap gap-2">
            {open && block.domain === "wellness" && (
              <Button size="sm" variant="outline" asChild>
                <Link to="/app/wellness" search={{ block: block.id }}>
                  Begin
                </Link>
              </Button>
            )}
            {open && ["training", "cardio", "mobility"].includes(block.domain ?? "") && (
              <Button size="sm" variant="outline" asChild>
                {block.domain === "mobility" ? (
                  <Link to="/app/wellness" search={{ section: "mobility" }}>
                    Open
                  </Link>
                ) : (
                  <Link
                    to="/app/training"
                    search={block.domain === "cardio" ? { section: "cardio" } : {}}
                  >
                    Open
                  </Link>
                )}
              </Button>
            )}
            {open && block.domain !== "wellness" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => run({ blockId: block.id, action: "start" })}
              >
                Start
              </Button>
            )}
            {active && (
              <Button size="sm" variant="outline" onClick={() => setReason("partial")}>
                Partial
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => run({ blockId: block.id, action: "complete" }, "Nice work")}
            >
              Done
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {block.status !== "acknowledged" && (
                  <DropdownMenuItem
                    onClick={() =>
                      run({ blockId: block.id, action: "acknowledge" }, "Acknowledged")
                    }
                  >
                    Acknowledge
                  </DropdownMenuItem>
                )}
                {open && block.interruption_count < 3 && (
                  <>
                    <DropdownMenuItem
                      onClick={() =>
                        run(
                          { blockId: block.id, action: "snooze", minutes: 15 },
                          "Moved 15 minutes",
                        )
                      }
                    >
                      Snooze 15 min
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        run({ blockId: block.id, action: "snooze", minutes: 60 }, "Moved 1 hour")
                      }
                    >
                      Snooze 1 hour
                    </DropdownMenuItem>
                  </>
                )}
                {open && (
                  <DropdownMenuItem onClick={toggleCall}>
                    {(block as { call_requested?: boolean }).call_requested
                      ? "Don't call me for this"
                      : "Call me when it's due"}
                  </DropdownMenuItem>
                )}
                {open && (
                  <DropdownMenuItem onClick={() => setReason("partial")}>
                    Partly done
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setReason("blocked")}>Blocked</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setReason("skip")}>
                  Skip with reason
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => setReason("safety_stop")}
                >
                  Stop for safety
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            onClick={() => run({ blockId: block.id, action: "restore" }, "Restored")}
            aria-label="Restore to planned"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
        ))}
      <Dialog
        open={reason != null}
        onOpenChange={(o) => {
          if (!o) {
            setReason(null);
            setNote("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reason ? REASON_COPY[reason].title : ""}</DialogTitle>
          </DialogHeader>
          {needsReason && (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Reason">
              {MISSED_REASONS.map((m) => (
                <Button
                  key={m}
                  size="sm"
                  type="button"
                  role="radio"
                  aria-checked={why === m}
                  variant={why === m ? "default" : "outline"}
                  onClick={() => setWhy(m)}
                >
                  {REASON_LABEL[m]}
                </Button>
              ))}
            </div>
          )}
          <WithVoice value={note} onChange={(v) => setNote(v.slice(0, 500))}>
            <Textarea
              maxLength={500}
              value={note}
              placeholder={
                needsReason
                  ? "Add a note (optional)"
                  : reason
                    ? REASON_COPY[reason].placeholder
                    : ""
              }
              onChange={(e) => setNote(e.target.value)}
            />
          </WithVoice>
          <DialogFooter>
            <Button
              disabled={(needsReason ? !why : !note.trim()) || set.isPending}
              onClick={submitReason}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={after != null}
        onOpenChange={(o) => {
          if (!o) setAfter(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{after ? lapseMessage(after) : ""}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            If you'd like, pick a next step. It's your choice.
          </p>
          <div className="flex flex-col gap-2">
            {after &&
              LAPSE_OPTIONS[after].map((o) => {
                const to =
                  o.to === "goal" || !o.to
                    ? block.goal_id
                      ? `/app/goals/${block.goal_id}`
                      : "/app/goals"
                    : o.to;
                return (
                  <Button key={o.label} variant="outline" asChild onClick={() => setAfter(null)}>
                    <a href={to}>{o.label}</a>
                  </Button>
                );
              })}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAfter(null)}>
              Not now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
