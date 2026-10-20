import { localDayRange, zonedParts } from "@/lib/tz";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  ArrowRight,
  BatteryCharging,
  Flame,
  LifeBuoy,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useBlocks, useProfile } from "@/lib/data";
import { BlockRow } from "@/components/BlockRow";
import { proposeWeekPlan } from "@/lib/planning.functions";
import { Button } from "@/components/ui/button";
import { TodayPanels } from "@/components/TodayPanels";
import { summariseToday, DAY_STATUS_LABEL } from "@/lib/today";
import todayImage from "@/assets/member-today.jpg";
import { useQuery } from "@tanstack/react-query";
import { getSessionBriefs } from "@/lib/session-brief.functions";
import { SessionCta } from "@/components/SessionCta";

export const Route = createFileRoute("/_authenticated/app/today")({
  head: () => ({
    meta: [
      { title: "Today | Plexecute" },
      {
        name: "description",
        content: "Your next action, daily progress and protected commitments in Plexecute.",
      },
      { property: "og:title", content: "Today | Plexecute" },
      {
        property: "og:description",
        content: "Your next action, daily progress and protected commitments in Plexecute.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Today,
});

function Today() {
  const { data: profile } = useProfile();
  const navigate = useNavigate();
  const propose = useServerFn(proposeWeekPlan);
  const tz = profile?.timezone;
  const [from, to] = useMemo(() => {
    const [a, b] = localDayRange(new Date(), tz);
    return [a.toISOString(), b.toISOString()];
  }, [tz]);
  const { data: blocks = [], isLoading } = useBlocks(from, to);
  const sum = summariseToday(blocks);
  const next = sum.next;
  const done = sum.completed.length;
  const pct = sum.pct;
  const briefsFn = useServerFn(getSessionBriefs);
  const ids = blocks.slice(0, 12).map((b) => b.id);
  const { data: briefs = [] } = useQuery({
    queryKey: ["session-briefs", ids.join(","), blocks.map((b) => b.status).join(",")],
    queryFn: () => briefsFn({ data: { blockIds: ids } }),
    enabled: ids.length > 0,
  });
  const briefOf = (id: string) => briefs.find((x) => x.blockId === id);
  const nextBrief = next ? briefOf(next.id) : undefined;

  async function recoveryMode() {
    if (!sum.needsChange) {
      toast("Nothing to repair. You're on track.");
      return;
    }
    await propose({ data: { trigger: "recovery" } });
    toast.success("A recovery plan is ready to review. Nothing changed yet.");
    navigate({ to: "/app/plan" });
  }

  const hour = zonedParts(new Date(), tz).h;
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <header className="member-today-heading">
        <img src={todayImage} width={1536} height={1024} alt="" className="member-today-image" />
        <div className="member-today-intro">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-execute" />
            {new Date().toLocaleDateString([], {
              weekday: "long",
              day: "numeric",
              month: "long",
              timeZone: tz ?? "UTC",
            })}
            · {DAY_STATUS_LABEL[sum.status]}
          </p>
          <h1 className="mt-4 font-semibold">
            {greet}
            {profile?.display_name ? `, ${profile.display_name}` : ""}.
          </h1>
          <p className="mt-2 text-lg text-execute">
            {next ? "Execute the next one." : blocks.length ? "Day executed." : "Plan your day."}
          </p>
        </div>
      </header>
      <section className="member-today-next">
        <p className="text-xs font-medium uppercase text-muted-foreground">Next up</p>
        <div className="mt-3 grid min-w-0 gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">
              {next
                ? next.title
                : blocks.length
                  ? "Everything for today is handled."
                  : "Nothing scheduled today."}
            </h2>
            {next && (
              <p className="mt-1 text-sm text-muted-foreground">
                {new Date(next.starts_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: tz ?? "UTC",
                })}{" "}
                · {next.duration_min} min
              </p>
            )}
            {nextBrief && (
              <div className="mt-3 space-y-1" data-testid="today-next-brief">
                <p className="text-sm text-execute">{nextBrief.objective}</p>
                <p className="text-sm text-muted-foreground">Start here: {nextBrief.firstStep}</p>
              </div>
            )}
          </div>
          {next && nextBrief ? (
            <div className="grid gap-2">
              <SessionCta
                cta={nextBrief.primary}
                block={blocks.find((b) => b.id === next.id)!}
                brief={nextBrief}
                primary
              />
              <Link
                to="/app/session/$id"
                params={{ id: next.id }}
                className="text-center text-sm text-muted-foreground hover:text-execute"
              >
                Session details
              </Link>
            </div>
          ) : (
            <Button asChild className="w-full">
              <Link to="/app/plan">
                See my week <ArrowRight />
              </Link>
            </Button>
          )}
        </div>
      </section>

      <div className="member-today-summary">
        <Ask
          q="Main focus"
          a={
            sum.matters.length
              ? sum.matters.map((b) => b.title).join(", ")
              : sum.total
                ? `${sum.total} sessions, ${sum.minutesPlanned} min`
                : "Nothing planned"
          }
        />
        <Ask
          q="Next action"
          a={
            next
              ? `${next.title} at ${new Date(next.starts_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: tz ?? "UTC" })}`
              : "Nothing left"
          }
        />
        <div className="rounded-[20px] border border-border bg-card p-5">
          <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Flame className="h-3.5 w-3.5 text-execute" /> Daily progress
          </p>
          <p className="mt-2 font-display text-3xl font-semibold">
            {done}
            <span className="text-lg text-muted-foreground">/{sum.total}</span>
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised">
            <div className="h-full bg-execute transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {sum.minutesDone} of {sum.minutesPlanned} min done
          </p>
        </div>
        <Ask
          q="Plan status"
          a={
            sum.needsChange
              ? `${sum.needsChange} session${sum.needsChange > 1 ? "s" : ""} missed or overdue.`
              : "Nothing. Keep going."
          }
          warn={sum.needsChange > 0}
        />
      </div>

      <TodayPanels blocks={blocks} tz={tz} />

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Quick
          to="/app/coach"
          icon={MessageSquare}
          t="Ask your coach"
          d="Get one clear next action."
        />
        <Quick
          to="/app/recovery"
          icon={BatteryCharging}
          t="Recovery check-in"
          d="Tune today to how you feel."
        />
      </div>

      {profile?.tier === "free" && (
        <Link
          to="/app/billing"
          search={{ status: undefined }}
          className="mt-4 flex items-center justify-between gap-4 rounded-[20px] border border-execute/40 bg-gradient-to-r from-execute/15 to-transparent p-5 hover:border-execute"
        >
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-execute" />
            <div>
              <p className="font-semibold">Unlock Pro or Execute</p>
              <p className="text-sm text-muted-foreground">
                Unlimited coaching, experiments and accountability calls. 7-day free trial.
              </p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-execute" />
        </Link>
      )}

      <div className="mt-10 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Today's plan</h3>
        <Button variant="outline" size="sm" onClick={recoveryMode} className="rounded-[10px]">
          <LifeBuoy className="h-3.5 w-3.5" /> Recovery Mode
        </Button>
      </div>
      <div className="mt-4 space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {blocks.map((b) => (
          <BlockRow
            key={b.id}
            block={b}
            objective={briefOf(b.id)?.objective !== b.title ? briefOf(b.id)?.objective : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function Quick({
  to,
  icon: Icon,
  t,
  d,
}: {
  to: "/app/coach" | "/app/recovery";
  icon: typeof MessageSquare;
  t: string;
  d: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-[20px] border border-border bg-card p-6 hover:border-execute/60"
    >
      <Icon className="h-5 w-5 text-execute" />
      <p className="mt-4 font-semibold">{t}</p>
      <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
        {d} <ArrowRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
      </p>
    </Link>
  );
}

function Ask({ q, a, warn }: { q: string; a: string; warn?: boolean }) {
  return (
    <div
      className={`rounded-[20px] border bg-card p-5 ${warn ? "border-warning/60" : "border-border"}`}
    >
      <p className="text-xs uppercase tracking-widest text-muted-foreground">{q}</p>
      <p className="mt-2 font-semibold">{a}</p>
    </div>
  );
}
