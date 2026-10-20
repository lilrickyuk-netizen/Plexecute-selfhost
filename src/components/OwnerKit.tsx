import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ownerAnalytics, ownerIntelligence } from "@/lib/owner.functions";

export const NA = "Not yet available";
export const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 1000) / 10}%` : NA);
export const gbpOr = (p: number | null | undefined) =>
  p == null ? NA : `£${(p / 100).toFixed(2)}`;
export const nice = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export const RANGE_LABELS = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  service_month: "This service month",
  prev_service_month: "Previous service month",
  quarter: "This quarter",
  year: "This year",
  custom: "Custom range",
} as const;
export type RangeKey = keyof typeof RANGE_LABELS;

const sel = "mt-1 h-10 rounded-md border border-border bg-background px-2";
export function useRange() {
  const [range, setRange] = useState<RangeKey>("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const custom = range === "custom" && from && to;
  const input = {
    range,
    ...(custom ? { from: new Date(from).toISOString(), to: new Date(to).toISOString() } : {}),
  };
  const picker = (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="block text-muted-foreground">Period</span>
        <select
          className={sel}
          value={range}
          onChange={(e) => setRange(e.target.value as RangeKey)}
        >
          {Object.entries(RANGE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {range === "custom" && (
        <>
          <label className="text-sm">
            <span className="block text-muted-foreground">From</span>
            <input
              type="date"
              className={sel}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="block text-muted-foreground">To</span>
            <input type="date" className={sel} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </>
      )}
    </div>
  );
  return { input, picker, key: [range, from, to] };
}

export function useAnalytics() {
  const fn = useServerFn(ownerAnalytics);
  const r = useRange();
  const q = useQuery({
    queryKey: ["owner-analytics", ...r.key],
    queryFn: () => fn({ data: r.input }),
  });
  return { ...q, picker: r.picker };
}

export function useIntelligence() {
  const fn = useServerFn(ownerIntelligence);
  const r = useRange();
  return useQuery({ queryKey: ["owner-intel", ...r.key], queryFn: () => fn({ data: r.input }) });
}

export function Shell({
  picker,
  error,
  loading,
  children,
}: {
  picker: ReactNode;
  error: unknown;
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      {picker}
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {Boolean(error) && <p className="text-sm text-destructive">Couldn't load these figures.</p>}
      {children}
    </div>
  );
}

export function Grid({
  title,
  children,
  note,
}: {
  title: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}

export function Table({
  head,
  rows,
  empty = "No data yet.",
}: {
  head: string[];
  rows: ReactNode[][];
  empty?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2">
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={head.length} className="px-3 py-6 text-center text-muted-foreground">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export const countsRows = (o: Record<string, number>) =>
  Object.entries(o)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => [nice(k), v]);
