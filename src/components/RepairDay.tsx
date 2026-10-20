import { useState } from "react";
import { VoiceInputButton, WithVoice } from "@/components/VoiceInputButton";
import { appendTranscript } from "@/lib/voice-input";
import { PaidGate } from "@/components/PaidGate";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { LifeBuoy } from "lucide-react";
import { toast } from "sonner";
import { proposeDayRepair } from "@/lib/planning.functions";
import { DISRUPTION_REASONS, type DisruptionReason } from "@/lib/recovery-mode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Item = Awaited<ReturnType<typeof proposeDayRepair>>["items"][number] & {
  deferredTo?: string | null;
};
const hm = (m: number | null) =>
  m == null
    ? ""
    : `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const ACTION: Record<string, string> = {
  frozen: "Left alone",
  kept: "Unchanged",
  moved: "Moved",
  shortened: "Shorter",
  deferred: "Later this week",
};

export function RepairDay(p: { tz?: string | null | undefined }) {
  return (
    <PaidGate cap="recovery_mode">
      <RepairDayInner {...p} />
    </PaidGate>
  );
}

function RepairDayInner({ tz }: { tz?: string | null | undefined }) {
  const run = useServerFn(proposeDayRepair);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DisruptionReason>("overran");
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    items: Item[];
    autoApplied: boolean;
    hasProposal: boolean;
    availableMin: number;
  } | null>(null);

  async function submit() {
    setBusy(true);
    try {
      const r = await run({
        data: { reason, blockedUntil: until || null, note: note.trim() || undefined },
      });
      setResult({
        items: r.items as Item[],
        autoApplied: r.autoApplied,
        hasProposal: !!r.proposal,
        availableMin: r.availableMin,
      });
      qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't repair the day.");
    } finally {
      setBusy(false);
    }
  }
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz ?? undefined,
    });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
        className="rounded-[10px]"
      >
        <LifeBuoy className="h-3.5 w-3.5" /> Repair my day
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Repair my day</DialogTitle>
            <DialogDescription>
              A bad day isn't a failed day. Tell us what happened and we'll fit what still matters
              into the time you have left.
            </DialogDescription>
          </DialogHeader>
          {!result ? (
            <div className="space-y-3 text-sm">
              <label className="block">
                What got in the way?
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value as DisruptionReason)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                >
                  {Object.entries(DISRUPTION_REASONS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                Busy until (optional)
                <Input
                  type="time"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  className="mt-1"
                />
              </label>
              <label className="block">
                Anything else? (optional)
                <WithVoice value={note} onChange={(v) => setNote(v.slice(0, 300))}>
                  <Textarea
                    value={note}
                    maxLength={300}
                    onChange={(e) => setNote(e.target.value)}
                    className="mt-1"
                  />
                </WithVoice>
              </label>
              <p className="text-xs text-muted-foreground">
                Finished and protected sessions and your fixed commitments are never changed. The
                hour before bed stays free.
              </p>
              <Button onClick={submit} disabled={busy} className="w-full">
                {busy ? "Working it out…" : "Show me the repaired day"}
              </Button>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                {Math.floor(result.availableMin / 60)}h {result.availableMin % 60}m of free time
                left today.
              </p>
              {result.items.length === 0 ? (
                <p>Nothing was planned for the rest of today.</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {result.items.map((i) => (
                    <li key={i.id} className="p-2">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">
                          {i.title}
                          {i.mustDo ? " · must do" : ""}
                        </span>
                        <span className="text-xs text-muted-foreground">{ACTION[i.action]}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {hm(i.fromStart)} · {i.fromDuration} min
                        {i.action === "moved" || i.action === "shortened"
                          ? ` → ${hm(i.toStart)} · ${i.toDuration} min`
                          : ""}
                        {i.action === "deferred"
                          ? i.deferredTo
                            ? ` → ${fmt(i.deferredTo)}`
                            : " → no room this week"
                          : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">{i.why}</div>
                    </li>
                  ))}
                </ul>
              )}
              {result.autoApplied ? (
                <p>
                  These moves were within your Automatic changes settings, so they've been applied.
                </p>
              ) : result.hasProposal ? (
                <p>Nothing has moved yet. Review and approve it on your Plan.</p>
              ) : (
                <p>Your day still works as planned. Nothing needs changing.</p>
              )}
              <div className="flex gap-2">
                {result.hasProposal && !result.autoApplied && (
                  <Button
                    onClick={() => {
                      setOpen(false);
                      navigate({ to: "/app/plan" });
                    }}
                  >
                    Review on Plan
                  </Button>
                )}
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
