import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, ImageUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { appendTranscript } from "@/lib/voice-input";
import {
  cancelMealPhoto,
  correctMealPhoto,
  estimateMealPhoto,
  logMealPhoto,
} from "@/lib/meal-photo.functions";
import { fmtRange, UNCLEAR_MESSAGE, type MealEstimate, type MealTotals } from "@/lib/meal-photo";

type Slot = "breakfast" | "lunch" | "dinner" | "snack";
export type MealView = {
  id: string;
  status: string;
  estimate: MealEstimate;
  totals: MealTotals;
  corrections: string[];
};

export async function downscaleImage(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}

const slotNow = (): Slot => {
  const h = new Date().getHours();
  return h < 11 ? "breakfast" : h < 15 ? "lunch" : h < 21 ? "dinner" : "snack";
};

/** Estimate card: ranges, uncertainty, corrections, Log / Cancel. Shared by Nutrition and Coach. */
export function MealEstimateCard({
  view,
  onChange,
  day,
  slot,
  onLogged,
  onCancelled,
}: {
  view: MealView;
  onChange: (v: MealView) => void;
  day: string;
  slot?: Slot | null;
  onLogged?: (() => void) | undefined;
  onCancelled?: (() => void) | undefined;
}) {
  const correct = useServerFn(correctMealPhoto);
  const log = useServerFn(logMealPhoto);
  const cancel = useServerFn(cancelMealPhoto);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"" | "fix" | "log" | "cancel">("");
  const [meal, setMeal] = useState<Slot>(slot ?? slotNow());
  const e = view.estimate;
  const t = view.totals;

  async function fix(c: string) {
    if (c.trim().length < 2) return;
    setBusy("fix");
    try {
      const r = (await correct({ data: { id: view.id, correction: c } })) as MealView & {
        note?: string;
      };
      onChange(r);
      if (r.note) toast.message(r.note);
      setText("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  if (view.status === "logged")
    return (
      <p className="rounded-[12px] border border-border p-3 text-sm" data-testid="meal-logged">
        Logged · {fmtRange(t.kcal, " kcal")} estimated. It's in today's totals.
      </p>
    );
  if (view.status === "cancelled")
    return <p className="text-sm text-muted-foreground">Cancelled — nothing was logged.</p>;
  if (e.status === "unclear")
    return (
      <div
        className="space-y-2 rounded-[12px] border border-border p-3 text-sm"
        data-testid="meal-unclear"
      >
        <p>{UNCLEAR_MESSAGE}</p>
        <p className="text-xs text-muted-foreground">{e.unclear_reason}</p>
      </div>
    );

  return (
    <div
      className="space-y-3 rounded-[12px] border border-border p-3 text-sm"
      data-testid="meal-estimate"
    >
      {e.summary && <p>{e.summary}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Calories (estimate)" value={fmtRange(t.kcal, " kcal")} big />
        <Stat label="Protein" value={fmtRange(t.protein_g, " g")} />
        <Stat label="Carbs" value={fmtRange(t.carbs_g, " g")} />
        <Stat label="Fat" value={fmtRange(t.fat_g, " g")} />
      </div>
      <ul className="space-y-1 text-xs">
        {e.items.map((i, k) => (
          <li key={k} className="flex justify-between gap-2">
            <span>
              {i.name}
              {i.preparation ? ` (${i.preparation})` : ""}
              {i.confidence === "low" ? " · unsure" : ""}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {i.grams_low === i.grams_high
                ? `${i.grams_low} g`
                : `${i.grams_low}–${i.grams_high} g`}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        This is an estimate, not a measurement: oil, sauces, hidden ingredients and exact portions
        can't be known from a photo.
      </p>
      {e.questions.map((q, k) => (
        <div key={k} className="space-y-1">
          <p className="text-xs font-medium">{q.text}</p>
          <div className="flex flex-wrap gap-1">
            {q.options.map((o) => (
              <button
                key={o}
                type="button"
                disabled={!!busy}
                className="rounded-md border border-border px-2 py-1 text-xs hover:border-primary"
                onClick={() => void fix(`${q.text} ${o}`)}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          aria-label="Correct the estimate"
          placeholder='e.g. "that was 250 g chicken" or "no oil"'
          value={text}
          onChange={(x) => setText(x.target.value)}
          onKeyDown={(x) => x.key === "Enter" && void fix(text)}
        />
        <VoiceInputButton
          label="Say a correction"
          onTranscript={(v) => setText((s) => appendTranscript(s, v))}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!!busy || text.trim().length < 2}
          onClick={() => void fix(text)}
        >
          {busy === "fix" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Meal"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={meal}
          onChange={(x) => setMeal(x.target.value as Slot)}
        >
          {(["breakfast", "lunch", "dinner", "snack"] as const).map((s) => (
            <option key={s} value={s}>
              {s[0]!.toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
        <Button
          className="flex-1"
          disabled={!!busy}
          onClick={async () => {
            setBusy("log");
            try {
              const r = (await log({
                data: { id: view.id, meal_slot: meal, date: day },
              })) as MealView & { already_logged: boolean };
              onChange(r);
              toast.success(
                r.already_logged
                  ? "Already logged — no duplicate added."
                  : `Logged ${fmtRange(t.kcal, " kcal")} (estimate).`,
              );
              onLogged?.();
            } catch (err) {
              toast.error((err as Error).message);
            } finally {
              setBusy("");
            }
          }}
        >
          {busy === "log" ? "Logging…" : "Log meal"}
        </Button>
        <Button
          variant="ghost"
          disabled={!!busy}
          onClick={async () => {
            setBusy("cancel");
            try {
              await cancel({ data: { id: view.id } });
              onChange({ ...view, status: "cancelled" });
              onCancelled?.();
            } finally {
              setBusy("");
            }
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className={`rounded-[10px] bg-background/60 px-2 py-1.5 ${big ? "col-span-2" : ""}`}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={big ? "text-lg font-semibold" : "font-medium"}>{value}</div>
    </div>
  );
}

/** Take or upload a meal photo, then review the estimate. Nothing is logged until "Log meal". */
export function MealPhotoEstimate({
  day,
  slot,
  onLogged,
}: {
  day: string;
  slot?: Slot | null;
  onLogged?: (() => void) | undefined;
}) {
  const estimate = useServerFn(estimateMealPhoto);
  const [view, setView] = useState<MealView | null>(null);
  const [busy, setBusy] = useState(false);
  const cam = useRef<HTMLInputElement>(null);
  const up = useRef<HTMLInputElement>(null);
  const [live, setLive] = useState(false);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      setView((await estimate({ data: { image: await downscaleImage(f) } })) as MealView);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (cam.current) cam.current.value = "";
      if (up.current) up.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      {live && (
        <LiveCamera
          onClose={() => setLive(false)}
          onFallback={() => {
            setLive(false);
            cam.current?.click();
          }}
          onShot={(f) => {
            setLive(false);
            void onFile(f);
          }}
        />
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            if (
              typeof navigator !== "undefined" &&
              "mediaDevices" in navigator &&
              typeof navigator.mediaDevices?.getUserMedia === "function"
            )
              setLive(true);
            else cam.current?.click();
          }}
        >
          <Camera className="h-4 w-4" /> Take meal photo
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => up.current?.click()}>
          <ImageUp className="h-4 w-4" /> Upload meal photo
        </Button>
      </div>
      <input
        ref={cam}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label="Take meal photo"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <input
        ref={up}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        aria-label="Upload meal photo"
        data-testid="meal-photo-upload"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Estimating your meal…
        </p>
      )}
      {view && (
        <MealEstimateCard
          view={view}
          onChange={setView}
          day={day}
          slot={slot ?? null}
          onLogged={onLogged}
        />
      )}
      <p className="text-xs text-muted-foreground">
        Photos are analysed then discarded, never stored. Estimates are approximate; search or
        manual entry stays available.
      </p>
    </div>
  );
}

/** Opens the device camera inside the page (desktop webcams and phones), so "Take" never opens a file picker. */
function LiveCamera({
  onShot,
  onClose,
  onFallback,
}: {
  onShot: (f: File) => void;
  onClose: () => void;
  onFallback: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  useEffect(() => {
    let off = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((s) => {
        if (off) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
      })
      .catch(() => {
        toast.error("Camera unavailable — allow camera access, or choose a photo instead.");
        onFallback();
      });
    return () => {
      off = true;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
    // Opens the camera once when shown; onFallback is only read if that single attempt fails.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function snap() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob(
      (b) => b && onShot(new File([b], "meal.jpg", { type: "image/jpeg" })),
      "image/jpeg",
      0.9,
    );
  }
  return (
    <div
      className="space-y-2 rounded-[14px] border border-border bg-card p-2"
      data-testid="live-camera"
    >
      <video
        ref={video}
        playsInline
        muted
        className="aspect-[4/3] w-full rounded-[10px] bg-background object-cover"
      />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={snap}>
          <Camera className="h-4 w-4" /> Take photo
        </Button>
      </div>
    </div>
  );
}
