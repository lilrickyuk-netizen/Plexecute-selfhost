import { HeightInput } from "@/components/HeightInput";
import { FeatureHeader } from "@/components/FeatureHeader";
import { Settings as SettingsIcon, User, ShieldCheck, Bell, Link2 } from "lucide-react";
import { unitsOf } from "@/lib/units";
import { rows } from "@/lib/rows";
import { ConsentCentre } from "@/components/ConsentCentre";
import { PreferenceSettings } from "@/components/PreferenceSettings";
import { HealthConnections } from "@/components/HealthConnections";
import { WearableConnections } from "@/components/WearableConnections";
import { NotificationSettings } from "@/components/NotificationSettings";
import { LEVEL_LABEL } from "@/lib/intervention";
import { SafetySettings } from "@/components/SafetyPanel";
import { COACHING_STYLES, STYLE_LABEL } from "@/lib/coaching-style";
import { Link } from "@tanstack/react-router";
import { SecuritySettings } from "@/components/SecuritySettings";
import { AutoAdaptSettings } from "@/components/AutoAdaptSettings";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ALLERGENS } from "@/lib/nutrition-engine";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useProfile, useUpdateProfile } from "@/lib/data";
import { PrivacyCentre } from "@/components/PrivacyCentre";
import {
  deleteMyAccount,
  getMemberServiceStatus,
  requestAccountabilityCall,
  wipeMyData,
} from "@/lib/billing.functions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf(
      "timeZone",
    );
  } catch {
    return ["Europe/London", "UTC"];
  }
})();

const Sel = ({
  value,
  onChange,
  opts,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  opts: [string, string][];
  label?: string;
}) => (
  <select
    aria-label={label}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
  >
    {opts.map(([v, l]) => (
      <option key={v} value={v}>
        {l}
      </option>
    ))}
  </select>
);

export function Settings({
  surface = "settings",
}: {
  surface?: "settings" | "profile" | "privacy" | "reminders" | "connections";
}) {
  const qc = useQueryClient();
  const { data: p } = useProfile();
  const update = useUpdateProfile();
  const wipeFn = useServerFn(wipeMyData);
  const deleteFn = useServerFn(deleteMyAccount);
  const callFn = useServerFn(requestAccountabilityCall);
  const statusFn = useServerFn(getMemberServiceStatus);
  const { data: integ } = useQuery({
    queryKey: ["member-service-status"],
    queryFn: () => statusFn(),
  });
  const { data: health = [] } = useQuery({
    queryKey: ["health"],
    queryFn: async () =>
      rows(
        await supabase
          .from("health_samples")
          .select("*")
          .order("recorded_at", { ascending: false })
          .limit(10),
      ),
  });
  const [f, setF] = useState({
    display_name: "",
    sex: "",
    height_cm: "",
    activity_level: "moderate",
    nutrition_goal: "maintain",
    coaching_style: "direct",
    diet_type: "omnivore",
    allergies: [] as string[],
  });
  const [r, setR] = useState({
    reminders_enabled: true,
    reminder_lead_min: "10",
    email_reminders: false,
    phone_number: "",
    calls_enabled: false,
    call_time: "20:00",
    timezone: "UTC",
    quiet_start: "22:00",
    quiet_end: "07:00",
    sleep_target_hours: "8",
    accountability_level: "adaptive",
    adaptive_daily_budget: "6",
  });
  const [notifPerm, setNotifPerm] = useState<string>("default");
  useEffect(() => {
    if (p) {
      setF({
        display_name: p.display_name ?? "",
        sex: p.sex ?? "",
        height_cm: p.height_cm == null ? "" : String(p.height_cm),
        activity_level: p.activity_level,
        nutrition_goal: p.nutrition_goal,
        coaching_style: p.coaching_style,
        diet_type: p.diet_type,
        allergies: p.allergies,
      });
      setR({
        reminders_enabled: p.reminders_enabled,
        reminder_lead_min: String(p.reminder_lead_min),
        email_reminders: p.email_reminders,
        phone_number: p.phone_number ?? "",
        calls_enabled: p.calls_enabled,
        call_time: p.call_time.slice(0, 5),
        timezone: p.timezone,
        quiet_start: p.quiet_start.slice(0, 5),
        quiet_end: p.quiet_end.slice(0, 5),
        sleep_target_hours: String(p.sleep_target_hours ?? 8),
        accountability_level: p.accountability_level,
        adaptive_daily_budget: String(p.adaptive_daily_budget),
      });
    }
  }, [p]);
  useEffect(() => {
    if (typeof Notification !== "undefined") setNotifPerm(Notification.permission);
  }, []);

  async function save() {
    await update.mutateAsync({
      ...f,
      sex: f.sex || null,
      height_cm: f.height_cm ? Number(f.height_cm) : null,
    });
    toast.success("Saved");
  }
  async function saveReminders() {
    const phone = r.phone_number.replace(/[\s()-]/g, "");
    if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) {
      toast.error("Use international format, e.g. +447700900123");
      return;
    }
    try {
      await update.mutateAsync({
        reminders_enabled: r.reminders_enabled,
        reminder_lead_min: Number(r.reminder_lead_min),
        email_reminders: r.email_reminders,
        phone_number: phone || null,
        calls_enabled: r.calls_enabled && !!phone,
        call_time: r.call_time,
        timezone: r.timezone,
        quiet_start: r.quiet_start,
        quiet_end: r.quiet_end,
        sleep_target_hours: Math.min(12, Math.max(4, Number(r.sleep_target_hours) || 8)),
        accountability_level: r.accountability_level as "off" | "reminders_only" | "adaptive",
        adaptive_daily_budget: Math.min(12, Math.max(0, Number(r.adaptive_daily_budget) || 0)),
      });
      toast.success("Reminder settings saved");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function askNotif() {
    if (typeof Notification === "undefined") {
      toast.error("This browser doesn't support notifications");
      return;
    }
    setNotifPerm(await Notification.requestPermission());
  }
  async function testCall() {
    const res = await callFn({ data: { origin: window.location.origin } });
    const msg: Record<string, string> = {
      not_configured: "Phone calls aren't switched on yet.",
      upgrade: "Calls are part of Pro and Execute.",
      no_phone: "Add your phone number first.",
      limit: "Pro includes 2 calls a week — you've used them.",
      failed: "The call couldn't be placed.",
    };
    if (res.ok) toast.success("Calling you now");
    else toast.error(msg[res.error ?? "failed"]);
  }

  async function wipe() {
    if (
      !confirm(
        "Delete all your goals, plans, logs and coach history? Your account and plan stay. This cannot be undone.",
      )
    )
      return;
    await wipeFn();
    qc.clear();
    toast.success("Your data was deleted");
    window.location.href = "/onboarding";
  }
  async function deleteAccount() {
    if (
      prompt(
        "Type DELETE to permanently delete your account, cancel any subscription and erase all data.",
      ) !== "DELETE"
    )
      return;
    try {
      await deleteFn();
      await supabase.auth.signOut();
      window.location.href = "/";
    } catch {
      toast.error("Couldn't delete your account. Please try again.");
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const copy = (s: string) => navigator.clipboard.writeText(s).then(() => toast.success("Copied"));

  return (
    <div className="space-y-8">
      <FeatureHeader
        title={
          {
            settings: "Settings",
            profile: "Profile",
            privacy: "Privacy",
            reminders: "Reminders",
            connections: "Connections",
          }[surface]
        }
        icon={
          {
            settings: SettingsIcon,
            profile: User,
            privacy: ShieldCheck,
            reminders: Bell,
            connections: Link2,
          }[surface]
        }
      />
      {surface === "profile" && (
        <>
          <section
            id="profile"
            className="scroll-mt-20 grid gap-4 rounded-[20px] border border-border bg-card p-6 md:grid-cols-2"
          >
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                aria-label="Name"
                value={f.display_name}
                onChange={(e) => setF({ ...f, display_name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Coaching style</Label>
              <Sel
                label="Coaching style"
                value={f.coaching_style}
                onChange={(v) => setF({ ...f, coaching_style: v })}
                opts={COACHING_STYLES.map((v) => [v, STYLE_LABEL[v]] as [string, string])}
              />
            </div>
            <div className="space-y-2">
              <Label>Sex (for nutrition estimates)</Label>
              <Sel
                label="Sex (for nutrition estimates)"
                value={f.sex}
                onChange={(v) => setF({ ...f, sex: v })}
                opts={[
                  ["", "Prefer not to say"],
                  ["female", "Female"],
                  ["male", "Male"],
                ]}
              />
            </div>
            <div className="space-y-2">
              <Label>Height ({unitsOf(p) === "imperial" ? "ft, in" : "cm"})</Label>
              <HeightInput
                cm={f.height_cm}
                units={unitsOf(p)}
                onChange={(v) => setF({ ...f, height_cm: v })}
              />
            </div>
            <div className="space-y-2">
              <Label>Activity level</Label>
              <Sel
                label="Activity level"
                value={f.activity_level}
                onChange={(v) => setF({ ...f, activity_level: v })}
                opts={[
                  ["low", "Sedentary"],
                  ["light", "Light"],
                  ["moderate", "Moderate"],
                  ["high", "Very active"],
                  ["exceptional", "Exceptional"],
                ]}
              />
            </div>
            <div className="space-y-2">
              <Label>Nutrition goal</Label>
              <Sel
                label="Nutrition goal"
                value={f.nutrition_goal}
                onChange={(v) => setF({ ...f, nutrition_goal: v })}
                opts={[
                  ["lose", "Lose fat"],
                  ["maintain", "Maintain"],
                  ["gain", "Gain muscle"],
                ]}
              />
            </div>
            <div className="space-y-2">
              <Label>Diet</Label>
              <Sel
                label="Diet"
                value={f.diet_type}
                onChange={(v) => setF({ ...f, diet_type: v })}
                opts={[
                  ["omnivore", "No restriction"],
                  ["vegetarian", "Vegetarian"],
                  ["vegan", "Vegan"],
                  ["pescatarian", "Pescatarian"],
                ]}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Allergies (kept private, used to flag foods)</Label>
              <div className="flex flex-wrap gap-2">
                {ALLERGENS.map((a) => {
                  const on = f.allergies.includes(a);
                  return (
                    <button
                      type="button"
                      key={a}
                      onClick={() =>
                        setF({
                          ...f,
                          allergies: on ? f.allergies.filter((x) => x !== a) : [...f.allergies, a],
                        })
                      }
                      className={`rounded-[10px] border px-3 py-1.5 text-xs capitalize ${on ? "border-warning text-warning" : "border-border bg-raised"}`}
                    >
                      {a}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Food database labels can be incomplete. Always check the actual packet label.
              </p>
            </div>
            <div className="md:col-span-2">
              <Button className="rounded-[10px]" onClick={save}>
                Save
              </Button>
            </div>
          </section>
        </>
      )}
      {surface === "settings" && (
        <>
          <div className="member-settings-links">
            <Button variant="outline" asChild>
              <Link to="/app/profile">Profile</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/app/reminders">Reminders</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/app/privacy">Privacy & security</Link>
            </Button>
          </div>
          <PreferenceSettings />

          <section className="rounded-[20px] border border-border bg-card p-6">
            <h2 className="text-lg font-semibold">Plan</h2>
            <p className="mt-1 text-sm capitalize text-muted-foreground">{p?.tier} plan</p>
            <Link
              to="/app/billing"
              search={{ status: undefined }}
              className="mt-3 inline-block text-sm text-primary"
            >
              Plan & billing →
            </Link>
          </section>
        </>
      )}
      {surface === "reminders" && (
        <>
          <section className="space-y-4 rounded-[20px] border border-border bg-card p-6">
            <h2 className="text-lg font-semibold">Reminders & accountability</h2>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Time zone</Label>
                <select
                  aria-label="Time zone"
                  className="h-9 w-full rounded-[10px] border border-border bg-background px-3 text-sm"
                  value={r.timezone}
                  onChange={(e) => setR({ ...r, timezone: e.target.value })}
                >
                  {ZONES.includes(r.timezone) ? null : <option>{r.timezone}</option>}
                  {ZONES.map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
                {typeof Intl !== "undefined" &&
                  Intl.DateTimeFormat().resolvedOptions().timeZone !== r.timezone && (
                    <button
                      type="button"
                      className="text-xs text-primary"
                      onClick={() =>
                        setR({ ...r, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
                      }
                    >
                      Use this device's zone ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                    </button>
                  )}
              </div>
              <div className="space-y-2">
                <Label>Quiet from</Label>
                <Input
                  aria-label="Quiet from"
                  type="time"
                  value={r.quiet_start}
                  onChange={(e) => setR({ ...r, quiet_start: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Quiet until</Label>
                <Input
                  aria-label="Quiet until"
                  type="time"
                  value={r.quiet_end}
                  onChange={(e) => setR({ ...r, quiet_end: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Days, reminders, calls and coach limits follow this time zone, including clock
              changes. No emails or calls during quiet hours.
            </p>
            <div className="flex items-center justify-between">
              <Label>Session reminders</Label>
              <Switch
                aria-label="Session reminders"
                checked={r.reminders_enabled}
                onCheckedChange={(v) => setR({ ...r, reminders_enabled: v })}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Sleep target (hours)</Label>
                <input
                  aria-label="Sleep target (hours)"
                  type="number"
                  min={4}
                  max={12}
                  step={0.5}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={r.sleep_target_hours}
                  onChange={(e) => setR({ ...r, sleep_target_hours: e.target.value })}
                />
                {Number(r.sleep_target_hours) < 7 && (
                  <p className="text-xs text-warning">
                    Most healthy adults need about 7 to 9 hours (NHS). This isn't a diagnosis.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Remind me before</Label>
                <Sel
                  label="Remind me before"
                  value={r.reminder_lead_min}
                  onChange={(v) => setR({ ...r, reminder_lead_min: v })}
                  opts={[
                    ["0", "At start"],
                    ["5", "5 min"],
                    ["10", "10 min"],
                    ["15", "15 min"],
                    ["30", "30 min"],
                    ["60", "1 hour"],
                  ]}
                />
              </div>
              <div className="space-y-2">
                <Label>Browser notifications</Label>
                <div>
                  <Button
                    variant="outline"
                    className="w-full rounded-[10px]"
                    onClick={askNotif}
                    disabled={notifPerm === "granted"}
                  >
                    {notifPerm === "granted"
                      ? "On for this device"
                      : notifPerm === "denied"
                        ? "Blocked in browser settings"
                        : "Turn on for this device"}
                  </Button>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>How much should Plexecute nudge you?</Label>
              <div className="grid gap-2 md:grid-cols-3">
                {(Object.keys(LEVEL_LABEL) as (keyof typeof LEVEL_LABEL)[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setR({ ...r, accountability_level: k })}
                    className={`rounded-[12px] border p-3 text-left text-sm ${r.accountability_level === k ? "border-primary bg-raised" : "border-border"}`}
                  >
                    <div className="font-medium">{LEVEL_LABEL[k].title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {LEVEL_LABEL[k].detail}
                    </div>
                  </button>
                ))}
              </div>
              {r.accountability_level === "adaptive" &&
                (p?.tier === "free" ? (
                  <p className="text-xs text-muted-foreground">
                    On the free plan you get your own reminders only. Adaptive nudges are part of
                    Pro and Execute.
                  </p>
                ) : (
                  <div className="flex items-center gap-3">
                    <Label className="text-xs">Most nudges a day</Label>
                    <Sel
                      value={r.adaptive_daily_budget}
                      onChange={(v) => setR({ ...r, adaptive_daily_budget: v })}
                      opts={Array.from(
                        { length: 13 },
                        (_, i) => [String(i), String(i)] as [string, string],
                      )}
                    />
                    <span className="text-xs text-muted-foreground">
                      At least 30 minutes apart. None in quiet hours, on red recovery days or while
                      a safety note is active.
                    </span>
                  </div>
                ))}
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Email reminders</Label>
                {integ && !integ.email && (
                  <p className="text-xs text-muted-foreground">
                    Email sending isn't switched on yet.
                  </p>
                )}
              </div>
              <Switch
                aria-label="Email reminders"
                checked={r.email_reminders}
                onCheckedChange={(v) => setR({ ...r, email_reminders: v })}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Phone number</Label>
                <Input
                  aria-label="Phone number"
                  placeholder="+447700900123"
                  value={r.phone_number}
                  onChange={(e) => setR({ ...r, phone_number: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Daily check-in call time (Execute)</Label>
                <Input
                  aria-label="Daily check-in call time (Execute)"
                  type="time"
                  value={r.call_time}
                  onChange={(e) => setR({ ...r, call_time: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Daily accountability calls</Label>
                <p className="text-xs text-muted-foreground">
                  {p?.tier === "execute"
                    ? "We'll call once a day at your chosen time."
                    : "Daily calls are part of Execute. Pro includes phone accountability within your plan usage: set them up on the Accountability calls page."}
                </p>
              </div>
              <Switch
                aria-label="Daily accountability calls"
                checked={r.calls_enabled}
                onCheckedChange={(v) => setR({ ...r, calls_enabled: v })}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button className="rounded-[10px]" onClick={saveReminders}>
                Save reminders
              </Button>
              <Button variant="outline" className="rounded-[10px]" onClick={testCall}>
                Call me now
              </Button>
            </div>
          </section>

          <NotificationSettings />
        </>
      )}
      {surface === "connections" && (
        <>
          <section
            id="calendar"
            className="scroll-mt-20 space-y-4 rounded-[20px] border border-border bg-card p-6"
          >
            <h2 className="text-lg font-semibold">Connections</h2>
            <HealthConnections origin={origin} />
            <WearableConnections />
            <div>
              <Label>Shortcut key (all kinds of data)</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Older personal key for an Apple Shortcut. It isn't limited to chosen kinds of data;
                prefer a connection key above.
              </p>
              <div className="mt-2 flex gap-2">
                <Input
                  aria-label="Health sync token"
                  readOnly
                  type="password"
                  value={p?.health_token ?? ""}
                />
                <Button
                  variant="outline"
                  className="rounded-[10px]"
                  onClick={() => p && copy(p.health_token)}
                >
                  Copy key
                </Button>
              </div>
              {health.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Last received: {health[0]!.kind} {Number(health[0]!.value)} (
                  {new Date(health[0]!.recorded_at).toLocaleString("en-GB")})
                </p>
              )}
            </div>
          </section>
        </>
      )}
      {surface === "settings" && (
        <>
          <AutoAdaptSettings />

          <SafetySettings />
        </>
      )}
      {surface === "privacy" && (
        <>
          <SecuritySettings />

          <ConsentCentre />

          <PrivacyCentre onWipe={wipe} onDeleteAccount={deleteAccount} />
        </>
      )}
    </div>
  );
}
