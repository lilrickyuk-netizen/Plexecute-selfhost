import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getCallManifest,
  saveCallMarket,
  setCallKillSwitch,
} from "@/lib/call-compliance.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

type Row = Awaited<ReturnType<typeof getCallManifest>>["rows"][number];
const blank = (country: string): Row => ({
  country,
  enabled: false,
  killed: false,
  signed_off_by: null,
  signed_off_at: null,
  review_ref: null,
  approval_basis: "not_reviewed",
  permitted_start: "09:00",
  permitted_end: "20:00",
  consent_version: null,
  disclosure_version: null,
  max_attempts_per_occurrence: 3,
  max_per_24h: 12,
  pro_retry_allowed: true,
  min_answer_rate: 0.2,
  notes: null,
  updated_by: null,
  created_at: "",
  updated_at: "",
});

export function CallMarkets() {
  const load = useServerFn(getCallManifest);
  const kill = useServerFn(setCallKillSwitch);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["call-manifest"], queryFn: () => load() });
  const [add, setAdd] = useState("");
  const [extra, setExtra] = useState<string[]>([]);
  if (!data) return null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["call-manifest"] });
  const global = data.rows.find((r) => r.country === "GLOBAL");
  const markets = [
    ...data.rows.filter((r) => r.country !== "GLOBAL"),
    ...extra.filter((c) => !data.rows.some((r) => r.country === c)).map(blank),
  ];
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Call countries</h2>
      <p className="text-xs text-muted-foreground">
        Automated calls only run in countries switched on here after legal sign-off. Adding phone
        service keys never turns calls on by itself.
      </p>
      <div className="flex items-center justify-between rounded-[14px] border border-border bg-card p-4 text-sm">
        <div>
          <div className="font-medium">Stop calls everywhere</div>
          <div className="text-xs text-muted-foreground">Cancels waiting calls straight away.</div>
        </div>
        <Switch
          aria-label="Stop calls everywhere"
          checked={!!global?.killed}
          onCheckedChange={async (v) => {
            const r = await kill({ data: { country: "GLOBAL", killed: v } });
            toast.success(
              v ? `Calls stopped everywhere (${r.cancelled} cancelled)` : "Global stop lifted",
            );
            refresh();
          }}
        />
      </div>
      {markets.map((r) => (
        <MarketForm
          key={r.country + r.updated_at}
          row={r}
          current={data.current}
          onDone={refresh}
        />
      ))}
      <div className="flex gap-2">
        <Input
          aria-label="Country code"
          placeholder="Country code, e.g. GB"
          maxLength={2}
          value={add}
          onChange={(e) => setAdd(e.target.value.toUpperCase())}
        />
        <Button
          variant="outline"
          className="rounded-[10px]"
          disabled={!/^[A-Z]{2}$/.test(add)}
          onClick={() => {
            setExtra([...extra, add]);
            setAdd("");
          }}
        >
          Add country
        </Button>
      </div>
    </section>
  );
}

function MarketForm({
  row,
  current,
  onDone,
}: {
  row: Row;
  current: { consent: string; disclosure: string };
  onDone: () => void;
}) {
  const save = useServerFn(saveCallMarket);
  const kill = useServerFn(setCallKillSwitch);
  const [f, setF] = useState<Row>({
    ...row,
    permitted_start: row.permitted_start?.slice(0, 5) ?? "09:00",
    permitted_end: row.permitted_end?.slice(0, 5) ?? "20:00",
    consent_version: row.consent_version ?? current.consent,
    disclosure_version: row.disclosure_version ?? current.disclosure,
    max_attempts_per_occurrence: row.max_attempts_per_occurrence ?? 3,
    max_per_24h: row.max_per_24h ?? 12,
    min_answer_rate: row.min_answer_rate ?? 0.2,
  });
  const basis = !f.signed_off_by
    ? "Not reviewed"
    : f.review_ref
      ? "Externally reviewed"
      : "Owner approved";
  const txt = (
    k: "signed_off_by" | "review_ref" | "consent_version" | "disclosure_version" | "notes",
    label: string,
    ph?: string,
  ) => (
    <label className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        aria-label={`${row.country} ${label}`}
        placeholder={ph}
        value={f[k] ?? ""}
        onChange={(e) => setF({ ...f, [k]: e.target.value || null })}
      />
    </label>
  );
  const num = (k: "max_attempts_per_occurrence" | "max_per_24h", label: string, max: number) => (
    <label className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        aria-label={`${row.country} ${label}`}
        type="number"
        min={1}
        max={max}
        value={f[k] ?? ""}
        onChange={(e) => setF({ ...f, [k]: e.target.value ? Number(e.target.value) : null })}
      />
    </label>
  );
  return (
    <div className="space-y-3 rounded-[14px] border border-border bg-card p-4 text-sm">
      <div className="flex items-center justify-between">
        <div className="font-display text-lg">{row.country}</div>
        <div className="flex items-center gap-4 text-xs">
          <label className="flex items-center gap-2">
            Calls on
            <Switch
              aria-label={`${row.country} calls on`}
              checked={f.enabled}
              onCheckedChange={(v) => setF({ ...f, enabled: v })}
            />
          </label>
          <label className="flex items-center gap-2 text-destructive">
            Stop now
            <Switch
              aria-label={`${row.country} stop now`}
              checked={row.killed}
              onCheckedChange={async (v) => {
                const r = await kill({ data: { country: row.country, killed: v } });
                toast.success(
                  v ? `Calls stopped in ${row.country} (${r.cancelled} cancelled)` : "Stop lifted",
                );
                onDone();
              }}
            />
          </label>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-center justify-between gap-2 pt-5 text-xs">
          {f.signed_off_by
            ? `Signed off by owner: ${f.signed_off_by}`
            : "I approve this as the owner"}
          <Switch
            aria-label={`${row.country} owner approval`}
            checked={!!f.signed_off_by}
            onCheckedChange={(v) => setF({ ...f, signed_off_by: v ? "Owner" : null })}
          />
        </label>
        {txt("review_ref", "Approval reference (optional)", "e.g. Owner self-review")}
        {txt("consent_version", "Approved consent version", current.consent)}
        {txt("disclosure_version", "Approved call opening version", current.disclosure)}
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Calls allowed from</span>
          <Input
            type="time"
            aria-label={`${row.country} allowed from`}
            value={f.permitted_start ?? ""}
            onChange={(e) => setF({ ...f, permitted_start: e.target.value || null })}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Calls allowed until</span>
          <Input
            type="time"
            aria-label={`${row.country} allowed until`}
            value={f.permitted_end ?? ""}
            onChange={(e) => setF({ ...f, permitted_end: e.target.value || null })}
          />
        </label>
        {num("max_attempts_per_occurrence", "Most tries per session (max 6)", 6)}
        {num("max_per_24h", "Most calls per 24 hours (max 12)", 12)}
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">
            Lowest answer rate before pausing (%)
          </span>
          <Input
            type="number"
            min={0}
            max={100}
            aria-label={`${row.country} answer rate`}
            value={f.min_answer_rate == null ? "" : Math.round(Number(f.min_answer_rate) * 100)}
            onChange={(e) =>
              setF({ ...f, min_answer_rate: e.target.value ? Number(e.target.value) / 100 : null })
            }
          />
        </label>
        <label className="flex items-center justify-between gap-2 pt-5 text-xs">
          Pro second try allowed
          <Switch
            aria-label={`${row.country} pro retry`}
            checked={f.pro_retry_allowed}
            onCheckedChange={(v) => setF({ ...f, pro_retry_allowed: v })}
          />
        </label>
      </div>
      {txt("notes", "Notes")}
      <p className="text-xs text-muted-foreground">
        Approval: {basis}
        {row.signed_off_at
          ? ` · signed off ${new Date(row.signed_off_at).toLocaleString("en-GB")}`
          : ""}
        . Hours follow the called person's local time.
      </p>
      <div className="flex flex-wrap gap-2">
        {!row.enabled && (
          <Button className="rounded-[10px]" onClick={() => submit(true)}>
            Enable {row.country === "GB" ? "UK" : row.country} calling
          </Button>
        )}
        <Button variant="outline" className="rounded-[10px]" onClick={() => submit(f.enabled)}>
          Save {row.country}
        </Button>
      </div>
    </div>
  );
  async function submit(enabled: boolean) {
    const r = await save({
      data: {
        country: row.country,
        enabled,
        signed_off_by: enabled && !row.enabled ? (f.signed_off_by ?? "Owner") : f.signed_off_by,
        review_ref: f.review_ref,
        permitted_start: f.permitted_start,
        permitted_end: f.permitted_end,
        consent_version: f.consent_version,
        disclosure_version: f.disclosure_version,
        max_attempts_per_occurrence: f.max_attempts_per_occurrence,
        max_per_24h: f.max_per_24h,
        pro_retry_allowed: f.pro_retry_allowed,
        min_answer_rate: f.min_answer_rate == null ? null : Number(f.min_answer_rate),
        notes: f.notes,
      },
    });
    if (r.ok) {
      toast.success(
        enabled && !row.enabled ? `${row.country} calling enabled` : `${row.country} saved`,
      );
      onDone();
    } else toast.error(r.error ?? "Couldn't save.");
  }
}
