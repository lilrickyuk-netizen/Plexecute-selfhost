import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Camera, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { downscaleImage } from "@/components/MealPhotoEstimate";
import { newOpId } from "@/lib/offline";
import { estimateMealPhoto } from "@/lib/meal-photo.functions";
import { getMealRecipe } from "@/lib/meal-prep.functions";
import {
  acceptMealPrep,
  addInventoryPhoto,
  addInventoryText,
  buildMealPrep,
  clearInventory,
  confirmInventory,
  editMealPrep,
  getMealPrep,
  logPlannedMeal,
  skipPlannedMeal,
  updateInventory,
} from "@/lib/meal-prep.functions";
import type { Day, Meal, Slot } from "@/lib/meal-prep";

const SLOT_LABEL: Record<Slot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function useAct() {
  const qc = useQueryClient();
  return async function act<T>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
    try {
      const r = await fn();
      await qc.invalidateQueries({ queryKey: ["meal-prep"] });
      qc.invalidateQueries({ queryKey: ["food"] });
      if (ok) toast.success(ok);
      return r;
    } catch (e) {
      toast.error((e as Error).message);
      return undefined;
    }
  };
}

export function MealPrep({ day }: { day: string }) {
  const get = useServerFn(getMealPrep);
  const { data } = useQuery({
    queryKey: ["meal-prep", day],
    queryFn: () => get({ data: { date: day } }),
  });
  if (!data) return null;
  return (
    <div className="mt-8 space-y-6">
      <TodayStatus status={data.status} />
      <Inventory inv={data.inventory} />
      <PlanView plan={data.plan} inventoryCount={data.inventory.items.length} />
    </div>
  );
}

type Data = Awaited<ReturnType<typeof getMealPrep>>;

function Bar({
  label,
  now,
  target,
  unit,
}: {
  label: string;
  now: number;
  target?: number | undefined;
  unit: string;
}) {
  const pct = target ? Math.min(100, Math.round((now / target) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="tabular-nums">
          {now}
          {target ? ` / ${target}` : ""} {unit}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-muted">
        <div className="h-1.5 rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TodayStatus({ status }: { status: Data["status"] }) {
  const act = useAct();
  const log = useServerFn(logPlannedMeal);
  const skip = useServerFn(skipPlannedMeal);
  const photo = useServerFn(estimateMealPhoto);
  const file = useRef<HTMLInputElement>(null);
  const [photoFor, setPhotoFor] = useState<Slot | null>(null);
  const [est, setEst] = useState<{ slot: Slot; id: string; kcal: string } | null>(null);
  const t = status.target,
    c = status.consumed,
    r = status.remaining;
  const meals = status.plannedDay?.meals ?? [];
  return (
    <section
      className="rounded-[20px] border border-border bg-card p-5"
      aria-label="Today's calories"
    >
      <h2 className="font-semibold">Today so far</h2>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-2xl font-semibold tabular-nums">{c.kcal}</p>
          <p className="text-xs text-muted-foreground">eaten kcal</p>
        </div>
        <div>
          <p className="text-2xl font-semibold tabular-nums">{t ? t.kcal : "–"}</p>
          <p className="text-xs text-muted-foreground">target</p>
        </div>
        <div>
          <p className="text-2xl font-semibold tabular-nums" data-testid="kcal-remaining">
            {r ? r.kcal : "–"}
          </p>
          <p className="text-xs text-muted-foreground">remaining</p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <Bar label="Protein" now={c.protein_g} target={t?.protein_g} unit="g" />
        <Bar label="Carbs" now={c.carbs_g} target={t?.carbs_g} unit="g" />
        <Bar label="Fat" now={c.fat_g} target={t?.fat_g} unit="g" />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Eaten totals come only from your food log. Planned meals don't count until you log them.
      </p>
      {meals.length > 0 && status.planId && (
        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-medium">From your meal plan</h3>
          {meals.map((m) => (
            <div key={m.slot} className="rounded-[14px] border border-border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="text-muted-foreground">{SLOT_LABEL[m.slot]} · </span>
                  {m.name}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {m.state === "eaten"
                    ? `Eaten · ${m.actual?.kcal ?? m.kcal} kcal`
                    : m.state === "skipped"
                      ? "Skipped"
                      : `Planned · ${m.kcal} kcal`}
                </span>
              </div>
              {m.state !== "eaten" && m.state !== "skipped" && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      act(
                        () =>
                          log({ data: { id: status.planId!, date: status.date, slot: m.slot } }),
                        `${m.name} logged`,
                      )
                    }
                  >
                    <Check className="mr-1 h-3.5 w-3.5" /> Log as eaten
                  </Button>
                  <select
                    aria-label="Ate a different amount"
                    className="rounded-md border border-input bg-background px-2 text-xs"
                    value=""
                    onChange={(e) =>
                      e.target.value &&
                      act(
                        () =>
                          log({
                            data: {
                              id: status.planId!,
                              date: status.date,
                              slot: m.slot,
                              factor: Number(e.target.value),
                            },
                          }),
                        "Logged",
                      )
                    }
                  >
                    <option value="">Different amount…</option>
                    <option value="0.5">Half</option>
                    <option value="0.75">Three quarters</option>
                    <option value="1.25">A bit more</option>
                    <option value="1.5">One and a half</option>
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPhotoFor(m.slot);
                      file.current?.click();
                    }}
                  >
                    <Camera className="mr-1 h-3.5 w-3.5" /> Photo of what I ate
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      act(
                        () =>
                          skip({ data: { id: status.planId!, date: status.date, slot: m.slot } }),
                        "Skipped",
                      )
                    }
                  >
                    Skip
                  </Button>
                </div>
              )}
              {est && est.slot === m.slot && m.state !== "eaten" && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-xs">
                  <span>
                    Photo estimate: about {est.kcal} kcal (planned {m.kcal})
                  </span>
                  <Button
                    size="sm"
                    onClick={async () => {
                      await act(
                        () =>
                          log({
                            data: {
                              id: status.planId!,
                              date: status.date,
                              slot: m.slot,
                              photoEstimateId: est.id,
                            },
                          }),
                        "Logged the photo estimate",
                      );
                      setEst(null);
                    }}
                  >
                    Log this instead
                  </Button>
                </div>
              )}
            </div>
          ))}
          <input
            ref={file}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            aria-label="Meal photo"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f || !photoFor) return;
              const v = await act(async () =>
                photo({ data: { image: await downscaleImage(f), note: null } }),
              );
              if (v && v.estimate.status === "ok")
                setEst({ slot: photoFor, id: v.id, kcal: String(v.totals.kcal.best) });
              else if (v)
                toast.error("The photo couldn't be estimated. Log it as planned or by search.");
            }}
          />
        </div>
      )}
    </section>
  );
}

function Inventory({ inv }: { inv: Data["inventory"] }) {
  const act = useAct();
  const addText = useServerFn(addInventoryText);
  const addPhoto = useServerFn(addInventoryPhoto);
  const upd = useServerFn(updateInventory);
  const confirm = useServerFn(confirmInventory);
  const clear = useServerFn(clearInventory);
  const [text, setText] = useState("");
  const [voice, setVoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const [opKey, setOpKey] = useState(() => newOpId());
  async function submit() {
    if (text.trim().length < 2) return;
    setBusy(true);
    const r = await act(() =>
      addText({ data: { text, source: voice ? "voice" : "text", importKey: opKey } }),
    );
    setBusy(false);
    if (r) {
      setText("");
      setVoice(false);
      setOpKey(newOpId());
      toast.success(`Added: ${r.parsed.join(", ")}`);
    }
  }
  return (
    <section className="rounded-[20px] border border-border bg-card p-5" aria-label="Food you have">
      <h2 className="font-semibold">Food you have</h2>
      <p className="text-sm text-muted-foreground">
        Type, say or photograph what's in your fridge, cupboard or shopping. Plexecute plans your
        week around it.
      </p>
      <div className="mt-3 flex gap-2">
        <Textarea
          aria-label="Foods you have"
          rows={2}
          value={text}
          placeholder="e.g. 6 chicken breasts, 1 kg rice, 12 eggs, potatoes, peppers"
          onChange={(e) => setText(e.target.value)}
        />
        <VoiceInputButton
          onTranscript={(t) => {
            setText((p) => (p ? `${p} ${t}` : t));
            setVoice(true);
          }}
          label="Say what food you have"
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || text.trim().length < 2} onClick={submit}>
          Add foods
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => file.current?.click()}>
          <Camera className="mr-1 h-3.5 w-3.5" /> Photo of my food
        </Button>
        {inv.items.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => act(() => clear(), "List cleared")}>
            Clear list
          </Button>
        )}
        <input
          ref={file}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          aria-label="Grocery photo"
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])].slice(0, 4);
            e.target.value = "";
            setBusy(true);
            for (const f of files) {
              const r = await act(async () =>
                addPhoto({ data: { image: await downscaleImage(f), importKey: newOpId() } }),
              );
              if (r) toast.success(`Spotted: ${r.seen.join(", ")}${r.note ? `. ${r.note}` : ""}`);
            }
            setBusy(false);
          }}
        />
      </div>
      {inv.items.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {inv.items.map((i) => (
            <li key={i.id} className="flex items-center gap-2 text-sm" data-testid="inventory-item">
              <span className="min-w-0 flex-1 truncate">
                {i.name}
                {!i.food_key && <span className="ml-1 text-xs text-warning">not recognised</span>}
              </span>
              <Input
                aria-label={`${i.name} grams`}
                className="h-8 w-24"
                type="number"
                placeholder="grams"
                defaultValue={i.grams ?? ""}
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v !== i.grams) void act(() => upd({ data: { id: i.id, grams: v } }));
                }}
              />
              <span className="w-24 text-xs text-muted-foreground">
                {i.quantity_status === "unknown"
                  ? "how much?"
                  : i.quantity_status === "as_needed"
                    ? "use as needed"
                    : i.quantity_status === "estimated"
                      ? `about${i.count ? ` (${i.count} ${i.unit})` : ""}`
                      : "confirmed"}
              </span>
              <button
                aria-label={`Remove ${i.name}`}
                onClick={() => act(() => upd({ data: { id: i.id, remove: true } }))}
              >
                <Trash2 className="h-3.5 w-3.5 hover:text-destructive" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {inv.items.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {inv.confirmed ? (
            <span className="text-sm text-muted-foreground">List confirmed.</span>
          ) : inv.needsQuantity.length ? (
            <>
              <span className="text-sm">
                Add amounts for {inv.needsQuantity.map((n) => n.name.toLowerCase()).join(", ")}, or
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  act(() => confirm({ data: { unknown: "as_needed" } }), "List confirmed")
                }
              >
                Use as needed and confirm
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => act(() => confirm({ data: { unknown: "block" } }), "List confirmed")}
            >
              Confirm list
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function PlanView({ plan, inventoryCount }: { plan: Data["plan"]; inventoryCount: number }) {
  const act = useAct();
  const build = useServerFn(buildMealPrep);
  const edit = useServerFn(editMealPrep);
  const accept = useServerFn(acceptMealPrep);
  const [days, setDays] = useState(7);
  const [start, setStart] = useState("");
  const [only, setOnly] = useState(false);
  const [prepDay, setPrepDay] = useState(0);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  async function make() {
    setBusy(true);
    const r = await act(() =>
      build({
        data: {
          start: start || null,
          days,
          onlyExisting: only,
          allowStaples: true,
          kcal: null,
          protein_g: null,
          prepWeekday: prepDay,
          secondPrep: null,
        },
      }),
    );
    setBusy(false);
    if (r && "message" in r) toast.info(r.message);
    else if (r) toast.success("Meal plan ready to review");
  }
  const p = plan?.plan;
  const d: Day | undefined = p?.days[Math.min(sel, (p?.days.length ?? 1) - 1)];
  return (
    <section
      className="rounded-[20px] border border-border bg-card p-5"
      aria-label="Meal prep plan"
    >
      <h2 className="font-semibold">Weekly meal prep</h2>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <label>
          Start
          <Input
            aria-label="Plan start"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Days
          <Input
            aria-label="Plan days"
            type="number"
            min={1}
            max={7}
            value={days}
            onChange={(e) => setDays(Math.max(1, Math.min(7, Number(e.target.value) || 7)))}
          />
        </label>
        <label>
          Prep day
          <select
            aria-label="Prep day"
            className="h-9 w-full rounded-md border border-input bg-background px-2"
            value={prepDay}
            onChange={(e) => setPrepDay(Number(e.target.value))}
          >
            {WEEKDAYS.map((w, i) => (
              <option key={w} value={i}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-2">
          <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only
          use what I have
        </label>
      </div>
      <Button className="mt-3" disabled={busy || !inventoryCount} onClick={make}>
        {p ? "Rebuild meal plan" : "Plan my meals"}
      </Button>
      {!inventoryCount && (
        <p className="mt-2 text-xs text-muted-foreground">Add the food you have first.</p>
      )}
      {p && plan && d && (
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <p className="text-sm">
              {plan.status === "approved"
                ? "Accepted plan"
                : "Proposed plan: review, change, then accept"}{" "}
              · targets: {p.context.targets.kcal} kcal, {p.context.targets.protein_g} g protein (
              {p.context.targetsSource})
            </p>
          </div>
          {p.notes.map((n) => (
            <p key={n} className="mt-1 text-xs text-warning">
              {n}
            </p>
          ))}
          <div className="mt-3 flex gap-1 overflow-x-auto" role="tablist">
            {p.days.map((x, i) => (
              <button
                key={x.date}
                role="tab"
                aria-selected={i === sel}
                onClick={() => setSel(i)}
                className={`min-w-14 rounded-[12px] border px-2 py-1.5 text-xs ${i === sel ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <span className="block font-medium">{x.label}</span>
                <span className="tabular-nums text-muted-foreground">{x.totals.kcal}</span>
              </button>
            ))}
          </div>
          <div className="mt-3" data-testid="plan-day">
            <p className="text-sm font-medium">
              {d.label} {d.date} · {d.totals.kcal} kcal · P {Math.round(d.totals.protein_g)} g · C{" "}
              {Math.round(d.totals.carbs_g)} g · F {Math.round(d.totals.fat_g)} g
            </p>
            {d.notes.map((n) => (
              <p key={n} className="text-xs text-muted-foreground">
                {n}
              </p>
            ))}
            <div className="mt-2 space-y-2">
              {d.meals.map((m) => (
                <MealCard
                  key={m.slot}
                  m={m}
                  date={d.date}
                  planId={plan.id}
                  onEdit={(e) =>
                    act(() => edit({ data: { id: plan.id, edit: e as never } }), "Plan updated")
                  }
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  act(
                    () =>
                      edit({
                        data: {
                          id: plan.id,
                          edit: { type: "adjust_kcal", date: d.date, kcal: -200 },
                        },
                      }),
                    "Reduced by about 200 kcal",
                  )
                }
              >
                −200 kcal
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  act(
                    () =>
                      edit({
                        data: {
                          id: plan.id,
                          edit: { type: "more_protein", date: d.date, grams: 20 },
                        },
                      }),
                    "Added protein",
                  )
                }
              >
                +20 g protein
              </Button>
            </div>
          </div>
          <details className="mt-4 text-sm" open>
            <summary className="cursor-pointer font-medium">Shopping list</summary>
            <p className="mt-2 text-xs font-medium uppercase text-muted-foreground">
              You already have
            </p>
            <ul className="text-sm">
              {plan.shopping.have.map((h) => (
                <li key={h.name}>
                  {h.name} · using {h.using} g{h.grams != null ? ` of ${h.grams} g` : ""}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs font-medium uppercase text-muted-foreground">
              You need to buy
            </p>
            {plan.shopping.buy.length ? (
              <ul data-testid="shopping-buy">
                {plan.shopping.buy.map((b) => (
                  <li key={b.name}>
                    {b.name} · {b.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">Nothing. Everything comes from your food.</p>
            )}
            {plan.shopping.staples.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Assumed in your cupboard: {plan.shopping.staples.join(", ")}.
              </p>
            )}
            {plan.shopping.leftovers.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Left over afterwards:{" "}
                {plan.shopping.leftovers.map((l) => `${l.name} ${l.grams} g`).join(", ")}.
              </p>
            )}
          </details>
          <details className="mt-3 text-sm" open>
            <summary className="cursor-pointer font-medium">Batch prep</summary>
            {plan.prep.map((s) => (
              <div
                key={s.date}
                className="mt-2 rounded-[14px] border border-border p-3"
                data-testid="prep-session"
              >
                <p className="font-medium">
                  {s.label} {s.date} · about {s.minutes} min
                </p>
                <p className="text-xs text-muted-foreground">
                  Prepare: {s.cook.map((c) => `${c.name} ${c.grams} g`).join(", ")}
                </p>
                <p className="text-xs">Makes: {s.creates.join(", ")}</p>
                <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                  {s.storage.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="mt-1 text-xs text-muted-foreground">
              Storage follows UK Food Standards Agency and NHS guidance. Nutrition values are
              estimates from generic food data.
            </p>
          </details>
          {plan.status === "proposed" && (
            <Button
              className="mt-4"
              onClick={() => act(() => accept({ data: { id: plan.id } }), "Meal plan accepted")}
            >
              Accept this plan
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function MealCard({
  m,
  date,
  onEdit,
}: {
  m: Meal;
  date: string;
  planId: string;
  onEdit: (e: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const locked = m.state === "eaten" || m.state === "skipped";
  return (
    <div className="rounded-[14px] border border-border px-3 py-2 text-sm" data-testid="plan-meal">
      <button
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="min-w-0">
          <span className="text-muted-foreground">{SLOT_LABEL[m.slot]} · </span>
          {m.name}
          {m.batch ? <span className="ml-1 text-xs text-muted-foreground">(prep)</span> : null}
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {m.kcal} kcal · P{Math.round(m.protein_g)} C{Math.round(m.carbs_g)} F{Math.round(m.fat_g)}
          {m.state !== "planned" ? ` · ${m.state}` : ""}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <p>
            {m.ingredients
              .map(
                (i) =>
                  `${i.name} ${i.count ? `${i.count} (${i.grams} g)` : `${i.grams} g`}${i.have ? "" : " (buy)"}`,
              )
              .join(" · ")}
          </p>
          <p>
            {m.steps} About {m.minutes} min.
          </p>
          <RecipeBlock m={m} />
          {!locked && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEdit({ type: "replace", date, slot: m.slot })}
              >
                Something else
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEdit({ type: "replace", date, slot: m.slot, vegetarian: true })}
              >
                Vegetarian
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEdit({ type: "replace", date, slot: m.slot, quick: true })}
              >
                Quicker
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onEdit({ type: "remove", date, slot: m.slot })}
              >
                Remove
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RecipeBlock({ m }: { m: Meal }) {
  const fn = useServerFn(getMealRecipe);
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<{ steps: string[]; tips: string[] } | null>(null);
  if (m.steps === "Ready to eat.") return null;
  if (!r)
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setR(
              await fn({
                data: {
                  name: m.name,
                  minutes: m.minutes,
                  kcal: m.kcal,
                  ingredients: m.ingredients.map((i) => ({
                    name: i.name,
                    grams: i.grams,
                    count: i.count ?? null,
                  })),
                },
              }),
            );
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Writing recipe…" : "Full recipe"}
      </Button>
    );
  return (
    <div
      className="rounded-[12px] border border-border p-3 text-foreground"
      data-testid="meal-recipe"
    >
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Recipe · uses only your chosen foods
      </p>
      <ol className="list-decimal space-y-1 pl-4 text-sm">
        {r.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      {r.tips.length > 0 && (
        <ul className="mt-2 list-disc pl-4 text-xs text-muted-foreground">
          {r.tips.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
