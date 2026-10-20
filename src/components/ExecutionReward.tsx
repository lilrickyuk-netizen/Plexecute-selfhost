import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Award } from "lucide-react";
import { getMyReward } from "@/lib/reward.functions";
import { useProfile } from "@/lib/data";
import { marketFor, money } from "@/lib/billing";
import { INELIGIBLE_COPY, STATE_COPY, type RewardState } from "@/lib/reward";

const d = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Execute Monthly Execution Reward card. Shows only truthful counts from the accepted plan. */
export function ExecutionReward({ showHistory = false }: { showHistory?: boolean }) {
  const load = useServerFn(getMyReward);
  const { data } = useQuery({ queryKey: ["execution-reward"], queryFn: () => load() });
  const { data: prof } = useProfile();
  const amt = money(1000, marketFor(prof)).replace(".00", "");
  if (!data || data.tier !== "execute") return null;
  const c = data.current;
  const pct = c && c.required_count ? Math.round((c.completed_count / c.required_count) * 100) : 0;
  const past = data.history.filter((h) => h.state !== "IN_PROGRESS");

  return (
    <section className="rounded-[20px] border border-execute/40 bg-card p-6">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-execute">
        <Award className="h-4 w-4" /> Execute
      </div>
      <h2 className="mt-1 text-lg font-semibold">Monthly Execution Reward</h2>
      <p className="text-sm text-muted-foreground">
        Complete the full plan to earn {amt} off your next monthly renewal.
      </p>
      {!data.eligible ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {INELIGIBLE_COPY[data.reason ?? ""] ?? "Not available for this subscription."}
        </p>
      ) : (
        c && (
          <div className="mt-4 space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="font-display text-2xl font-semibold tabular-nums">
                {c.completed_count} / {c.required_count}
              </span>
              <span className="text-xs text-muted-foreground">
                planned actions completed · {d(c.period_start)} to {d(c.period_end)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-raised">
              <div className="h-2 rounded-full bg-execute" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-sm">{pct}% of your accepted monthly plan completed</p>
            <p className="text-xs text-muted-foreground">
              Moving a session to another time keeps it in this month's plan. Sessions stopped for
              safety don't count against you.
            </p>
          </div>
        )
      )}
      {past[0]?.state === "EARNED" && (
        <div className="mt-4 rounded-[12px] bg-raised p-3 text-sm">
          <b>Monthly plan completed</b>
          <br />
          {amt} reward earned
          <br />
          <span className="text-muted-foreground">
            Your next eligible Execute renewal will receive the reward.
          </span>
        </div>
      )}
      {past[0]?.state === "NOT_EARNED" && (
        <div className="mt-4 rounded-[12px] bg-raised p-3 text-sm">
          <b>Monthly reward not earned</b>
          <br />
          You completed{" "}
          {past[0].required_count
            ? Math.floor((past[0].completed_count / past[0].required_count) * 100)
            : 0}
          % of your accepted monthly plan.
        </div>
      )}
      {past[0]?.state === "APPLIED" && (
        <div className="mt-4 rounded-[12px] bg-raised p-3 text-sm">
          <b>{amt} reward applied</b> to your renewal on {d(past[0].applied_at!)}.
        </div>
      )}
      {showHistory && past.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {past.map((h) => (
            <li key={h.id} className="flex justify-between gap-3">
              <span>
                {d(h.period_start)} to {d(h.period_end)} · {h.completed_count} / {h.required_count}
              </span>
              <span className="text-muted-foreground">{STATE_COPY[h.state as RewardState]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
