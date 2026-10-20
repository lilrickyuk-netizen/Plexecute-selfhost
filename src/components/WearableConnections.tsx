import { useEffect, useState } from "react";
import { PaidGate } from "@/components/PaidGate";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  disconnectWearableFn,
  getWearableState,
  startWearableConnect,
  syncWearableNow,
} from "@/lib/wearables.functions";
import { ADAPTERS, WEARABLES, type Wearable } from "@/lib/wearables";

const STATUS: Record<string, string> = {
  active: "Connected",
  degraded: "Needs attention, retrying",
  revoked: "Access removed, reconnect",
};
const RETURN: Record<string, string> = {
  connected: "Connected.",
  declined: "You cancelled the connection.",
  invalid: "That connection link expired. Try again.",
  failed: "It couldn't be connected. Try again.",
  not_configured: "That connection isn't switched on yet.",
};
const when = (s: string) =>
  new Date(s).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function WearableConnections() {
  return (
    <PaidGate cap="premium_wearables">
      <WearableConnectionsInner />
    </PaidGate>
  );
}

function WearableConnectionsInner() {
  const qc = useQueryClient();
  const get = useServerFn(getWearableState),
    start = useServerFn(startWearableConnect),
    sync = useServerFn(syncWearableNow),
    disc = useServerFn(disconnectWearableFn);
  const { data: s } = useQuery({ queryKey: ["wearables"], queryFn: () => get() });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("wearable");
    if (r && RETURN[r]) (r === "connected" ? toast.success : toast.error)(RETURN[r]);
  }, []);
  async function run(f: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await f();
      if (ok) toast.success(ok);
      qc.invalidateQueries({ queryKey: ["wearables"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  async function connect(p: Wearable) {
    setBusy(true);
    try {
      const r = await start({ data: { provider: p } });
      if (r.url) window.location.href = r.url;
      else toast.error("That connection isn't switched on yet.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="wearables" className="space-y-3">
      <div>
        <Label>Wearables and fitness apps</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Each reading keeps the name of the service it came from. Readiness or recovery scores from
          different devices are never combined into one number.
        </p>
      </div>
      <ul className="divide-y divide-border rounded-[14px] border border-border">
        {WEARABLES.map((p) => {
          const c = s?.connections.find((x) => x.provider === p),
            on = s?.configured[p];
          return (
            <li key={p} className="space-y-2 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium">{ADAPTERS[p].name}</span>
                  <span className="block text-xs text-muted-foreground">{ADAPTERS[p].data}</span>
                </div>
                {c ? (
                  <span className={c.status === "active" ? "text-success" : "text-warning"}>
                    {STATUS[c.status]}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-[10px]"
                    disabled={busy || !on}
                    onClick={() => connect(p)}
                  >
                    {on ? "Connect" : "Not switched on yet"}
                  </Button>
                )}
              </div>
              {!on && ADAPTERS[p].note && !c && (
                <p className="text-xs text-muted-foreground">{ADAPTERS[p].note}</p>
              )}
              {c && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {c.last_sync_at ? `Last updated ${when(c.last_sync_at)}` : "Not updated yet"}
                    {c.stale ? " · may be out of date" : ""}
                  </p>
                  {c.last_error && <p className="text-xs text-warning">{c.last_error}</p>}
                  <div className="flex flex-wrap gap-2">
                    {c.status === "revoked" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-[10px]"
                        disabled={busy || !on}
                        onClick={() => connect(p)}
                      >
                        Reconnect
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-[10px]"
                        disabled={busy}
                        onClick={() => run(() => sync({ data: { id: c.id } }), "Updated.")}
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
                          () => disc({ data: { id: c.id, deleteData: false } }),
                          "Disconnected. Access removed.",
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
                          () => disc({ data: { id: c.id, deleteData: true } }),
                          "Disconnected and data deleted.",
                        )
                      }
                    >
                      Disconnect and delete data
                    </Button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
