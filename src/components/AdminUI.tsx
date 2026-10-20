import type { ReactNode } from "react";

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[14px] border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl">{value}</p>
    </div>
  );
}

const NAMES: Record<string, string> = {
  apple_health: "Apple Health",
  health_connect: "Health Connect",
  google: "Google Calendar",
  microsoft: "Outlook Calendar",
  whoop: "WHOOP",
  oura: "Oura",
  fitbit: "Fitbit",
  strava: "Strava",
  garmin: "Garmin",
  stripe: "Payments (Stripe)",
  twilio: "Phone calls (Twilio)",
  resend: "Email (Resend)",
  firecrawl: "Web research (Firecrawl)",
  openai: "Voice AI (OpenAI)",
  fatsecret: "Food data (FatSecret)",
  usda: "Food data (USDA)",
  payments: "Payments",
  calls: "Phone calls",
  email: "Email",
  scheduledRuns: "Scheduled runs",
  device: "Device import",
  ai: "Coach",
  user: "Member",
  system: "Plexecute",
};
/** Human label for a service or state key, so admin screens never show raw identifiers. */
export const niceKey = (k: string) => {
  if (NAMES[k]) return NAMES[k];
  const words = k
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[._:-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.replace(/^\w/, (c) => c.toUpperCase());
};
/** Admin-safe page name: internal request paths become a short plain label. */
export const nicePage = (route: string | null | undefined) =>
  !route ? "Unknown page" : route.startsWith("/_serverFn") ? "Background request" : route;

export function Tally({
  title,
  data,
}: {
  title: string;
  data: Record<string, number> | undefined;
}) {
  const rows = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <section className="rounded-[14px] border border-border bg-card p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">None yet.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {rows.map(([k, v]) => (
            <li key={k} className="flex justify-between gap-3">
              <span className="text-muted-foreground">{niceKey(k)}</span>
              <span>{v}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-2xl font-semibold">{title}</h2>
        {note && <p className="mt-1 text-sm text-muted-foreground">{note}</p>}
      </header>
      {children}
    </div>
  );
}

export const Loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;
