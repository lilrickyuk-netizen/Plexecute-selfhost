import { unitsOf, fmtWeight } from "@/lib/units";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MealPlanner } from "@/components/MealPlanner";
import { MealPrep } from "@/components/MealPrep";
import { localDayRange } from "@/lib/tz";
import { VoiceInputButton, WithVoice } from "@/components/VoiceInputButton";
import { appendTranscript } from "@/lib/voice-input";
import { rows } from "@/lib/rows";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, ScanBarcode, Search, Sparkles, Star, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { uid, useLogs, useProfile } from "@/lib/data";
import { portion, weightTrend, type ProviderFood } from "@/lib/nutrition-engine";
import { newOpId, sendOrQueue } from "@/lib/offline";
import {
  approveTargets,
  copyFoodEntries,
  logFood,
  logSavedMeal,
  lookupBarcode,
  parseFoodPhoto,
  parseFoodText,
  refreshTargets,
  searchFood,
} from "@/lib/nutrition.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MealPhotoEstimate } from "@/components/MealPhotoEstimate";
import nutritionImage from "@/assets/member-nutrition.jpg";

export const Route = createFileRoute("/_authenticated/app/nutrition")({
  head: () => ({
    meta: [
      { title: "Nutrition | Plexecute" },
      {
        name: "description",
        content: "Calorie and macro targets, food logging and adaptive energy estimates.",
      },
      { property: "og:title", content: "Nutrition | Plexecute" },
      {
        property: "og:description",
        content: "Calorie and macro targets, food logging and adaptive energy estimates.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Nutrition,
});

type Food = Omit<ProviderFood, "source" | "attribution" | "source_ref"> & {
  source_ref: string | null;
  source: "fatsecret" | "usda_fdc" | "manual" | "ai_estimate";
  attribution?: string;
};
type Slot = "breakfast" | "lunch" | "dinner" | "snack";
const SLOTS: Slot[] = ["breakfast", "lunch", "dinner", "snack"];

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Nutrition() {
  const qc = useQueryClient();
  const { data: profile } = useProfile();
  const u = unitsOf(profile);
  const { data: weights = [], isSuccess: weightsLoaded } = useLogs("weight");
  const refresh = useServerFn(refreshTargets);
  const approve = useServerFn(approveTargets);
  const logMeal = useServerFn(logSavedMeal);
  const [day, setDay] = useState(localDate());
  const [adding, setAdding] = useState<Slot | null>(null);
  const [view, setView] = useState<"log" | "plan" | "prep">("log");
  const [prepDay, setPrepDay] = useState("");
  useEffect(() => {
    setPrepDay(
      localDayRange(new Date(), profile?.timezone)[0].toLocaleDateString("en-CA", {
        timeZone: profile?.timezone ?? "UTC",
      }),
    );
  }, [profile?.timezone]);
  const { data: tgt, refetch: refetchTargets } = useQuery({
    queryKey: ["nutrition-targets", weights.length],
    queryFn: () => refresh(),
    enabled: weightsLoaded,
  });
  const { data: food = [] } = useQuery({
    queryKey: ["food", day],
    queryFn: async () =>
      rows(await supabase.from("food_entries").select("*").eq("eaten_on", day).order("created_at")),
  });
  const { data: recent = [] } = useQuery({
    queryKey: ["food-14"],
    queryFn: async () =>
      rows(
        await supabase
          .from("food_entries")
          .select("eaten_on,kcal,protein_g")
          .gte("eaten_on", localDate(new Date(Date.now() - 14 * 864e5))),
      ),
  });
  const { data: meals = [] } = useQuery({
    queryKey: ["meals"],
    queryFn: async () =>
      rows(
        await supabase.from("saved_meals").select("*").order("created_at", { ascending: false }),
      ),
  });

  const cur = tgt?.current;
  const copy = useServerFn(copyFoodEntries);
  async function copyFrom(slotKey: (typeof SLOTS)[number] | null) {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    try {
      const r = await copy({
        data: { from: d.toISOString().slice(0, 10), to: day, meal_slot: slotKey },
      });
      qc.invalidateQueries({ queryKey: ["food"] });
      toast[r.copied ? "success" : "info"](
        r.copied
          ? `Copied ${r.copied} item${r.copied > 1 ? "s" : ""}`
          : "Nothing logged yesterday to copy",
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const sum = food.reduce(
    (a, x) => ({
      kcal: a.kcal + Number(x.kcal),
      p: a.p + Number(x.protein_g),
      c: a.c + Number(x.carbs_g),
      f: a.f + Number(x.fat_g),
    }),
    { kcal: 0, p: 0, c: 0, f: 0 },
  );
  const trend = useMemo(
    () => weightTrend(weights.map((w) => ({ date: w.log_date, kg: Number(w.value) }))),
    [weights],
  );
  const adherence = useMemo(() => {
    if (!cur) return null;
    const byDay = new Map<string, { k: number; p: number }>();
    for (const r of recent) {
      const v = byDay.get(r.eaten_on) ?? { k: 0, p: 0 };
      byDay.set(r.eaten_on, { k: v.k + Number(r.kcal), p: v.p + Number(r.protein_g) });
    }
    const days = [...byDay.values()];
    return {
      logged: days.length,
      onTarget: days.filter((d) => Math.abs(d.k - cur.kcal) <= cur.kcal * 0.1).length,
      protein: days.filter((d) => d.p >= cur.protein_g * 0.9).length,
    };
  }, [recent, cur]);

  async function remove(id: string) {
    await supabase.from("food_entries").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["food"] });
  }
  async function saveSlotAsMeal(s: Slot) {
    const items = food
      .filter((f) => f.meal_slot === s && f.food_id && f.grams)
      .map((f) => ({ food_id: f.food_id!, grams: Number(f.grams) }));
    if (!items.length) {
      toast.error("Log foods from search, barcode or recent first");
      return;
    }
    const name = window.prompt("Name this meal", `My ${s}`)?.trim();
    if (!name) return;
    const kind = window.confirm("Save as a recipe with servings? (Cancel = single meal)")
      ? "recipe"
      : "meal";
    const servings =
      kind === "recipe"
        ? Math.max(1, Number(window.prompt("How many servings does this make?", "2")) || 1)
        : 1;
    const { error } = await supabase
      .from("saved_meals")
      .insert({ user_id: await uid(), name: name.slice(0, 80), kind, servings, items });
    if (error) toast.error(error.message);
    else {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["meals"] });
    }
  }

  const bars = cur
    ? [
        { l: "Calories", v: sum.kcal, t: cur.kcal, u: "kcal" },
        { l: "Protein", v: sum.p, t: cur.protein_g, u: "g" },
        { l: "Carbs", v: sum.c, t: cur.carbs_g, u: "g" },
        { l: "Fat", v: sum.f, t: cur.fat_g, u: "g" },
      ]
    : [];

  return (
    <div className="member-nutrition-page">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <h1 className="text-3xl font-semibold">Nutrition</h1>
        <Input
          aria-label="Day to show"
          type="date"
          value={day}
          max={localDate()}
          onChange={(e) => setDay(e.target.value)}
          className="w-40"
        />
      </div>
      <div className="member-nutrition-cover" aria-hidden="true">
        <img src={nutritionImage} width={1024} height={1024} alt="" />
      </div>

      <div className="member-segments" role="tablist" aria-label="Nutrition sections">
        <button
          type="button"
          role="tab"
          aria-selected={view === "log"}
          onClick={() => setView("log")}
        >
          Food log
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "plan"}
          onClick={() => setView("plan")}
        >
          Meal planning
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "prep"}
          onClick={() => setView("prep")}
        >
          Meal prep
        </button>
      </div>

      {view === "plan" &&
        (prepDay ? (
          <div className="mt-6">
            <MealPlanner />
          </div>
        ) : (
          <p aria-busy="true">Loading…</p>
        ))}
      {view === "prep" &&
        (prepDay ? (
          <div className="mt-6">
            <MealPrep day={prepDay} />
          </div>
        ) : (
          <p aria-busy="true">Loading…</p>
        ))}

      {view === "log" && (
        <>
          <section
            className="mt-6 rounded-[20px] border border-border bg-card p-5"
            data-testid="calorie-counter"
          >
            <h2 className="text-lg font-semibold">Calorie counter</h2>
            <p className="mb-3 mt-1 text-sm text-muted-foreground">
              Take or upload a photo of your meal and get its calorie count. Check the estimate,
              then log it.
            </p>
            <MealPhotoEstimate
              day={day}
              onLogged={() => {
                qc.invalidateQueries({ queryKey: ["food"] });
                qc.invalidateQueries({ queryKey: ["food-14"] });
              }}
            />
          </section>
          {tgt?.targets.status === "blocked" && (
            <p className="mt-6 rounded-[14px] border border-warning bg-card p-4 text-sm">
              {tgt.targets.notes[0]}
            </p>
          )}
          {tgt?.targets.status === "missing" && (
            <p className="mt-6 rounded-[14px] border border-border bg-card p-4 text-sm text-muted-foreground">
              {tgt.targets.notes[0]}{" "}
              <Link to="/app/settings" className="text-primary">
                Settings
              </Link>{" "}
              ·{" "}
              <Link to="/app/progress" className="text-primary">
                Log weight
              </Link>
            </p>
          )}
          {tgt?.pending && (
            <section className="mt-6 border-l-2 border-execute bg-card p-5">
              <p className="text-xs uppercase tracking-widest text-execute">
                Target change needs your approval
              </p>
              <p className="mt-2 text-sm">
                Your logs suggest {tgt.pending.kcal} kcal a day (currently {cur?.kcal}). That's more
                than the 150 kcal automatic limit.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{tgt.pending.explanation}</p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  onClick={async () => {
                    await approve({ data: { id: tgt.pending!.id, approve: true } });
                    refetchTargets();
                  }}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await approve({ data: { id: tgt.pending!.id, approve: false } });
                    refetchTargets();
                  }}
                >
                  Keep current
                </Button>
              </div>
            </section>
          )}
          {cur && (
            <div className="member-nutrition-targets mt-6 rounded-lg border border-border bg-card p-5">
              <div className="member-calorie-summary">
                <div className="member-calorie-ring">
                  <svg viewBox="0 0 120 120" aria-hidden="true">
                    <circle cx="60" cy="60" r="51" className="member-ring-track" />
                    <circle
                      cx="60"
                      cy="60"
                      r="51"
                      className="member-ring-value"
                      pathLength="100"
                      strokeDasharray={`${Math.min(100, (sum.kcal / Math.max(1, cur.kcal)) * 100)} 100`}
                    />
                  </svg>
                  <div>
                    <strong>{Math.round(sum.kcal).toLocaleString()}</strong>
                    <span>kcal</span>
                  </div>
                </div>
                <dl>
                  <div>
                    <dt>Target</dt>
                    <dd>{cur.kcal.toLocaleString()} kcal</dd>
                  </div>
                  <div>
                    <dt>{sum.kcal > cur.kcal ? "Over target" : "Remaining"}</dt>
                    <dd>{Math.round(Math.abs(cur.kcal - sum.kcal)).toLocaleString()} kcal</dd>
                  </div>
                </dl>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {cur.method === "adaptive" ? "Adaptive estimate" : "Starting estimate"} ·
                  maintenance {cur.tdee} kcal · confidence {cur.confidence}
                </p>
                {tgt?.targets.weekly_change_pct ? (
                  <p className="text-xs text-muted-foreground">
                    Expected {tgt.targets.weekly_change_pct > 0 ? "+" : ""}
                    {tgt.targets.weekly_change_pct}% bodyweight a week
                  </p>
                ) : null}
              </div>
              <div className="member-macro-bars mt-4 space-y-3">
                {bars
                  .filter((b) => b.l !== "Calories")
                  .map((b) => (
                    <div
                      key={b.l}
                      className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-3 text-sm"
                    >
                      <span className="w-20 text-muted-foreground">{b.l}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
                        <div
                          className={`h-full ${b.v > b.t * 1.05 ? "bg-warning" : "bg-execute"}`}
                          style={{ width: `${Math.min(100, (b.v / Math.max(1, b.t)) * 100)}%` }}
                        />
                      </div>
                      <span className="text-right text-xs tabular-nums text-muted-foreground">
                        {Math.round(b.v)} / {b.t} {b.u}
                      </span>
                    </div>
                  ))}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">{cur.explanation}</p>
              {tgt?.history && tgt.history.length > 1 && (
                <details className="mt-3 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Target history</summary>
                  <ul className="mt-2 space-y-1">
                    {tgt.history.map((h) => (
                      <li key={h.id}>
                        {new Date(h.created_at).toLocaleDateString()} · {h.kcal} kcal · maintenance{" "}
                        {h.tdee} · {h.method === "adaptive" ? "adaptive" : "starting"} · {h.status}{" "}
                        · {h.version}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {tgt && !tgt.adaptive.eligible && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Adaptive estimate unlocks after: {tgt.adaptive.reasons.join(", ")}.
                </p>
              )}
            </div>
          )}

          <div className="mt-8 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => copyFrom(null)}>
              Copy all of yesterday
            </Button>
          </div>
          <div className="member-meal-slots mt-2 space-y-3">
            {SLOTS.map((s) => {
              const items = food.filter((f) => f.meal_slot === s);
              return (
                <section key={s} className="member-meal-slot">
                  <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <h2 className="font-semibold capitalize">{s}</h2>
                    <Button size="sm" variant="outline" onClick={() => setAdding(s)}>
                      Add food
                    </Button>
                  </div>
                  <div className="member-meal-secondary">
                    {items.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => saveSlotAsMeal(s)}>
                        Save as meal
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => copyFrom(s)}>
                      Copy yesterday
                    </Button>
                  </div>
                  {items.map((x) => (
                    <div
                      key={x.id}
                      className="mb-1.5 flex items-center justify-between gap-2 rounded-[14px] border border-border bg-card px-4 py-3 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        {x.name}
                        {x.grams ? (
                          <span className="text-muted-foreground"> · {Number(x.grams)} g</span>
                        ) : null}
                        {x.estimated && (
                          <span className="ml-2 text-xs text-warning">estimated</span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-3 tabular-nums text-muted-foreground">
                        {Math.round(Number(x.kcal))} kcal · P{Math.round(Number(x.protein_g))}
                        <button onClick={() => remove(x.id)} aria-label="Remove">
                          <Trash2 className="h-3.5 w-3.5 hover:text-destructive" />
                        </button>
                      </span>
                    </div>
                  ))}
                </section>
              );
            })}
          </div>

          {meals.length > 0 && (
            <section className="mt-8">
              <h2 className="font-semibold">Your meals and recipes</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {meals.map((m) => (
                  <Button
                    key={m.id}
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const servings =
                        m.kind === "recipe"
                          ? Number(
                              window.prompt(`How many of ${m.servings} servings did you eat?`, "1"),
                            )
                          : 1;
                      if (!servings) return;
                      try {
                        await logMeal({
                          data: {
                            mealId: m.id,
                            servings: m.kind === "recipe" ? servings : Number(m.servings),
                            meal_slot: "dinner",
                            date: day,
                          },
                        });
                        qc.invalidateQueries({ queryKey: ["food"] });
                        toast.success(`Logged ${m.name} to dinner`);
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                  >
                    {m.name}
                    {m.kind === "recipe" ? ` (${Number(m.servings)} servings)` : ""}
                  </Button>
                ))}
              </div>
            </section>
          )}

          <section className="mt-10 grid gap-6 md:grid-cols-2">
            <div>
              <h2 className="font-semibold">Weight trend</h2>
              {trend.length >= 2 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Trend {fmtWeight(trend.at(-1)!.trend, u)} (latest {fmtWeight(trend.at(-1)!.kg, u)}
                  )
                  {tgt?.adaptive.trend_kg_per_week != null
                    ? ` · ${tgt.adaptive.trend_kg_per_week > 0 ? "+" : ""}${tgt.adaptive.trend_kg_per_week} kg a week over 21 days`
                    : ""}
                  . The trend smooths daily water swings.
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Log your weight most mornings to see a trend.
                </p>
              )}
            </div>
            <div>
              <h2 className="font-semibold">Adherence, last 14 days</h2>
              {adherence ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Logged {adherence.logged} of 14 days · within 10% of calories on{" "}
                  {adherence.onTarget} · protein met on {adherence.protein}. Unlogged days count as
                  unknown, not as misses.
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">Appears once you have targets.</p>
              )}
            </div>
          </section>
        </>
      )}
      <p className="mt-8 text-xs text-muted-foreground">
        Wellness guidance, not clinical dietetics. Food data: fatsecret where connected, otherwise
        USDA FoodData Central. If you have an allergy, always check the actual packet label.
      </p>

      <AddFood
        slot={adding}
        day={day}
        allergies={profile?.allergies ?? []}
        tier={profile?.tier ?? "free"}
        onClose={() => setAdding(null)}
        onLogged={() => {
          qc.invalidateQueries({ queryKey: ["food"] });
          qc.invalidateQueries({ queryKey: ["food-14"] });
        }}
      />
    </div>
  );
}

function AddFood({
  slot,
  day,
  allergies,
  tier,
  onClose,
  onLogged,
}: {
  slot: Slot | null;
  day: string;
  allergies: string[];
  tier: string;
  onClose: () => void;
  onLogged: () => void;
}) {
  const search = useServerFn(searchFood);
  const barcode = useServerFn(lookupBarcode);
  const log = useServerFn(logFood);
  const parseText = useServerFn(parseFoodText);
  const parsePhoto = useServerFn(parseFoodPhoto);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Food[]>([]);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<{
    food: Food;
    grams: number;
    method: "search" | "barcode" | "recent" | "manual" | "text" | "photo";
  } | null>(null);
  const [drafts, setDrafts] = useState<
    { query: string; grams: number; options: Food[]; choice: number; method: "text" | "photo" }[]
  >([]);
  const [code, setCode] = useState("");
  const [text, setText] = useState("");
  const [manual, setManual] = useState({ name: "", kcal: "", p: "", c: "", f: "", g: "100" });
  const { data: recents = [], refetch } = useQuery({
    queryKey: ["user-foods"],
    enabled: !!slot,
    queryFn: async () =>
      rows(
        await supabase
          .from("user_foods")
          .select("*")
          .order("favourite", { ascending: false })
          .order("last_used_at", { ascending: false })
          .limit(30),
      ),
  });
  const paid = tier !== "free";
  useEffect(() => {
    if (!slot) {
      setPicked(null);
      setDrafts([]);
      setResults([]);
    }
  }, [slot]);

  const allergyHit = (f: Food) =>
    f.allergens.filter((a) => allergies.some((x) => a.includes(x) || x.includes(a)));
  async function doSearch() {
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      const r = await search({ data: { q } });
      if ("error" in r && r.error) toast.error(r.error);
      setResults(r.foods);
    } finally {
      setBusy(false);
    }
  }
  async function doBarcode(c: string) {
    setBusy(true);
    try {
      const r = await barcode({ data: { code: c } });
      if (r.food) setPicked({ food: r.food, grams: r.food.serving_g ?? 100, method: "barcode" });
      else toast.error("No match for that barcode. Try search or manual entry.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm(food: Food, grams: number, method: NonNullable<typeof picked>["method"]) {
    if (!slot) return;
    const { attribution: _a, ...clean } = food as Food & { id?: string; user_id?: string };
    const f = {
      source: clean.source,
      source_ref: clean.source_ref,
      name: clean.name,
      brand: clean.brand,
      barcode: clean.barcode,
      kcal_100g: Number(clean.kcal_100g),
      protein_100g: Number(clean.protein_100g),
      carbs_100g: Number(clean.carbs_100g),
      fat_100g: Number(clean.fat_100g),
      fibre_100g: clean.fibre_100g == null ? null : Number(clean.fibre_100g),
      serving_g: clean.serving_g == null ? null : Number(clean.serving_g),
      serving_label: clean.serving_label,
      allergens: clean.allergens ?? [],
    };
    const payload = { food: f, grams, meal_slot: slot, date: day, method };
    const id = newOpId();
    // §56: manual/confirmed food logs queue offline; AI extraction itself still needs a connection.
    const r = await sendOrQueue("food", payload, id, () =>
      log({ data: { ...payload, clientOpId: id, clientRecordedAt: new Date().toISOString() } }),
    );
    if (r.queued)
      toast.message("You're offline. Saved on this device and will sync when you reconnect.");
  }
  async function confirmOne() {
    if (!picked) return;
    try {
      await confirm(picked.food, picked.grams, picked.method);
      toast.success("Logged");
      onLogged();
      refetch();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function confirmDrafts() {
    try {
      for (const d of drafts) {
        const o = d.options[d.choice];
        if (o && d.grams > 0) await confirm(o, d.grams, d.method);
      }
      toast.success("Logged and confirmed");
      onLogged();
      refetch();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const setFromAi = (
    r: { drafts: { query: string; grams_estimate: number; options: Food[] }[] },
    method: "text" | "photo",
  ) => {
    if (!r.drafts.length) {
      toast.error("No foods recognised. Try search instead.");
      return;
    }
    setDrafts(
      r.drafts.map((d) => ({
        query: d.query,
        grams: d.grams_estimate,
        options: d.options,
        choice: 0,
        method,
      })),
    );
  };

  return (
    <Dialog open={!!slot} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="capitalize">Add to {slot}</DialogTitle>
        </DialogHeader>
        {picked ? (
          <div className="space-y-3">
            <p className="font-medium">
              {picked.food.name}
              {picked.food.brand ? ` · ${picked.food.brand}` : ""}
            </p>
            {allergyHit(picked.food).length > 0 && (
              <p className="text-sm text-destructive">
                Listed allergen matching your profile: {allergyHit(picked.food).join(", ")}.
              </p>
            )}
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                value={picked.grams}
                onChange={(e) => setPicked({ ...picked, grams: Number(e.target.value) })}
                className="w-28"
              />{" "}
              g
              {picked.food.serving_g ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPicked({ ...picked, grams: Number(picked.food.serving_g) })}
                >
                  1 serving{picked.food.serving_label ? ` (${picked.food.serving_label})` : ""}
                </Button>
              ) : null}
            </div>
            {(() => {
              const n = portion(
                {
                  ...picked.food,
                  kcal_100g: Number(picked.food.kcal_100g),
                  protein_100g: Number(picked.food.protein_100g),
                  carbs_100g: Number(picked.food.carbs_100g),
                  fat_100g: Number(picked.food.fat_100g),
                },
                picked.grams || 0,
              );
              return (
                <p className="text-sm text-muted-foreground tabular-nums">
                  {n.kcal} kcal · P {n.protein_g} g · C {n.carbs_g} g · F {n.fat_g} g
                </p>
              );
            })()}
            <p className="text-xs text-muted-foreground">
              Source: {picked.food.attribution ?? picked.food.source}.{" "}
              {picked.food.source === "manual" ? "Your own entry." : ""}
            </p>
            <div className="flex gap-2">
              <Button onClick={confirmOne} disabled={!picked.grams}>
                Log
              </Button>
              <Button variant="ghost" onClick={() => setPicked(null)}>
                Back
              </Button>
            </div>
          </div>
        ) : drafts.length ? (
          <div className="space-y-3">
            <p className="text-xs text-warning">
              Estimated. Check each food and amount, then confirm. Nothing is saved until you do.
            </p>
            {drafts.map((d, i) => (
              <div key={i} className="rounded-[10px] border border-border p-3 text-sm">
                <p className="text-muted-foreground">"{d.query}"</p>
                {d.options.length ? (
                  <select
                    className="mt-2 w-full rounded-[8px] border border-border bg-raised p-2"
                    value={d.choice}
                    onChange={(e) =>
                      setDrafts(
                        drafts.map((x, j) =>
                          j === i ? { ...x, choice: Number(e.target.value) } : x,
                        ),
                      )
                    }
                  >
                    {d.options.map((o, k) => (
                      <option key={k} value={k}>
                        {o.name}
                        {o.brand ? ` · ${o.brand}` : ""} ({Math.round(o.kcal_100g)} kcal/100 g)
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="mt-1 text-warning">
                    No database match. Remove or use manual entry.
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    value={d.grams}
                    onChange={(e) =>
                      setDrafts(
                        drafts.map((x, j) =>
                          j === i ? { ...x, grams: Number(e.target.value) } : x,
                        ),
                      )
                    }
                    className="w-24"
                  />{" "}
                  g{" "}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <Button onClick={confirmDrafts}>Confirm and log</Button>
              <Button variant="ghost" onClick={() => setDrafts([])}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Tabs defaultValue="search">
            <TabsList className="flex w-full flex-wrap">
              <TabsTrigger value="search" aria-label="Search">
                <Search className="h-3.5 w-3.5" />
              </TabsTrigger>
              <TabsTrigger value="recent">Recent</TabsTrigger>
              <TabsTrigger value="barcode" aria-label="Barcode">
                <ScanBarcode className="h-3.5 w-3.5" />
              </TabsTrigger>
              <TabsTrigger value="text" aria-label="Describe">
                <Sparkles className="h-3.5 w-3.5" />
              </TabsTrigger>
              <TabsTrigger value="photo" aria-label="Photo">
                <Camera className="h-3.5 w-3.5" />
              </TabsTrigger>
              <TabsTrigger value="manual">Manual</TabsTrigger>
            </TabsList>
            <TabsContent value="search" className="space-y-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  doSearch();
                }}
                className="flex gap-2"
              >
                <Input
                  autoFocus
                  placeholder="Search foods"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <Button disabled={busy}>Search</Button>
              </form>
              {results.map((f) => (
                <button
                  key={`${f.source}${f.source_ref}`}
                  onClick={() =>
                    setPicked({ food: f, grams: f.serving_g ?? 100, method: "search" })
                  }
                  className="w-full rounded-[10px] border border-border bg-raised p-3 text-left text-sm"
                >
                  {f.name}
                  {f.brand ? <span className="text-muted-foreground"> · {f.brand}</span> : null}
                  <span className="block text-xs text-muted-foreground">
                    {Math.round(f.kcal_100g)} kcal · P {f.protein_100g} g per 100 g
                    {allergyHit(f).length ? (
                      <span className="text-destructive">
                        {" "}
                        · contains {allergyHit(f).join(", ")}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
              {results[0]?.attribution && (
                <p className="text-xs text-muted-foreground">{results[0].attribution}</p>
              )}
            </TabsContent>
            <TabsContent value="recent" className="space-y-2">
              {recents.length ? (
                recents.map((f) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        setPicked({
                          food: {
                            ...f,
                            source: f.source as Food["source"],
                            kcal_100g: Number(f.kcal_100g),
                            protein_100g: Number(f.protein_100g),
                            carbs_100g: Number(f.carbs_100g),
                            fat_100g: Number(f.fat_100g),
                            fibre_100g: f.fibre_100g == null ? null : Number(f.fibre_100g),
                            serving_g: f.serving_g == null ? null : Number(f.serving_g),
                          },
                          grams: Number(f.serving_g ?? 100),
                          method: "recent",
                        })
                      }
                      className="flex-1 rounded-[10px] border border-border bg-raised p-3 text-left text-sm"
                    >
                      {f.name}
                      <span className="block text-xs text-muted-foreground">
                        {Math.round(Number(f.kcal_100g))} kcal per 100 g
                      </span>
                    </button>
                    <button
                      aria-label="Favourite"
                      onClick={async () => {
                        await supabase
                          .from("user_foods")
                          .update({ favourite: !f.favourite })
                          .eq("id", f.id);
                        refetch();
                      }}
                    >
                      <Star
                        className={`h-4 w-4 ${f.favourite ? "fill-execute text-execute" : "text-muted-foreground"}`}
                      />
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Foods you log appear here.</p>
              )}
            </TabsContent>
            <TabsContent value="barcode" className="space-y-3">
              <BarcodeScanner
                onCode={(c) => {
                  setCode(c);
                  doBarcode(c);
                }}
              />
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (/^\d{6,14}$/.test(code)) doBarcode(code);
                }}
                className="flex gap-2"
              >
                <Input
                  inputMode="numeric"
                  placeholder="Or type the barcode number"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
                <Button disabled={busy}>Look up</Button>
              </form>
            </TabsContent>
            <TabsContent value="text" className="space-y-2">
              <>
                {!paid && (
                  <p className="text-xs text-muted-foreground">
                    Free includes one AI food log a day. Pro and Execute have no daily limit.
                  </p>
                )}
                <WithVoice value={text} onChange={(v) => setText(v.slice(0, 500))}>
                  <Textarea
                    placeholder="e.g. two scrambled eggs on wholemeal toast and a latte"
                    maxLength={500}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                </WithVoice>
                <Button
                  disabled={busy || text.trim().length < 2}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      setFromAi(await parseText({ data: { text } }), "text");
                    } catch (e) {
                      toast.error((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Reading…" : "Find foods"}
                </Button>
              </>
            </TabsContent>
            <TabsContent value="photo" className="space-y-2">
              {!paid && (
                <p className="text-xs text-muted-foreground">
                  Free includes one AI food log a day. Pro and Execute have no daily limit.
                </p>
              )}
              <MealPhotoEstimate day={day} slot={slot} onLogged={onLogged} />
            </TabsContent>
            <TabsContent value="manual" className="space-y-2">
              <Input
                placeholder="Food name"
                value={manual.name}
                onChange={(e) => setManual({ ...manual, name: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Per 100 g:</p>
              <div className="grid grid-cols-4 gap-2">
                {(["kcal", "p", "c", "f"] as const).map((k) => (
                  <Input
                    key={k}
                    type="number"
                    placeholder={{ kcal: "kcal", p: "Protein", c: "Carbs", f: "Fat" }[k]}
                    value={manual[k]}
                    onChange={(e) => setManual({ ...manual, [k]: e.target.value })}
                  />
                ))}
              </div>
              <Button
                disabled={!manual.name.trim() || !manual.kcal}
                onClick={() =>
                  setPicked({
                    method: "manual",
                    grams: 100,
                    food: {
                      source: "manual",
                      source_ref: null,
                      name: manual.name.trim(),
                      brand: null,
                      barcode: null,
                      kcal_100g: Number(manual.kcal),
                      protein_100g: Number(manual.p || 0),
                      carbs_100g: Number(manual.c || 0),
                      fat_100g: Number(manual.f || 0),
                      fibre_100g: null,
                      serving_g: null,
                      serving_label: null,
                      allergens: [],
                    },
                  })
                }
              >
                Next
              </Button>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

async function parseFoodPhoto_(
  fn: (a: {
    data: { image: string };
  }) => Promise<{ drafts: { query: string; grams_estimate: number; options: Food[] }[] }>,
  image: string,
) {
  return fn({ data: { image } });
}

function Upsell() {
  return (
    <p className="rounded-[10px] border border-border p-4 text-sm text-muted-foreground">
      Text and photo logging are part of Pro and Execute.{" "}
      <Link to="/pricing" className="text-primary">
        See plans
      </Link>
    </p>
  );
}

async function downscale(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
function BarcodeScanner({ onCode }: { onCode: (c: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const supported = typeof window !== "undefined" && "BarcodeDetector" in window;
  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const det = new (
          window as unknown as { BarcodeDetector: new (o: object) => Detector }
        ).BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
        while (!stop) {
          const r = await det.detect(video.current).catch(() => []);
          if (r[0]?.rawValue) {
            onCode(r[0].rawValue);
            setOn(false);
            break;
          }
          await new Promise((x) => setTimeout(x, 300));
        }
      } catch {
        toast.error("Camera unavailable. Type the number instead.");
        setOn(false);
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [on, onCode]);
  if (!supported)
    return (
      <p className="text-xs text-muted-foreground">
        Camera scanning isn't supported in this browser. Type the barcode number below.
      </p>
    );
  return on ? (
    <video ref={video} className="w-full rounded-[10px]" muted playsInline />
  ) : (
    <Button variant="outline" onClick={() => setOn(true)}>
      <ScanBarcode className="h-4 w-4" /> Scan with camera
    </Button>
  );
}
