import { toMap, reminderLeadMin, AUTO_ADAPT_DEFAULTS } from "@/lib/auto-adapt";
import { rows } from "@/lib/rows";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/lib/data";

/** Device reminders while Plexecute is open, plus the in-app inbox filled by the server reminder job. */
export function Reminders() {
  const { data: profile } = useProfile();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: notes = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () =>
      rows(
        await supabase
          .from("notifications")
          .select("*")
          .eq("channel", "in_app")
          .eq("status", "sent")
          .order("created_at", { ascending: false })
          .limit(20),
      ),
    refetchInterval: 60000,
  });
  const { data: upcoming = [] } = useQuery({
    queryKey: ["upcoming-blocks"],
    queryFn: async () => {
      const now = new Date();
      return rows(
        await supabase
          .from("plan_blocks")
          .select("id,title,starts_at,interruption_count")
          .in("status", [
            "planned",
            "scheduled",
            "upcoming",
            "due",
            "contacting",
            "acknowledged",
            "snoozed",
          ])
          .gte("starts_at", now.toISOString())
          .lte("starts_at", new Date(now.getTime() + 864e5).toISOString())
          .order("starts_at"),
      );
    },
    refetchInterval: 5 * 60000,
  });

  const { data: perms } = useQuery({
    queryKey: ["auto-adapt"],
    queryFn: async () =>
      toMap((await supabase.from("auto_adapt_permissions").select("permission,enabled")).data),
  });
  useEffect(() => {
    if (!profile?.reminders_enabled || typeof Notification === "undefined") return;
    const timers = upcoming.map((b) => {
      const lead =
        reminderLeadMin(
          profile.reminder_lead_min,
          b.interruption_count ?? 0,
          perms ?? AUTO_ADAPT_DEFAULTS,
        ) * 60000;
      const ms = new Date(b.starts_at).getTime() - lead - Date.now();
      if (ms < 0 || ms > 864e5) return null;
      return setTimeout(() => {
        const key = `plx-notified-${b.id}`;
        if (Notification.permission !== "granted" || localStorage.getItem(key)) return;
        localStorage.setItem(key, "1");
        const opts = {
          body: new Date(b.starts_at).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          tag: `block-${b.id}`,
        };
        // Android only allows notifications through the service worker; the constructor throws there.
        void (async () => {
          try {
            const reg = await navigator.serviceWorker?.getRegistration();
            if (reg) await reg.showNotification(`Up next: ${b.title}`, opts);
            else new Notification(`Up next: ${b.title}`, opts);
          } catch {
            /* not supported on this device */
          }
        })();
      }, ms);
    });
    return () => timers.forEach((t) => t && clearTimeout(t));
  }, [upcoming, profile?.reminders_enabled, profile?.reminder_lead_min, perms]);

  const unread = notes.filter((n) => !n.read_at).length;
  async function toggle() {
    setOpen(!open);
    if (!open && unread) {
      const at = new Date().toISOString();
      // V3 §69 interaction result: opening the inbox records "opened" on unread in-app notices.
      await supabase
        .from("notifications")
        .update({ read_at: at, interaction: "opened", interaction_at: at })
        .eq("channel", "in_app")
        .eq("status", "sent")
        .is("read_at", null);
      qc.invalidateQueries({ queryKey: ["notifications"] });
    }
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        aria-label="Notifications"
        className="relative rounded-full p-2 text-muted-foreground hover:bg-raised hover:text-foreground"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-execute" />}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-[14px] border border-border bg-card p-2 shadow-lg">
          {notes.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No reminders yet.</p>
          ) : (
            notes.map((n) => (
              <div key={n.id} className="rounded-[10px] p-3 text-sm hover:bg-raised">
                <div>{n.title}</div>
                {n.body && <div className="text-xs text-muted-foreground">{n.body}</div>}
                <div className="text-xs text-muted-foreground">
                  {new Date(n.created_at).toLocaleString("en-GB", {
                    weekday: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
