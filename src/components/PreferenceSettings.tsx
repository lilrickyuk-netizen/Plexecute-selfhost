import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProfile, useUpdateProfile } from "@/lib/data";
import { DOMAINS } from "@/lib/scheduler";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

/** V3 §58: display, units, life areas, daily routine, accessibility and sign-in email. */
export function PreferenceSettings() {
  const { data: p } = useProfile();
  const update = useUpdateProfile();
  const [s, setS] = useState({
    units: "metric",
    billing_country: "GB",
    text_size: "standard",
    reduce_motion: false,
    high_contrast: false,
    enabled_domains: [] as string[],
    wake_time: "07:00",
    sleep_time: "23:00",
    work_start: "09:00",
    work_end: "17:30",
    work_days: [1, 2, 3, 4, 5] as number[],
  });
  const [email, setEmail] = useState("");
  useEffect(() => {
    if (!p) return;
    const x = p as unknown as {
      [k: string]: unknown;
      units?: string;
      text_size?: string;
      reduce_motion?: boolean;
      high_contrast?: boolean;
      enabled_domains?: string[];
      wake_time?: string;
      sleep_time?: string;
      work_start?: string;
      work_end?: string;
      work_days?: number[];
    };
    setS({
      units: (x.units as string) ?? "metric",
      billing_country: (x["billing_country"] as string) ?? "GB",
      text_size: (x.text_size as string) ?? "standard",
      reduce_motion: !!x.reduce_motion,
      high_contrast: !!x.high_contrast,
      enabled_domains: (x.enabled_domains as string[]) ?? [],
      wake_time: String(x.wake_time ?? "07:00").slice(0, 5),
      sleep_time: String(x.sleep_time ?? "23:00").slice(0, 5),
      work_start: String(x.work_start ?? "09:00").slice(0, 5),
      work_end: String(x.work_end ?? "17:30").slice(0, 5),
      work_days: (x.work_days as number[]) ?? [],
    });
  }, [p]);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);
  const toggle = <T,>(a: T[], v: T) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]);
  const chip = (on: boolean) =>
    `rounded-[10px] border px-3 py-1.5 text-xs ${on ? "border-primary bg-raised" : "border-border"}`;

  async function save() {
    if (s.enabled_domains.length === 0) {
      toast.error("Keep at least one life area switched on.");
      return;
    }
    try {
      await update.mutateAsync(s as never);
      toast.success("Preferences saved. New plans use these from now on.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function changeEmail() {
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      toast.error("Enter a valid email address.");
      return;
    }
    const { error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: `${window.location.origin}/app/settings` },
    );
    if (error) toast.error(error.message);
    else toast.success("Check both inboxes to confirm the change.");
  }

  return (
    <section
      id="preferences"
      className="scroll-mt-20 space-y-5 rounded-[20px] border border-border bg-card p-6"
    >
      <h2 className="text-lg font-semibold">Display, routine & life areas</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label>Units</Label>
          <select
            aria-label="Units"
            className={sel}
            value={s.units}
            onChange={(e) => setS({ ...s, units: e.target.value })}
          >
            <option value="metric">Metric (kg, cm, km, °C)</option>
            <option value="imperial">Imperial (lb, ft/in, miles, °F)</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label>Billing country</Label>
          <select
            aria-label="Billing country"
            className={sel}
            value={s.billing_country}
            onChange={(e) => setS({ ...s, billing_country: e.target.value })}
          >
            <option value="GB">United Kingdom (£)</option>
            <option value="US">United States ($)</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label>Text size</Label>
          <select
            aria-label="Text size"
            className={sel}
            value={s.text_size}
            onChange={(e) => setS({ ...s, text_size: e.target.value })}
          >
            <option value="standard">Standard</option>
            <option value="large">Large</option>
            <option value="larger">Larger</option>
          </select>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <Label>Reduce motion</Label>
        <Switch
          aria-label="Reduce motion"
          checked={s.reduce_motion}
          onCheckedChange={(v) => setS({ ...s, reduce_motion: v })}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label>High contrast</Label>
        <Switch
          aria-label="High contrast"
          checked={s.high_contrast}
          onCheckedChange={(v) => setS({ ...s, high_contrast: v })}
        />
      </div>
      <div className="space-y-2">
        <Label>Life areas Plexecute plans for</Label>
        <div className="flex flex-wrap gap-2">
          {DOMAINS.map((d) => (
            <button
              key={d.value}
              type="button"
              aria-pressed={s.enabled_domains.includes(d.value)}
              className={chip(s.enabled_domains.includes(d.value))}
              onClick={() => setS({ ...s, enabled_domains: toggle(s.enabled_domains, d.value) })}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <div className="space-y-2">
          <Label>Wake up</Label>
          <Input
            aria-label="Wake up"
            type="time"
            value={s.wake_time}
            onChange={(e) => setS({ ...s, wake_time: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Bedtime</Label>
          <Input
            aria-label="Bedtime"
            type="time"
            value={s.sleep_time}
            onChange={(e) => setS({ ...s, sleep_time: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Work starts</Label>
          <Input
            aria-label="Work starts"
            type="time"
            value={s.work_start}
            onChange={(e) => setS({ ...s, work_start: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Work ends</Label>
          <Input
            aria-label="Work ends"
            type="time"
            value={s.work_end}
            onChange={(e) => setS({ ...s, work_end: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Work days</Label>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <button
              key={d}
              type="button"
              aria-pressed={s.work_days.includes(i)}
              className={chip(s.work_days.includes(i))}
              onClick={() => setS({ ...s, work_days: toggle(s.work_days, i).sort() })}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Your current week isn't changed. The next plan proposal uses these, and you approve it as
        usual.
      </p>
      <Button className="rounded-[10px]" onClick={save}>
        Save preferences
      </Button>
      <div className="space-y-2 border-t border-border pt-4">
        <Label>Sign-in email</Label>
        <div className="flex gap-2">
          <Input
            aria-label="Email address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button variant="outline" className="rounded-[10px]" onClick={changeEmail}>
            Change email
          </Button>
        </div>
      </div>
    </section>
  );
}
