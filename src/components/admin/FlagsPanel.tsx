import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { adminFlags, adminSetFlag } from "@/lib/admin-console.functions";
import { Section, Loading } from "@/components/AdminUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Flag = Awaited<ReturnType<typeof adminFlags>>[number];

export function FlagsPanel() {
  const fn = useServerFn(adminFlags);
  const { data } = useQuery({ queryKey: ["admin-flags"], queryFn: () => fn() });
  return (
    <Section
      title="Feature flags"
      note="Switch off a failing service or lower a limit. Flags can never change prices, skip safety checks, weaken consent or give anyone a paid feature. Every change needs a note and is logged."
    >
      {!data ? (
        <Loading />
      ) : (
        <div className="space-y-3">
          {data.map((f) => (
            <FlagRow key={f.key} f={f} />
          ))}
        </div>
      )}
    </Section>
  );
}

function FlagRow({ f }: { f: Flag }) {
  const set = useServerFn(adminSetFlag);
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [cap, setCap] = useState(f.cap?.toString() ?? "");
  const [err, setErr] = useState<string | null>(null);
  const save = async (enabled: boolean) => {
    setErr(null);
    try {
      await set({
        data: {
          key: f.key,
          enabled,
          cap: f.kind === "cap" && cap !== "" ? Number(cap) : null,
          note,
        },
      });
      setNote("");
      qc.invalidateQueries({ queryKey: ["admin-flags"] });
    } catch {
      setErr("Add a note of at least 3 characters.");
    }
  };
  return (
    <div className="rounded-[14px] border border-border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{f.label}</p>
        <span className={f.enabled ? "text-primary" : "text-destructive"}>
          {f.kind === "cap"
            ? f.enabled && f.cap != null
              ? `Capped at ${f.cap}`
              : "No cap"
            : f.enabled
              ? "On"
              : "Off"}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{f.detail}</p>
      {f.note && (
        <p className="mt-1 text-xs text-muted-foreground">
          Last note: "{f.note}" · {f.updatedAt ? new Date(f.updatedAt).toLocaleString() : ""}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {f.kind === "cap" && (
          <Input
            className="w-28"
            type="number"
            min={0}
            max={f.maxCap}
            placeholder="Cap"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            aria-label="Cap"
          />
        )}
        <Input
          className="min-w-48 flex-1"
          placeholder="Reason for change"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label={`Reason for changing ${f.label}`}
        />
        {f.kind === "cap" ? (
          <>
            <Button size="sm" onClick={() => save(true)}>
              Apply cap
            </Button>
            <Button size="sm" variant="outline" onClick={() => save(false)}>
              Remove cap
            </Button>
          </>
        ) : f.enabled ? (
          <Button size="sm" variant="destructive" onClick={() => save(false)}>
            Switch off
          </Button>
        ) : (
          <Button size="sm" onClick={() => save(true)}>
            Switch on
          </Button>
        )}
      </div>
      {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
    </div>
  );
}
