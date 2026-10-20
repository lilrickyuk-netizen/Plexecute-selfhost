import { useQuery, useQueryClient } from "@tanstack/react-query";
import { rows } from "@/lib/rows";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  getNotificationSettings,
  saveNotificationPreference,
  removePushDevice,
} from "@/lib/notify.functions";
import { supabase } from "@/integrations/supabase/client";
import { CoachPromptSettings } from "@/components/CoachPromptSettings";
import { DECISION_LABEL } from "@/lib/intervention";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  EMAIL_ALLOWED,
  IN_APP_REQUIRED,
  STATUS_LABEL,
  type Category,
} from "@/lib/notify";

const CHANNEL_LABEL: Record<string, string> = {
  in_app: "In the app",
  push: "Phone",
  email: "Email",
  call: "Call",
};

export function NotificationSettings() {
  const qc = useQueryClient();
  const load = useServerFn(getNotificationSettings);
  const save = useServerFn(saveNotificationPreference);
  const remove = useServerFn(removePushDevice);
  const { data } = useQuery({ queryKey: ["notification-settings"], queryFn: () => load() });
  const { data: held } = useQuery({
    queryKey: ["intervention-decisions"],
    queryFn: async () =>
      rows(
        await supabase
          .from("intervention_decisions")
          .select("id,kind,reason,created_at")
          .eq("allowed", false)
          .order("created_at", { ascending: false })
          .limit(10),
      ),
  });
  if (!data) return null;

  async function set(c: Category, key: "in_app" | "push" | "email", v: boolean) {
    try {
      await save({ data: { category: c, ...data!.prefs[c], [key]: v } });
      qc.invalidateQueries({ queryKey: ["notification-settings"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const activeDevices = data.devices.filter((d) => d.status === "active");

  return (
    <section
      id="notifications"
      className="scroll-mt-20 space-y-4 rounded-[20px] border border-border bg-card p-6"
    >
      <div>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose where each kind of message reaches you. Phone and email wait until your quiet hours
          end, except account and safety notices. Nothing is sent twice.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-2 font-normal">Kind</th>
              <th className="font-normal">In the app</th>
              <th className="font-normal">Phone</th>
              <th className="font-normal">Email</th>
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((c) => (
              <tr key={c} className="border-t border-border">
                <td className="py-3 pr-3">
                  <div>{CATEGORY_LABEL[c].title}</div>
                  <div className="text-xs text-muted-foreground">{CATEGORY_LABEL[c].detail}</div>
                </td>
                <td>
                  <Switch
                    aria-label={`${CATEGORY_LABEL[c].title} in the app`}
                    checked={data.prefs[c].in_app || IN_APP_REQUIRED.has(c)}
                    disabled={IN_APP_REQUIRED.has(c)}
                    onCheckedChange={(v) => set(c, "in_app", v)}
                  />
                </td>
                <td>
                  <Switch
                    aria-label={`${CATEGORY_LABEL[c].title} on phone`}
                    checked={data.prefs[c].push}
                    onCheckedChange={(v) => set(c, "push", v)}
                  />
                </td>
                <td>
                  {EMAIL_ALLOWED[c] ? (
                    <Switch
                      aria-label={`${CATEGORY_LABEL[c].title} by email`}
                      checked={data.prefs[c].email}
                      onCheckedChange={(v) => set(c, "email", v)}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">Not by email</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.emailOn && (
        <p className="text-xs text-muted-foreground">
          Email sending isn't switched on yet, so email choices are saved but nothing is emailed.
        </p>
      )}

      <CoachPromptSettings prompt={data.prompt} devices={activeDevices.length} />

      <div>
        <h3 className="text-sm font-medium">Devices</h3>
        {activeDevices.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No device registered yet. Tap "Get prompts on this device" above on each phone or
            computer you use. Until then you'll see everything here in the app.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {activeDevices.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between rounded-[12px] border border-border p-3 text-sm"
              >
                <span>
                  {d.device_name ?? "Device"}{" "}
                  <span className="text-xs text-muted-foreground">
                    · last seen {new Date(d.last_seen_at).toLocaleDateString("en-GB")}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-[10px]"
                  onClick={async () => {
                    await remove({ data: { id: d.id } });
                    qc.invalidateQueries({ queryKey: ["notification-settings"] });
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium">Delivery history</h3>
        {data.history.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">Nothing sent yet.</p>
        ) : (
          <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto">
            {data.history.map((n) => (
              <li
                key={n.id}
                className="flex items-start justify-between gap-3 rounded-[10px] p-2 text-sm hover:bg-raised"
              >
                <div>
                  <div>{n.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {CATEGORY_LABEL[n.category as Category]?.title} · {CHANNEL_LABEL[n.channel]} ·{" "}
                    {new Date(n.sent_at ?? n.scheduled_at).toLocaleString("en-GB", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {n.interaction ? ` · ${n.interaction}` : ""}
                  </div>
                  {n.last_error && n.status !== "sent" && (
                    <div className="text-xs text-warning">
                      {n.status === "skipped" ? "Not sent: " : ""}
                      {n.last_error}
                    </div>
                  )}
                </div>
                <span
                  className={`shrink-0 text-xs ${n.status === "failed" ? "text-destructive" : n.status === "sent" ? "text-success" : "text-muted-foreground"}`}
                >
                  {STATUS_LABEL[n.status] ?? n.status}
                  {n.attempts > 1 ? ` (${n.attempts} tries)` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="text-sm font-medium">Reminders held back</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          When Plexecute decides not to remind you, the reason is kept here.
        </p>
        {!held?.length ? (
          <p className="mt-1 text-xs text-muted-foreground">None yet.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {held.map((h) => (
              <li key={h.id} className="flex justify-between gap-3 rounded-[10px] p-2 text-sm">
                <span>{DECISION_LABEL[h.reason] ?? "Not needed"}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {h.kind === "reminder" ? "Reminder" : "Check-in"} ·{" "}
                  {new Date(h.created_at).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
