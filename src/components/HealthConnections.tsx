import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  connectHealth,
  deleteHealthSource,
  getHealthState,
  revokeHealth,
  updateHealthPermissions,
} from "@/lib/health.functions";
import {
  CATEGORY_LABEL,
  HEALTH_CATEGORIES,
  HEALTH_PLATFORMS,
  PLATFORM_INFO,
  type HealthCategory,
  type HealthPlatform,
} from "@/lib/health";

const SRC: Record<string, string> = {
  apple_health: "Apple Health",
  health_connect: "Health Connect",
  shortcut: "Shortcut",
  other: "Other",
};
const when = (s: string) =>
  new Date(s).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function HealthConnections({ origin }: { origin: string }) {
  const qc = useQueryClient();
  const get = useServerFn(getHealthState),
    conn = useServerFn(connectHealth),
    upd = useServerFn(updateHealthPermissions),
    rev = useServerFn(revokeHealth),
    del = useServerFn(deleteHealthSource);
  const { data: s } = useQuery({ queryKey: ["health-conns"], queryFn: () => get() });
  const [platform, setPlatform] = useState<HealthPlatform>("apple_health");
  const [cats, setCats] = useState<HealthCategory[]>([]);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["health-conns"] });
  async function run<T>(f: () => Promise<T>, ok?: string) {
    setBusy(true);
    try {
      const r = await f();
      if (ok) toast.success(ok);
      refresh();
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  const toggle = (list: string[], c: string) =>
    (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]) as HealthCategory[];

  return (
    <div className="space-y-4">
      <div>
        <Label>Health data (Apple Health / Health Connect)</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Phones only share health data with apps installed on the phone, so this website can't read
          it directly. You choose exactly which kinds of data to share; anything else is refused.
          Your food log stays separate, and health data is never used for advertising or upgrade
          offers.
        </p>
      </div>

      <div className="space-y-3 rounded-[14px] border border-border p-4">
        <div className="flex flex-wrap gap-4 text-sm">
          {HEALTH_PLATFORMS.map((p) => (
            <label key={p} className="flex items-center gap-2">
              <input
                type="radio"
                name="hp"
                checked={platform === p}
                onChange={() => setPlatform(p)}
              />
              {PLATFORM_INFO[p].name}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Needs {PLATFORM_INFO[platform].needs}. Not available in this web version on its own.
        </p>
        <fieldset className="grid grid-cols-2 gap-2 text-sm">
          <legend className="mb-1 text-xs font-medium">What to share</legend>
          {HEALTH_CATEGORIES.map((c) => (
            <label key={c} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={cats.includes(c)}
                onChange={() => setCats(toggle(cats, c))}
              />
              {CATEGORY_LABEL[c]}
            </label>
          ))}
        </fieldset>
        <Button
          variant="outline"
          className="rounded-[10px]"
          disabled={busy || !cats.length}
          onClick={async () => {
            const r = await run(
              () => conn({ data: { platform, categories: cats } }),
              "Connection key created.",
            );
            if (r) setKey(r.key);
          }}
        >
          Create connection key
        </Button>
        {key && (
          <div className="space-y-1">
            <p className="text-xs">
              Copy this key into the app now. It is shown only once. Data goes to{" "}
              <code>{origin}/api/public/health/ingest</code>.
            </p>
            <div className="flex gap-2">
              <Input aria-label="Connection key" readOnly value={key} />
              <Button
                variant="outline"
                className="rounded-[10px]"
                onClick={() => {
                  navigator.clipboard.writeText(key);
                  toast.success("Copied.");
                }}
              >
                Copy
              </Button>
            </div>
          </div>
        )}
      </div>

      {(s?.connections.length ?? 0) > 0 && (
        <ul className="divide-y divide-border rounded-[14px] border border-border">
          {s!.connections.map((c) => (
            <li key={c.id} className="space-y-2 px-4 py-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-medium">
                  {PLATFORM_INFO[c.platform as HealthPlatform].name}
                </span>
                <span className={c.last_received_at ? "text-success" : "text-muted-foreground"}>
                  {c.last_received_at
                    ? `Last data ${when(c.last_received_at)}`
                    : "Waiting for first data"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs">
                {HEALTH_CATEGORIES.map((k) => (
                  <label key={k} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={c.categories.includes(k)}
                      onChange={() =>
                        run(
                          () => upd({ data: { id: c.id, categories: toggle(c.categories, k) } }),
                          "Sharing updated.",
                        )
                      }
                    />
                    {CATEGORY_LABEL[k]}
                  </label>
                ))}
              </div>
              {c.rejected_count > 0 && (
                <p className="text-xs text-muted-foreground">
                  {c.rejected_count} readings refused because you haven't allowed that kind of data.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-[10px]"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => rev({ data: { id: c.id, deleteData: false } }),
                      "Disconnected. The key no longer works.",
                    )
                  }
                >
                  Disconnect, keep data
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-[10px]"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => rev({ data: { id: c.id, deleteData: true } }),
                      "Disconnected and data deleted.",
                    )
                  }
                >
                  Disconnect and delete data
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {s && Object.keys(s.bySource).length > 0 && (
        <div className="text-xs">
          <p className="font-medium">Stored health readings</p>
          <ul className="mt-1 space-y-1">
            {Object.entries(s.bySource).map(([src, n]) => (
              <li key={src} className="flex items-center justify-between gap-2">
                <span>
                  {SRC[src] ?? src}: {n}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => run(() => del({ data: { source: src } }), "Deleted.")}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
