import { localDayKey } from "@/lib/tz";
import { WithVoice } from "@/components/VoiceInputButton";
import { rows as listRows } from "@/lib/rows";
import { useProfile } from "@/lib/data";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { proposeRecoveryAdaptation } from "@/lib/planning.functions";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { uid } from "@/lib/data";
import { readiness, readinessAdvice } from "@/lib/wellbeing";
import { assessRecovery, STATE_STYLE, RECOVERY_RULES_VERSION } from "@/lib/recovery-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const FIELDS = [
  { k: "sleep_quality", l: "Sleep quality", lo: "Poor", hi: "Great" },
  { k: "energy", l: "Energy", lo: "Drained", hi: "Charged" },
  { k: "soreness", l: "Soreness", lo: "None", hi: "Very sore" },
  { k: "stress", l: "Stress", lo: "Calm", hi: "Very high" },
] as const;

export function RecoveryPanel() {
  const adapt = useServerFn(proposeRecoveryAdaptation);
  const navigate = useNavigate();
  const [adapting, setAdapting] = useState(false);
  async function adaptPlan() {
    setAdapting(true);
    try {
      const r = await adapt();
      if (r.proposal) {
        toast.success(
          `${r.changes} session${r.changes > 1 ? "s" : ""} adjusted. Review and approve on your Plan.`,
        );
        navigate({ to: "/app/plan" });
      } else toast.message("Nothing left today needs changing.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAdapting(false);
    }
  }
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["recovery"],
    queryFn: async () =>
      listRows(
        await supabase
          .from("recovery_checkins")
          .select("*")
          .order("check_date", { ascending: false })
          .limit(30),
      ),
  });
  const { data: tzProfile } = useProfile();
  const today = localDayKey(new Date(), tzProfile?.timezone);
  const existing = rows.find((r) => r.check_date === today);
  const [f, setF] = useState({
    sleep_quality: 3,
    energy: 3,
    soreness: 2,
    stress: 2,
    note: "",
    ill_or_injured: false,
  });
  const score = readiness(f.sleep_quality, f.soreness, f.stress, f.energy);

  async function save() {
    const { error } = await supabase.from("recovery_checkins").upsert(
      {
        user_id: await uid(),
        check_date: today,
        ...f,
        note: f.note.trim() || null,
        readiness: score,
        recovery_version: RECOVERY_RULES_VERSION,
      },
      { onConflict: "user_id,check_date" },
    );
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Check-in saved");
    qc.invalidateQueries({ queryKey: ["recovery"] });
  }

  const shown = existing ?? null;
  const { data: ctx } = useQuery({
    queryKey: ["recovery-context"],
    queryFn: async () => {
      const since = new Date(Date.now() - 48 * 36e5).toISOString();
      const [sleep, hard, missed] = await Promise.all([
        supabase
          .from("health_samples")
          .select("value,recorded_at")
          .eq("kind", "sleep_hours")
          .gte("recorded_at", new Date(Date.now() - 7 * 864e5).toISOString())
          .order("recorded_at", { ascending: false })
          .limit(7),
        supabase
          .from("plan_blocks")
          .select("id", { count: "exact", head: true })
          .in("domain", ["training", "cardio"])
          .eq("status", "done")
          .gte("completed_at", since),
        supabase
          .from("plan_blocks")
          .select("id", { count: "exact", head: true })
          .in("status", ["missed", "skipped"])
          .gte("starts_at", since)
          .lt("starts_at", new Date().toISOString()),
      ]);
      const s = sleep.data ?? [];
      const last =
        s[0] && Date.now() - Date.parse(s[0].recorded_at) <= 864e5 ? Number(s[0].value) : null;
      return {
        sleepHours: last,
        history: s.map((x) => Number(x.value)),
        hard: hard.count ?? 0,
        missed: missed.count ?? 0,
      };
    },
  });
  const assessment = assessRecovery({
    checkin: shown,
    sleepHours: ctx?.sleepHours ?? null,
    recentHardSessions: ctx?.hard ?? 0,
    sleepHistory: ctx?.history ?? [],
    executionMissed48h: ctx?.missed ?? 0,
    sleepTargetHours:
      (tzProfile as { sleep_target_hours?: number } | undefined)?.sleep_target_hours ?? 8,
  });

  return (
    <div>
      <div className="member-recovery-layout">
        <div className={`member-recovery-state ${STATE_STYLE[assessment.state]}`}>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Today's recovery state</span>
            <span className="font-display text-3xl font-semibold">{assessment.state}</span>
          </div>
          <p className="mt-2 text-sm text-foreground">{assessment.guidance}</p>
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {assessment.reasons.map((r) => (
              <li key={r}>• {r}</li>
            ))}
          </ul>
          {assessment.notes.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {assessment.notes.map((r) => (
                <li key={r}>Also noted: {r}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Recovery rules version {assessment.version.replace(/\D+/g, "")}. This is not a medical
            or sleep-disorder assessment.
          </p>
          {shown && (
            <p className="mt-3 text-xs text-muted-foreground">
              Readiness {shown.readiness}/100 ({readinessAdvice(shown.readiness).band}).
              Self-reported, not a medical assessment.
            </p>
          )}
          {shown && (assessment.state === "RED" || assessment.state === "AMBER") && (
            <Button
              onClick={adaptPlan}
              disabled={adapting}
              variant="outline"
              className="mt-4 rounded-[10px]"
            >
              Adapt today's plan
            </Button>
          )}
          {!shown && (
            <p className="mt-3 text-xs text-muted-foreground">
              Preview from your current answers: readiness {score}/100.
            </p>
          )}
        </div>
        <div className="member-recovery-form space-y-5">
          {FIELDS.map((x) => (
            <div key={x.k}>
              <div className="mb-2 text-sm font-medium">{x.l}</div>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Button
                    variant="outline"
                    key={n}
                    type="button"
                    onClick={() => setF({ ...f, [x.k]: n })}
                    aria-label={`${x.l} ${n}`}
                    aria-pressed={f[x.k] === n}
                    className={`h-10 flex-1 rounded-[10px] border text-sm ${f[x.k] === n ? "border-primary bg-primary text-primary-foreground" : "border-border bg-raised"}`}
                  >
                    {n}
                  </Button>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>{x.lo}</span>
                <span>{x.hi}</span>
              </div>
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.ill_or_injured}
              onChange={(e) => setF({ ...f, ill_or_injured: e.target.checked })}
            />{" "}
            I'm ill or injured today
          </label>
          <WithVoice value={f.note} onChange={(v) => setF({ ...f, note: v.slice(0, 500) })}>
            <Textarea
              placeholder="Anything affecting recovery? (optional)"
              maxLength={500}
              value={f.note}
              onChange={(e) => setF({ ...f, note: e.target.value })}
            />
          </WithVoice>
          <Button onClick={save} className="w-full rounded-[10px]">
            {existing ? "Update today's check-in" : "Save check-in"}
          </Button>
        </div>
      </div>
      <h2 className="mt-10 text-lg font-semibold">Last 30 days</h2>
      {isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No check-ins yet.</p>
      ) : (
        <div className="mt-3 flex h-28 items-end gap-1">
          {[...rows].reverse().map((r) => (
            <div
              key={r.id}
              title={`${r.check_date}: ${r.readiness}`}
              className="flex-1 rounded-t bg-primary/70"
              style={{ height: `${Math.max(4, r.readiness)}%` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
