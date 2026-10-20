import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminIntegrations } from "@/lib/admin-console.functions";
import { Stat, Tally, Section, Loading, niceKey } from "@/components/AdminUI";
import { AppHealth } from "@/components/AppHealth";

export function IntegrationsPanel() {
  const fn = useServerFn(adminIntegrations);
  const { data, error } = useQuery({ queryKey: ["admin-integrations"], queryFn: () => fn() });
  return (
    <Section
      title="Integrations"
      note="Which services have their keys added, and connection states across members."
    >
      {error && <p className="text-sm text-destructive">Couldn't load this section.</p>}
      {!data ? (
        <Loading />
      ) : (
        <>
          <ul className="space-y-1 text-sm">
            {Object.entries(data.configured).map(([k, on]) => (
              <li key={k}>
                {on ? "✓ Keys added" : "○ Not switched on"} · {niceKey(k)}
              </li>
            ))}
          </ul>
          <div className="grid gap-3 md:grid-cols-3">
            {[
              ["Calendars", data.calendars],
              ["Wearables", data.wearables],
              ["Health apps", data.healthApps],
            ].map(([t, g]) =>
              Object.entries(g as Record<string, Record<string, number>>).length === 0 ? (
                <Tally key={t as string} title={t as string} data={{}} />
              ) : (
                Object.entries(g as Record<string, Record<string, number>>).map(([p, st]) => (
                  <Tally key={`${t}-${p}`} title={`${t}: ${niceKey(p)}`} data={st} />
                ))
              ),
            )}
          </div>
          <AppHealth />
        </>
      )}
    </Section>
  );
}
