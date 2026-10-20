import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { getWebPushKey, registerPushDevice, savePromptPrefs } from "@/lib/notify.functions";
import { PUSH_KINDS, PUSH_KIND_LABEL } from "@/lib/push-plan";
import { deviceLabel, enableWebPush, requestPushPermission } from "@/lib/web-push-client";
import { PushDeviceDiagnostics } from "@/components/PushDeviceDiagnostics";

type Prompt = {
  reminders_enabled: boolean | null;
  reminder_lead_min: number | null;
  push_motivating: boolean | null;
  quiet_start: string | null;
  quiet_end: string | null;
  push_muted_kinds: string[] | null;
} | null;

const NOT_ON: Record<string, string> = {
  "home-screen-required":
    "On iPhone or iPad (16.4 or later), add Plexecute to your Home Screen and open it there before enabling notifications.",
  "open-in-new-tab":
    "Open Plexecute in its own browser tab (or the published app), then try again.",
  denied: "Notifications are blocked for Plexecute. Allow them in your browser's site settings.",
  unsupported:
    "This browser can't receive notifications. On iPhone, add Plexecute to your Home Screen first, then open it from there.",
  "not-configured": "Notifications aren't switched on yet.",
};

export function CoachPromptSettings({ prompt, devices }: { prompt: Prompt; devices: number }) {
  const qc = useQueryClient();
  const save = useServerFn(savePromptPrefs);
  const key = useServerFn(getWebPushKey);
  const register = useServerFn(registerPushDevice);
  const [busy, setBusy] = useState(false);
  const p = prompt ?? {
    reminders_enabled: true,
    reminder_lead_min: 10,
    push_motivating: true,
    quiet_start: null,
    quiet_end: null,
    push_muted_kinds: [],
  };
  const muted = new Set(p.push_muted_kinds ?? []);

  async function patch(v: Record<string, unknown>) {
    try {
      await save({ data: v as never });
      qc.invalidateQueries({ queryKey: ["notification-settings"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function enable() {
    setBusy(true);
    try {
      // Keep the permission request on the tap, before any server round trip (required on iOS).
      const permission = await requestPushPermission();
      if (permission !== "granted") {
        toast.message(NOT_ON[permission]);
        return;
      }
      const { key: k } = await key();
      const r = await enableWebPush(k);
      if (r.status !== "registered") {
        toast.message(NOT_ON[r.status]);
        return;
      }
      await register({ data: { platform: "web", token: r.token, deviceName: deviceLabel() } });
      toast.success("Coach can now prompt you on this device, even with Plexecute closed.");
      qc.invalidateQueries({ queryKey: ["notification-settings"] });
    } catch (e) {
      toast.error((e as Error).message || "Could not switch on notifications here.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-[16px] border border-border p-4">
      <div>
        <h3 className="text-sm font-medium">Coach prompts</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Coach nudges you at the right moment for what's actually on your plan — wake time, meals,
          workouts, study, tasks and appointments. Moved, finished or deleted items are never
          prompted.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" className="rounded-[10px]" onClick={enable} disabled={busy}>
          {busy ? "Switching on…" : "Get prompts on this device"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {devices
            ? `${devices} device${devices > 1 ? "s" : ""} receiving prompts`
            : "No device yet"}
        </span>
      </div>
      <PushDeviceDiagnostics />
      <label className="flex items-center justify-between gap-3 text-sm">
        Prompts on
        <Switch
          aria-label="Coach prompts on"
          checked={p.reminders_enabled !== false}
          onCheckedChange={(v) => patch({ reminders_enabled: v })}
        />
      </label>
      <label className="flex items-center justify-between gap-3 text-sm">
        Warning before sessions
        <select
          aria-label="Warning before sessions"
          className="rounded-[10px] border border-border bg-background px-2 py-1 text-sm"
          value={p.reminder_lead_min ?? 10}
          onChange={(e) => patch({ reminder_lead_min: Number(e.target.value) })}
        >
          {[5, 10, 15, 30, 60].map((m) => (
            <option key={m} value={m}>
              {m} minutes
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-3 text-sm">
        Motivating tone (follows your Coach style)
        <Switch
          aria-label="Motivating tone"
          checked={p.push_motivating !== false}
          onCheckedChange={(v) => patch({ push_motivating: v })}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        Quiet hours
        <input
          type="time"
          aria-label="Quiet hours start"
          className="rounded-[10px] border border-border bg-background px-2 py-1"
          defaultValue={p.quiet_start?.slice(0, 5) ?? ""}
          onBlur={(e) => patch({ quiet_start: e.target.value || null })}
        />
        to
        <input
          type="time"
          aria-label="Quiet hours end"
          className="rounded-[10px] border border-border bg-background px-2 py-1"
          defaultValue={p.quiet_end?.slice(0, 5) ?? ""}
          onBlur={(e) => patch({ quiet_end: e.target.value || null })}
        />
      </div>
      <div>
        <div className="text-sm">What Coach can prompt you about</div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PUSH_KINDS.map((k) => (
            <label key={k} className="flex items-center justify-between gap-3 text-sm">
              {PUSH_KIND_LABEL[k]}
              <Switch
                aria-label={PUSH_KIND_LABEL[k]}
                checked={!muted.has(k)}
                onCheckedChange={(v) => {
                  const next = new Set(muted);
                  if (v) next.delete(k);
                  else next.add(k);
                  patch({ push_muted_kinds: [...next] });
                }}
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
