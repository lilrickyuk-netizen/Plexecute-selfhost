import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  disconnectCalendar,
  getCalendarState,
  importDeviceCalendar,
  resolveCalendarChange,
  setCalendarAllDay,
  startCalendarConnect,
  syncCalendarNow,
} from "@/lib/calendar.functions";
import { CALENDAR_MODES, MODE_LABEL, type CalendarMode } from "@/lib/calendar";

const NAME: Record<string, string> = {
  google: "Google Calendar",
  microsoft: "Outlook Calendar",
  device: "Phone or computer calendar (file)",
};
const STATUS: Record<string, string> = {
  active: "Connected",
  degraded: "Needs attention, retrying",
  revoked: "Access removed, reconnect",
  pending: "Connecting",
};
const MODE_HELP: Record<CalendarMode, string> = {
  FREE_BUSY_ONLY: "Only start and end times. Titles, notes and attendees are never read.",
  READ_DETAILS: "Also reads event titles so you can recognise them here.",
  WRITE_PLEXECUTE_BLOCKS: "Adds your sessions to your calendar. Doesn't read your events.",
  READ_AND_WRITE: "Busy times only, plus your sessions added to your calendar.",
};
const RETURN: Record<string, string> = {
  connected: "Calendar connected.",
  declined: "You cancelled the connection.",
  invalid: "That connection link expired. Try again.",
  failed: "The calendar couldn't be connected. Try again.",
  not_configured: "Calendar connection isn't switched on yet.",
};
const when = (s: string) =>
  new Date(s).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function CalendarConnections() {
  const qc = useQueryClient();
  const fetchState = useServerFn(getCalendarState),
    start = useServerFn(startCalendarConnect),
    sync = useServerFn(syncCalendarNow),
    disc = useServerFn(disconnectCalendar),
    imp = useServerFn(importDeviceCalendar),
    allDay = useServerFn(setCalendarAllDay),
    resolve = useServerFn(resolveCalendarChange);
  const { data: s } = useQuery({ queryKey: ["calendar"], queryFn: () => fetchState() });
  const [mode, setMode] = useState<CalendarMode>("FREE_BUSY_ONLY");
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["calendar"] });
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("calendar");
    if (r && RETURN[r]) (r === "connected" ? toast.success : toast.error)(RETURN[r]);
  }, []);
  async function run<T>(f: () => Promise<T>, ok?: string) {
    setBusy(true);
    try {
      await f();
      if (ok) toast.success(ok);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  async function connect(provider: "google" | "microsoft") {
    const r = await start({ data: { provider, mode } });
    if (r.url) window.location.href = r.url;
    else toast.error("Calendar connection isn't switched on yet.");
  }
  async function onFile(f: File | undefined) {
    if (!f) return;
    await run(async () => {
      const r = await imp({ data: { ics: await f.text() } });
      toast.success(`${r.imported} busy times added.`);
    });
  }
  const live = (p: string) => s?.connections.find((c) => c.provider === p);

  return (
    <div className="space-y-4">
      <div>
        <Label>Connected calendars</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Busy times in your calendar are treated as fixed, so the plan never books over them.
          Choose the least access you're happy with; adding sessions to your calendar is always a
          separate choice.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Access for a new connection</legend>
        {CALENDAR_MODES.map((m) => (
          <label key={m} className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="radio"
              name="calmode"
              className="mt-1"
              checked={mode === m}
              onChange={() => setMode(m)}
            />
            <span>
              <span className="font-medium">{MODE_LABEL[m]}</span>
              <span className="block text-xs text-muted-foreground">{MODE_HELP[m]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-wrap gap-2">
        {(["google", "microsoft"] as const).map((p) => (
          <Button
            key={p}
            variant="outline"
            className="h-auto min-h-9 max-w-full whitespace-normal rounded-[10px] text-left"
            disabled={busy || !s?.configured[p]}
            onClick={() => connect(p)}
          >
            {live(p) ? `Reconnect ${NAME[p]}` : `Connect ${NAME[p]}`}
            {s && !s.configured[p] ? " (not switched on yet)" : ""}
          </Button>
        ))}
        <label className="inline-flex cursor-pointer items-center rounded-[10px] border border-border px-4 text-sm hover:bg-raised">
          Add a calendar file (.ics)
          <input
            type="file"
            accept=".ics,text/calendar"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        For your phone's own calendar, export it as an .ics file and add it here. Only busy times
        are kept. Add a new file to update it.
      </p>

      {(s?.connections.length ?? 0) > 0 && (
        <ul className="divide-y divide-border rounded-[14px] border border-border">
          {s!.connections.map((c) => (
            <li key={c.id} className="space-y-2 px-4 py-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">{NAME[c.provider]}</span>
                <span className={c.status === "active" ? "text-success" : "text-warning"}>
                  {STATUS[c.status] ?? c.status}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {MODE_LABEL[c.mode as CalendarMode]} ·{" "}
                {c.last_sync_at ? `last updated ${when(c.last_sync_at)}` : "not updated yet"}
                {c.stale ? " · busy times may be out of date" : ""}
              </p>
              {c.last_error && <p className="text-xs text-warning">{c.last_error}</p>}
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={c.all_day_hard}
                  onChange={(e) =>
                    run(() => allDay({ data: { id: c.id, hard: e.target.checked } }))
                  }
                />{" "}
                All-day events block the whole day
              </label>
              <div className="flex gap-2">
                {c.provider !== "device" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-[10px]"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const r = await sync({ data: { id: c.id } });
                        if (r.status === "paused")
                          toast.message(
                            "Calendar updates are paused for a short while. Your last known busy times are still used.",
                          );
                        else toast.success("Updated.");
                      })
                    }
                  >
                    Update now
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-[10px]"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => disc({ data: { id: c.id } }),
                      "Disconnected. Access removed and busy times deleted.",
                    )
                  }
                >
                  Disconnect
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {s && s.connections.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {s.upcomingBusy} busy times in the next 14 days.
        </p>
      )}

      {(s?.conflicts.length ?? 0) > 0 && (
        <div className="rounded-[14px] border border-warning/50 p-4 text-sm">
          <p className="font-medium">Sessions that now clash with your calendar</p>
          <ul className="mt-2 space-y-1 text-xs">
            {s!.conflicts.map((b) => (
              <li key={b.id}>
                {b.title} · {when(b.starts_at)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Nothing has been moved. Use "Repair my day" or a new weekly plan to choose new times.
          </p>
        </div>
      )}

      {(s?.attention.length ?? 0) > 0 && (
        <div className="rounded-[14px] border border-border p-4 text-sm">
          <p className="font-medium">Changes you made in your calendar</p>
          <ul className="mt-2 space-y-3">
            {s!.attention.map((a) => (
              <li key={a.block_id} className="text-xs">
                <p>
                  {a.block?.title ?? "Session"} {a.block ? `(${when(a.block.starts_at)})` : ""}:{" "}
                  {a.state === "deleted_externally"
                    ? "you deleted it from your calendar."
                    : `you moved it to ${a.external_starts_at ? when(a.external_starts_at) : "another time"}. Your plan still has the original time.`}
                </p>
                <div className="mt-1 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-[10px]"
                    onClick={() =>
                      run(
                        () =>
                          resolve({
                            data: {
                              connectionId: a.connection_id,
                              blockId: a.block_id,
                              decision: "restore",
                            },
                          }),
                        "It'll be put back at the planned time.",
                      )
                    }
                  >
                    Put it back at the planned time
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-[10px]"
                    onClick={() =>
                      run(
                        () =>
                          resolve({
                            data: {
                              connectionId: a.connection_id,
                              blockId: a.block_id,
                              decision: "leave_out",
                            },
                          }),
                        "Left out of your calendar.",
                      )
                    }
                  >
                    Leave it out of my calendar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Your plan itself only changes when you approve a change in Plexecute.
          </p>
        </div>
      )}
    </div>
  );
}
