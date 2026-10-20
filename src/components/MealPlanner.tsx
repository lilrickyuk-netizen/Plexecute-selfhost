import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  decideMealPlan,
  generateMealPlan,
  getMealPlan,
  removePlannedMeal,
} from "@/lib/meal-plan.functions";
import type { buildMealPlan } from "@/lib/meal-planner";

type Plan = ReturnType<typeof buildMealPlan> & { exclusions?: string[] };

export function MealPlanner() {
  const get = useServerFn(getMealPlan);
  const gen = useServerFn(generateMealPlan);
  const { data, refetch } = useQuery({ queryKey: ["meal-plan"], queryFn: () => get() });
  const [household, setHousehold] = useState(1);
  const [prep, setPrep] = useState(90);
  const [excl, setExcl] = useState("");
  const [busy, setBusy] = useState(false);
  const decide = useServerFn(decideMealPlan);
  const remove = useServerFn(removePlannedMeal);
  const row = data?.plan;
  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      await refetch();
      toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const plan = data?.plan?.plan as Plan | undefined;

  async function build(nextWeek: boolean) {
    setBusy(true);
    try {
      await gen({
        data: {
          household,
          prepMinutes: prep,
          exclusions: excl
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          nextWeek,
        },
      });
      await refetch();
      toast.success("Meal plan proposed. Review it, then approve or reject.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 rounded-[20px] border border-border bg-card p-5">
      <h2 className="font-semibold">Meal plan this week</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Built only from your saved meals and recipes, sized to your targets, avoiding your
        allergies.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          People
          <Input
            type="number"
            min={1}
            max={12}
            value={household}
            onChange={(e) => setHousehold(Math.max(1, Number(e.target.value) || 1))}
            className="w-20"
          />
        </label>
        <label className="flex flex-col gap-1">
          Prep time (min)
          <Input
            type="number"
            min={0}
            max={600}
            value={prep}
            onChange={(e) => setPrep(Math.max(0, Number(e.target.value) || 0))}
            className="w-24"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          Leave out (comma separated)
          <Input
            value={excl}
            onChange={(e) => setExcl(e.target.value)}
            placeholder="mushroom, pork"
          />
        </label>
        <Button size="sm" disabled={busy} onClick={() => build(false)}>
          {plan ? "Rebuild" : "Build plan"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => build(true)}>
          Plan next week
        </Button>
      </div>
      {plan && (
        <div className="mt-4 space-y-4 text-sm">
          {row && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={row.status === "approved" ? "text-execute" : "text-warning"}>
                {row.status === "approved" ? "Approved" : "Waiting for your approval"}
              </span>
              {row.status === "proposed" && (
                <>
                  <Button
                    size="sm"
                    onClick={() =>
                      act(
                        () => decide({ data: { id: row.id, approve: true, note: null } }),
                        "Approved. Prep will be fitted into your next plan.",
                      )
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const note = window.prompt("Why reject? (optional)") ?? null;
                      act(() => decide({ data: { id: row.id, approve: false, note } }), "Rejected");
                    }}
                  >
                    Reject
                  </Button>
                </>
              )}
            </div>
          )}
          {plan.notes.map((n) => (
            <p key={n} className="text-xs text-warning">
              {n}
            </p>
          ))}
          {plan.days.some((d) => d.meals.length) && (
            <p className="text-xs text-muted-foreground">
              About {plan.avgKcal} kcal a day on average.
            </p>
          )}
          <div className="grid gap-2 md:grid-cols-2">
            {plan.days
              .filter((d) => d.meals.length)
              .map((d) => (
                <div key={d.date} className="rounded-xl bg-raised p-3">
                  <div className="flex justify-between">
                    <b>
                      {new Date(`${d.date}T12:00:00Z`).toLocaleDateString(undefined, {
                        weekday: "long",
                      })}
                    </b>
                    <span className="text-muted-foreground">
                      {d.totals.kcal} kcal · P{d.totals.protein_g} C{d.totals.carbs_g} F
                      {d.totals.fat_g}
                    </span>
                  </div>
                  <ul className="mt-1 text-xs text-muted-foreground">
                    {d.meals.map((m) => (
                      <li key={m.slot}>
                        <span className="capitalize">{m.slot}</span>: {m.name} × {m.servings}
                        {row?.status === "proposed" && (
                          <button
                            className="ml-2 text-primary"
                            onClick={() =>
                              act(
                                () => remove({ data: { id: row.id, date: d.date, slot: m.slot } }),
                                "Removed",
                              )
                            }
                          >
                            remove
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
          {plan.shopping.length > 0 && (
            <div>
              <h3 className="font-medium">Shopping list</h3>
              <ul className="mt-1 columns-2 text-xs text-muted-foreground">
                {plan.shopping.map((s) => (
                  <li key={s.name}>
                    {s.name}: {s.grams} g
                  </li>
                ))}
              </ul>
            </div>
          )}
          {plan.prep.length > 0 && (
            <div>
              <h3 className="font-medium">Batch prep ({plan.prepMinutes} min)</h3>
              <ul className="mt-1 text-xs text-muted-foreground">
                {plan.prep.map((p) => (
                  <li key={p.mealId}>
                    {p.name}: cook {p.portions} portions. {p.storage}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">
                Once approved, prep is added as a goal.{" "}
                <Link to="/app/plan" className="text-primary">
                  Replan
                </Link>{" "}
                to fit it into your week with reminders.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
