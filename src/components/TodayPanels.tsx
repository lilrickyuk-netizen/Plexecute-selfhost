import { useProfile } from "@/lib/data";
import { unitsOf, displayToKg, weightUnit } from "@/lib/units";
import { isoDowOfKey, localDayKey } from "@/lib/tz";
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BatteryCharging,
  BookOpen,
  Dumbbell,
  HelpCircle,
  Lock,
  PenLine,
  RefreshCw,
  Salad,
  Wind,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { uid } from "@/lib/data";
import { assessRecovery, STATE_STYLE } from "@/lib/recovery-state";
import { blocksFor, type TodayBlock } from "@/lib/today";
import { STATE_LABEL } from "@/lib/execution";
import { proposeWeekPlan } from "@/lib/planning.functions";
import { Button } from "@/components/ui/button";
import { RepairDay } from "@/components/RepairDay";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const t = (iso: string, tz?: string | null) =>
  new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(tz ? { timeZone: tz } : {}),
  });
const hm = (s: string) => s.slice(0, 5);

export function TodayPanels({
  blocks,
  tz,
}: {
  blocks: TodayBlock[];
  tz?: string | null | undefined;
}) {
  const today = localDayKey(new Date(), tz);
  const isoDow = isoDowOfKey(today);

  const { data } = useQuery({
    queryKey: ["today-panels", today],
    queryFn: async () => {
      const [c, chk, tgt, food, plan] = await Promise.all([
        supabase
          .from("commitments")
          .select("id,title,kind,recurrence,days,on_date,start_time,end_time,is_hard,active")
          .eq("active", true),
        supabase
          .from("recovery_checkins")
          .select("sleep_quality,energy,soreness,stress,ill_or_injured")
          .eq("check_date", today)
          .maybeSingle(),
        supabase
          .from("nutrition_targets")
          .select("kcal,protein_g")
          .eq("status", "applied")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from("food_entries").select("kcal,protein_g").eq("eaten_on", today),
        supabase
          .from("plan_versions")
          .select("version,status,trigger,feasibility,explanation,approved_at,created_at")
          .order("created_at", { ascending: false })
          .limit(3),
      ]);
      return {
        commitments: (c.data ?? [])
          .filter((x) =>
            x.recurrence === "weekly" ? (x.days as number[]).includes(isoDow) : x.on_date === today,
          )
          .sort((a, b) => a.start_time.localeCompare(b.start_time)),
        checkin: chk.data,
        target: tgt.data,
        eaten: (food.data ?? []).reduce(
          (s, f) => ({ kcal: s.kcal + Number(f.kcal), protein: s.protein + Number(f.protein_g) }),
          { kcal: 0, protein: 0 },
        ),
        foodCount: food.data?.length ?? 0,
        plans: plan.data ?? [],
      };
    },
  });

  const recovery = assessRecovery({ checkin: data?.checkin ?? null });
  const training = blocksFor(blocks, ["training", "cardio"]);
  const wellness = blocksFor(blocks, ["wellness", "mobility"]);
  const work = blocksFor(blocks, ["learning", "career", "work_prep"]);
  const protectedBlocks = blocks.filter((b) => b.is_protected);

  return (
    <>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Panel icon={Lock} title="Protected commitments">
          {!data?.commitments.length && !protectedBlocks.length ? (
            <Empty>No fixed commitments today.</Empty>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data?.commitments.map((c) => (
                <li key={c.id} className="flex justify-between gap-3">
                  <span>{c.title}</span>
                  <span className="text-muted-foreground">
                    {hm(c.start_time)}–{hm(c.end_time)}
                  </span>
                </li>
              ))}
              {protectedBlocks.map((b) => (
                <li key={b.id} className="flex justify-between gap-3">
                  <span>
                    {b.title} <span className="text-xs text-muted-foreground">(protected)</span>
                  </span>
                  <span className="text-muted-foreground">{t(b.starts_at, tz)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          icon={BatteryCharging}
          title="Recovery"
          action={
            <Link
              to="/app/recovery"
              className="inline-flex min-h-6 items-center text-xs text-execute"
            >
              Check in
            </Link>
          }
        >
          <p
            className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATE_STYLE[recovery.state]}`}
          >
            {recovery.state}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{recovery.guidance}</p>
        </Panel>

        {training.length > 0 && (
          <Panel
            icon={Dumbbell}
            title="Training"
            action={
              <Link to="/app/training" className="text-xs text-execute">
                Open
              </Link>
            }
          >
            <BlockList items={training} />
          </Panel>
        )}

        <Panel
          icon={Salad}
          title="Nutrition"
          action={
            <Link
              to="/app/nutrition"
              className="inline-flex min-h-6 items-center text-xs text-execute"
            >
              Log food
            </Link>
          }
        >
          {data?.target ? (
            <>
              <p className="text-sm">
                <span className="font-display text-2xl font-semibold">
                  {Math.round(data.eaten.kcal)}
                </span>
                <span className="text-muted-foreground"> / {data.target.kcal} kcal</span>
              </p>
              <p className="text-sm text-muted-foreground">
                Protein {Math.round(data.eaten.protein)} / {data.target.protein_g} g
                {data.foodCount === 0 ? " · nothing logged yet" : ""}
              </p>
            </>
          ) : (
            <Empty>No targets set yet. Add your height, birth date and weight to get them.</Empty>
          )}
        </Panel>

        {wellness.length > 0 && (
          <Panel
            icon={Wind}
            title="Wellness & Movement"
            action={
              <Link to="/app/wellness" className="text-xs text-execute">
                Start
              </Link>
            }
          >
            <BlockList items={wellness} />
          </Panel>
        )}

        {work.length > 0 && (
          <Panel icon={BookOpen} title="Learning and work">
            <BlockList items={work} />
          </Panel>
        )}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <QuickLog tz={tz} />
        <PlanActions plans={data?.plans ?? []} tz={tz} />
      </div>
    </>
  );
}

function BlockList({ items }: { items: TodayBlock[] }) {
  const tz = useProfile().data?.timezone ?? null;
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((b) => (
        <li key={b.id} className="flex justify-between gap-3">
          <span>{b.title}</span>
          <span className="text-muted-foreground">
            {t(b.starts_at, tz)} · {STATE_LABEL[b.status as keyof typeof STATE_LABEL] ?? b.status}
          </span>
        </li>
      ))}
    </ul>
  );
}

const QUICK = [
  { k: "weight", label: "Weight", unit: "kg" },
  { k: "sleep", label: "Sleep", unit: "h" },
  { k: "energy", label: "Energy", unit: "1–10" },
] as const;

function QuickLog({ tz }: { tz?: string | null | undefined }) {
  const { data: prof } = useProfile();
  const u = unitsOf(prof);
  const qc = useQueryClient();
  const [kind, setKind] = useState<(typeof QUICK)[number]["k"]>("weight");
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    const v = Number(val);
    if (!val || !Number.isFinite(v) || v <= 0) {
      toast.error("Enter a number above zero.");
      return;
    }
    if (kind === "energy" && v > 10) {
      toast.error("Energy is 1 to 10.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("daily_logs").insert({
      user_id: await uid(),
      kind,
      value: kind === "weight" ? displayToKg(v, u) : v,
      log_date: localDayKey(new Date(), tz),
    });
    setBusy(false);
    if (error) {
      toast.error("Couldn't save that. Try again.");
      return;
    }
    setVal("");
    qc.invalidateQueries({ queryKey: ["logs"] });
    toast.success("Logged.");
  }
  const q0 = QUICK.find((q) => q.k === kind)!;
  const cur = { ...q0, unit: q0.k === "weight" ? weightUnit(u) : q0.unit };
  return (
    <Panel icon={PenLine} title="Quick log">
      <div className="flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button
            key={q.k}
            onClick={() => setKind(q.k)}
            className={`rounded-full border px-3 py-1 text-xs ${kind === q.k ? "border-execute text-execute" : "border-border text-muted-foreground"}`}
          >
            {q.label}
          </button>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          aria-label={`${cur.label} (${cur.unit})`}
          inputMode="decimal"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={cur.unit}
          className="h-9 w-full rounded-[10px] border border-border bg-background px-3 text-sm"
        />
        <Button size="sm" onClick={save} disabled={busy} className="rounded-[10px]">
          Save
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Food goes in{" "}
        <Link to="/app/nutrition" className="text-execute">
          Nutrition
        </Link>
        , sets in{" "}
        <Link to="/app/training" className="text-execute">
          Training
        </Link>
        .
      </p>
    </Panel>
  );
}

type PlanRow = {
  version: number;
  status: string;
  trigger: string;
  feasibility: string;
  explanation: string | null;
  approved_at: string | null;
  created_at: string;
};
const FEAS: Record<string, string> = {
  feasible: "Your goals fit this week.",
  minimum: "Your goals fit at their minimum time.",
  infeasible: "Not everything fits this week.",
};

function PlanActions({ plans, tz }: { plans: PlanRow[]; tz?: string | null | undefined }) {
  const navigate = useNavigate();
  const propose = useServerFn(proposeWeekPlan);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = plans.find((p) => p.status === "approved") ?? plans[0];
  async function replan() {
    setBusy(true);
    try {
      await propose({ data: { trigger: "manual" } });
      toast.success("A new plan is ready to review. Nothing changed yet.");
      navigate({ to: "/app/plan" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't build a new plan.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel icon={RefreshCw} title="Change the plan">
      <p className="text-sm text-muted-foreground">
        Build a fresh plan from where you are now. You review it before anything moves.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={replan} disabled={busy} className="rounded-[10px]">
          <RefreshCw className="h-3.5 w-3.5" /> Replan
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
          className="rounded-[10px]"
        >
          <HelpCircle className="h-3.5 w-3.5" /> Explain plan
        </Button>
        <RepairDay tz={tz} />
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Why today looks like this</DialogTitle>
            <DialogDescription>
              {active
                ? `Plan version ${active.version}, ${active.status === "approved" ? "approved" : "waiting for your approval"}.`
                : "No plan yet."}
            </DialogDescription>
          </DialogHeader>
          {active ? (
            <div className="space-y-3 text-sm">
              <p>{FEAS[active.feasibility] ?? active.feasibility}</p>
              <p className="whitespace-pre-line text-muted-foreground">
                {active.explanation ||
                  "Sessions are placed in your free time around sleep, work and fixed commitments, with 10% spare time kept free. Protected goals are placed first."}
              </p>
              <Link to="/app/plan" className="text-execute" onClick={() => setOpen(false)}>
                See the full plan and its history
              </Link>
            </div>
          ) : (
            <Link to="/app/plan" className="text-sm text-execute">
              Build your first plan
            </Link>
          )}
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function Panel({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: typeof Lock;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[20px] border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Icon className="h-3.5 w-3.5 text-execute" /> {title}
        </p>
        {action}
      </div>
      {children}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
