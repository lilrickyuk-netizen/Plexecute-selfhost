import { FeatureHeader } from "@/components/FeatureHeader";
import { Footprints } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listJourneys,
  planJourney,
  changeJourney,
  cancelJourney,
  recheckJourneys,
  savePlace,
  listPlaces,
  scheduleLeaveCall,
} from "@/lib/journeys.functions";
import {
  BUFFER_CHOICES,
  MODE_LABELS,
  STATUS_LABELS,
  shortPlace,
  type JourneyMode,
  type JourneyStatus,
} from "@/lib/journeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaidGate } from "@/components/PaidGate";
import { getMyAdminStatus } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/app/journeys")({
  head: () => ({
    meta: [
      { title: "Journeys | Plexecute" },
      {
        name: "description",
        content:
          "Plan journeys with real travel times, leave-time reminders and traffic-aware updates.",
      },
      { property: "og:title", content: "Journeys | Plexecute" },
      {
        property: "og:description",
        content: "Know when to leave, with the travel time reserved in your plan.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JourneysGate,
});

function JourneysGate() {
  const status = useServerFn(getMyAdminStatus);
  const { data: me, isLoading } = useQuery({ queryKey: ["admin-status"], queryFn: () => status() });
  if (isLoading) return <p className="text-sm text-muted-foreground">Checking access…</p>;
  if (!me?.isAdmin)
    return (
      <div className="rounded-[20px] border border-border bg-card p-8 text-center">
        <Footprints size={28} aria-hidden="true" className="mx-auto text-muted-foreground" />
        <h1 className="mt-3 text-xl font-semibold">Journey Planning</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Journey planning is coming in a future upgrade. Everything else in Plexecute works today
          without it.
        </p>
      </div>
    );
  return <JourneysPage />;
}

type Journey = {
  id: string;
  origin_label: string | null;
  origin_address: string;
  dest_label: string | null;
  dest_address: string;
  mode: JourneyMode;
  arrive_by: string;
  leave_at: string;
  duration_min: number;
  buffer_min: number;
  traffic_aware: boolean;
  status: JourneyStatus;
};

const dt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const tm = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

function JourneysPage() {
  return (
    <PaidGate cap="journey_planning" title="Journey Planning">
      <JourneysInner />
    </PaidGate>
  );
}

function JourneysInner() {
  const qc = useQueryClient();
  const list = useServerFn(listJourneys);
  const places = useServerFn(listPlaces);
  const recheck = useServerFn(recheckJourneys);
  const journeys = useQuery({ queryKey: ["journeys"], queryFn: () => list({}) });
  const savedPlaces = useQuery({ queryKey: ["saved_places"], queryFn: () => places({}) });

  // Traffic-aware recheck when the page is viewed (server only recalculates what's due).
  useEffect(() => {
    recheck({})
      .then((r) => {
        if (r.checked > 0) qc.invalidateQueries({ queryKey: ["journeys"] });
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <FeatureHeader
        title="Journeys"
        icon={Footprints}
        description="Real travel times from Google Maps, with the journey reserved in your plan so nothing else gets scheduled over it."
      />
      <SavedPlaces
        places={savedPlaces.data ?? []}
        onSaved={() => qc.invalidateQueries({ queryKey: ["saved_places"] })}
      />
      <PlanForm
        hasHome={(savedPlaces.data ?? []).some((p) => p.label === "home")}
        onPlanned={() => qc.invalidateQueries({ queryKey: ["journeys"] })}
      />
      <section className="space-y-3">
        {(journeys.data ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            No journeys yet. Plan one above, or just ask the Coach.
          </p>
        )}
        {(journeys.data ?? []).map((j) => (
          <JourneyCard
            key={j.id}
            j={j as Journey}
            onChanged={() => qc.invalidateQueries({ queryKey: ["journeys"] })}
          />
        ))}
      </section>
    </div>
  );
}

function SavedPlaces({
  places,
  onSaved,
}: {
  places: { id: string; label: string; address: string }[];
  onSaved: () => void;
}) {
  const save = useServerFn(savePlace);
  const [label, setLabel] = useState("home");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="rounded-[16px] border border-border bg-card p-4">
      <h2 className="text-sm font-medium">Saved places</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Saved securely, never shown in full to the Coach.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {places.map((p) => (
          <span key={p.id} className="rounded-full bg-secondary px-3 py-1 text-xs capitalize">
            {p.label}: {shortPlace(p.address)}
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <select
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="min-h-11 rounded-[12px] border border-border bg-background px-3 text-sm"
        >
          <option value="home">Home</option>
          <option value="work">Work</option>
          <option value="gym">Gym</option>
        </select>
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Address"
          className="min-h-11 flex-1"
        />
        <Button
          disabled={busy || address.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            try {
              await save({ data: { label, address } });
              setAddress("");
              onSaved();
              toast.success("Place saved");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not save that address");
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
      </div>
    </section>
  );
}

function PlanForm({ hasHome, onPlanned }: { hasHome: boolean; onPlanned: () => void }) {
  const plan = useServerFn(planJourney);
  const [dest, setDest] = useState("");
  const [origin, setOrigin] = useState("");
  const [mode, setMode] = useState<JourneyMode>("drive");
  const [when, setWhen] = useState("");
  const [buffer, setBuffer] = useState(10);
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<{ id: string; name: string; address: string }[] | null>(
    null,
  );

  async function submit(destination: string) {
    setBusy(true);
    try {
      const r = await plan({
        data: {
          destination,
          origin: origin.trim() || null,
          mode,
          arrive_by: new Date(when).toISOString(),
          buffer_min: buffer,
        },
      });
      if (r.status === "ambiguous" || r.status === "ambiguous_origin") {
        setChoices(r.choices as { id: string; name: string; address: string }[]);
        return;
      }
      if (r.status === "failed") {
        toast.error(String(r.message));
        return;
      }
      setChoices(null);
      setDest("");
      toast.success(`Leave at ${tm(String(r.leave_at))} — journey reserved in your plan`);
      onPlanned();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not plan that journey");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[16px] border border-border bg-card p-4">
      <h2 className="text-sm font-medium">Plan a journey</h2>
      <div className="mt-3 space-y-2">
        <Input
          value={dest}
          onChange={(e) => setDest(e.target.value)}
          placeholder="Where to? (address, place name, or 'work')"
          className="min-h-11"
        />
        <Input
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          placeholder={
            hasHome ? "From (leave blank for home)" : "From (address, or save home below)"
          }
          className="min-h-11"
        />
        <div className="flex flex-wrap gap-2">
          {(Object.keys(MODE_LABELS) as JourneyMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`min-h-11 rounded-full px-4 text-sm ${mode === m ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <label className="block text-xs text-muted-foreground">
          Arrive by
          <Input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="mt-1 min-h-11"
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Arrive early by
          <select
            value={buffer}
            onChange={(e) => setBuffer(Number(e.target.value))}
            className="mt-1 min-h-11 w-full rounded-[12px] border border-border bg-background px-3 text-sm"
          >
            {BUFFER_CHOICES.map((b) => (
              <option key={b} value={b}>
                {b === 0 ? "No buffer" : `${b} minutes`}
              </option>
            ))}
          </select>
        </label>
        <Button
          className="min-h-11 w-full"
          disabled={busy || !dest.trim() || !when}
          onClick={() => submit(dest)}
        >
          {busy ? "Planning…" : "Plan journey"}
        </Button>
        {choices && (
          <div className="space-y-1 rounded-[12px] border border-border p-2">
            <p className="text-xs text-muted-foreground">Which one did you mean?</p>
            {choices.map((c) => (
              <button
                key={c.id}
                className="block w-full rounded-[10px] px-3 py-2 text-left text-sm hover:bg-secondary"
                onClick={() => {
                  setChoices(null);
                  setDest(c.address);
                  submit(c.address);
                }}
              >
                <span className="font-medium">{c.name}</span>
                <span className="block text-xs text-muted-foreground">{c.address}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function JourneyCard({ j, onChanged }: { j: Journey; onChanged: () => void }) {
  const change = useServerFn(changeJourney);
  const cancel = useServerFn(cancelJourney);
  const leaveCall = useServerFn(scheduleLeaveCall);
  const [busy, setBusy] = useState(false);
  const open = j.status !== "cancelled" && j.status !== "completed";

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      const r = (await fn()) as { status?: string; message?: string; error?: string };
      if (r.error) toast.error(r.error);
      else if (r.status === "failed") toast.error(String(r.message));
      else toast.success(done);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-[16px] border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            {j.origin_label ?? shortPlace(j.origin_address)} →{" "}
            {j.dest_label ?? shortPlace(j.dest_address)}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {MODE_LABELS[j.mode]} · {j.duration_min} min{j.traffic_aware ? " (traffic-aware)" : ""}{" "}
            · {j.buffer_min} min early
          </p>
        </div>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs">
          {STATUS_LABELS[j.status]}
        </span>
      </div>
      <p className="mt-2 text-sm">
        Leave <span className="font-medium">{dt(j.leave_at)}</span> · arrive by {tm(j.arrive_by)}
      </p>
      {open && (
        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(MODE_LABELS) as JourneyMode[])
            .filter((m) => m !== j.mode)
            .map((m) => (
              <Button
                key={m}
                variant="outline"
                size="sm"
                className="min-h-11"
                disabled={busy}
                onClick={() =>
                  act(
                    () => change({ data: { journey_id: j.id, mode: m } }),
                    `Switched to ${MODE_LABELS[m].toLowerCase()}`,
                  )
                }
              >
                {m === "drive"
                  ? "I'm driving"
                  : m === "transit"
                    ? "I'll take the train/bus"
                    : "I'll walk"}
              </Button>
            ))}
          <Button
            variant="outline"
            size="sm"
            className="min-h-11"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const r = await leaveCall({ data: { journey_id: j.id } });
                if (r.error) toast.error(r.error);
                return r;
              }, "We'll call you when it's time to leave")
            }
          >
            Call me when I need to leave
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11"
            disabled={busy}
            onClick={() => act(() => cancel({ data: { journey_id: j.id } }), "Journey cancelled")}
          >
            Cancel journey
          </Button>
        </div>
      )}
    </article>
  );
}
