import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, CircleDashed, TriangleAlert, Pause } from "lucide-react";
import { getIntegrationStatus } from "@/lib/billing.functions";
import { getMyAdminStatus } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { stateLabel, stateDetail, type ServiceState } from "@/lib/resilience";

export const Route = createFileRoute("/_authenticated/app/integrations")({
  head: () => ({
    meta: [
      { title: "Integrations · Plexecute" },
      {
        name: "description",
        content: "See which health sources and services are connected to Plexecute.",
      },
      { property: "og:title", content: "Integrations · Plexecute" },
      {
        property: "og:description",
        content: "See which health sources and services are connected to Plexecute.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Integrations,
});

function Row({ name, state, detail }: { name: string; state: ServiceState; detail: string }) {
  const icon =
    state === "working" ? (
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
    ) : state === "degraded" ? (
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
    ) : state === "paused" ? (
      <Pause className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    ) : (
      <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    );
  const colour =
    state === "working"
      ? "text-success"
      : state === "degraded"
        ? "text-warning"
        : "text-muted-foreground";
  return (
    <li className="flex items-start gap-3 px-5 py-4">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="font-medium">{name}</div>
        <div className="text-sm text-muted-foreground">{stateDetail(state, detail)}</div>
      </div>
      <span className={`shrink-0 text-xs ${colour}`}>{stateLabel(state)}</span>
    </li>
  );
}

const S = (v: ServiceState | undefined): ServiceState => v ?? "not_configured";

function Integrations() {
  const status = useServerFn(getMyAdminStatus);
  const statusFn = useServerFn(getIntegrationStatus);
  const { data: me, isLoading: checking } = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => status(),
  });
  const isAdmin = !!me?.isAdmin;
  const { data: s } = useQuery({
    queryKey: ["integration-status"],
    queryFn: () => statusFn(),
    enabled: isAdmin,
    retry: false,
  });
  const { data: last } = useQuery({
    queryKey: ["last-health"],
    enabled: isAdmin,
    queryFn: async () =>
      (
        await supabase
          .from("health_samples")
          .select("kind,source,recorded_at")
          .order("recorded_at", { ascending: false })
          .limit(1)
      ).data?.[0] ?? null,
  });
  if (checking) return <p className="text-sm text-muted-foreground">Checking access…</p>;
  if (!isAdmin)
    return (
      <div>
        <h1 className="text-2xl font-semibold">Service status</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is only for Plexecute administrators.
        </p>
        <Link to="/app" className="mt-4 inline-flex text-sm underline underline-offset-4">
          Back to Today
        </Link>
      </div>
    );
  const list =
    "mt-3 divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card";
  return (
    <div>
      <h1 className="text-3xl font-semibold">Integrations</h1>
      <p className="mt-1 text-muted-foreground">
        What Plexecute is connected to. Services marked "not switched on yet" are built and start
        working once the account is set up. If something is temporarily unavailable, we keep trying
        in the background and your plan still works.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Health and wearables</h2>
      <ul className={list}>
        <Row
          name="Apple Health / Health Connect"
          state={last ? "working" : "not_configured"}
          detail={
            last
              ? `Last received: ${last.kind.replace("_", " ")} from ${last.source.replace("_", " ")}, ${new Date(last.recorded_at).toLocaleString("en-GB")}`
              : "Sent from your phone with your personal health key."
          }
        />
        <Row name="WHOOP" state={S(s?.wearables.whoop)} detail="Sleep, recovery and strain." />
        <Row name="Oura" state={S(s?.wearables.oura)} detail="Sleep and readiness." />
        <Row name="Fitbit" state={S(s?.wearables.fitbit)} detail="Steps, sleep and heart rate." />
        <Row name="Strava" state={S(s?.wearables.strava)} detail="Runs, rides and workouts." />
        <Row name="Garmin" state={S(s?.wearables.garmin)} detail="Activities, sleep and steps." />
      </ul>

      <h2 className="mt-8 text-lg font-semibold">Services</h2>
      <ul className={list}>
        <Row name="AI coach" state={S(s?.ai)} detail="Answers questions and explains your plan." />
        <Row
          name="Food database"
          state={S(s?.food)}
          detail={
            s?.food === "working"
              ? "Full UK food search and barcode lookup."
              : "Using the free US food database until set up."
          }
        />
        <Row name="Payments" state={S(s?.payments)} detail="Subscriptions and free trials." />
        <Row
          name="Accountability calls"
          state={S(s?.calls)}
          detail="Phone calls on Pro and Execute."
        />
        <Row name="Email reminders" state={S(s?.email)} detail="Reminders when a session is due." />
        <Row
          name="Reminder scheduler"
          state={S(s?.cron)}
          detail="Sends reminders even when the app is closed."
        />
      </ul>
    </div>
  );
}
