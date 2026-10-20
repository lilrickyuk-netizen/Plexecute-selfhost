import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminUnitEconomics } from "@/lib/admin-console.functions";
import { niceKey } from "@/components/AdminUI";
import { Button } from "@/components/ui/button";

const UNIT: Record<string, string> = {
  input_tokens: "input tokens",
  output_tokens: "output tokens",
  requests: "requests",
  messages: "messages",
  attempts: "call attempts",
  billed_seconds: "billed call seconds",
  connected_seconds: "connected call seconds",
  voice_seconds: "live voice seconds",
};

const service = (p: string) =>
  p.startsWith("lovable_ai:")
    ? `AI · ${p
        .slice(11)
        .split("/")
        .pop()!
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/^Gpt/, "GPT")}`
    : p.startsWith("voice:")
      ? `Live voice · ${niceKey(p.slice(6))}`
      : niceKey(p);

export function UnitEconomics() {
  const now = new Date();
  const [month, setMonth] = useState(
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
  );
  const fn = useServerFn(adminUnitEconomics);
  const { data, error } = useQuery({
    queryKey: ["admin-unit-econ", month],
    queryFn: () => fn({ data: { month } }),
  });

  function download() {
    if (!data) return;
    const head = [
      "service_month",
      "tier",
      "provider",
      "feature",
      "unit",
      "market",
      "platform",
      "quantity",
      "events",
      "failed",
      "members",
    ];
    const lines = [
      head.join(","),
      ...data.rows.map((r) =>
        [
          month,
          r.tier,
          r.provider,
          r.feature,
          r.unit,
          r.market,
          r.platform,
          r.quantity,
          r.events,
          r.failed,
          r.members,
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `plexecute-usage-${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="rounded-[14px] border border-border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-medium">Usage for cost review</h3>
          <p className="text-muted-foreground">
            Measured amounts by plan, service, feature, country and device. Apply each provider's
            real invoice rates to get running costs; prices are never changed from this.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs text-muted-foreground">
            Service month
            <input
              type="month"
              aria-label="Service month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="mt-1 block rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </label>
          <Button size="sm" variant="outline" disabled={!data?.rows.length} onClick={download}>
            Download CSV
          </Button>
        </div>
      </div>
      {error && <p className="mt-3 text-destructive">Couldn't load usage.</p>}
      {!data ? (
        <p className="mt-3 text-muted-foreground">Loading…</p>
      ) : data.rows.length === 0 ? (
        <p className="mt-3 text-muted-foreground">No usage recorded for this month.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Plan</th>
                <th className="pr-3">Service</th>
                <th className="pr-3">Feature</th>
                <th className="pr-3">Country</th>
                <th className="pr-3">Device</th>
                <th className="pr-3 text-right">Amount</th>
                <th className="pr-3 text-right">Failed</th>
                <th className="text-right">Members</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1 pr-3">
                    {r.tier === "none" ? "Shared (no member)" : niceKey(r.tier)}
                  </td>
                  <td className="pr-3">{service(r.provider)}</td>
                  <td className="pr-3">{niceKey(r.feature)}</td>
                  <td className="whitespace-nowrap pr-3">
                    {r.market === "unknown" ? "Not known" : r.market}
                  </td>
                  <td className="pr-3">{niceKey(r.platform)}</td>
                  <td className="pr-3 text-right">
                    {r.quantity.toLocaleString("en-GB")} {UNIT[r.unit] ?? r.unit}
                  </td>
                  <td className="pr-3 text-right">{r.failed}</td>
                  <td className="text-right">{r.members}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
