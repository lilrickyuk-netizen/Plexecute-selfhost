import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPushDiagnostics } from "@/lib/notify.functions";
import { inspectPushDevice } from "@/lib/web-push-client";

const time = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-GB") : "None recorded";

export function PushDeviceDiagnostics() {
  const load = useServerFn(getPushDiagnostics);
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["notification-settings", "current-device"],
    queryFn: async () => {
      const local = await inspectPushDevice();
      const saved = await load({ data: { token: local.token } });
      return {
        ...saved,
        permission: local.permission,
        workerActive: local.workerActive,
        subscribed: local.subscribed,
      };
    },
    refetchInterval: 30000,
  });
  const entries = data
    ? [
        ["Device subscribed", data.subscribed && data.device?.status === "active" ? "Yes" : "No"],
        ["Permission", data.permission],
        ["Notification worker active", data.workerActive ? "Yes" : "No"],
        ["Subscription created", time(data.device?.created_at)],
        ["Saved device state", data.device?.status ?? "Not registered"],
        ["Sending switched on", data.configured ? "Yes" : "No"],
        ["Last notification scheduled", time(data.lastScheduled)],
        ["Last dispatch attempt", time(data.lastAttempt)],
        [
          "This device delivery",
          data.deviceAttempt
            ? data.deviceAttempt.ok
              ? "Accepted by push service — phone receipt not verified"
              : "Failed"
            : "No device-specific attempt recorded",
        ],
        ["Failure reason", data.lastError ?? "None recorded"],
      ]
    : [];
  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">This device · notification diagnostics</h4>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Refresh notification diagnostics"
          title="Refresh notification diagnostics"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          Could not check this device. Try again.
        </p>
      ) : !data ? (
        <p className="text-xs text-muted-foreground">Checking this device…</p>
      ) : (
        <dl className="mt-2 space-y-2 text-xs">
          {entries.map(([label, value]) => (
            <div key={label} className="grid grid-cols-2 gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        iPhone/iPad: iOS 16.4+ and Home Screen installation required. Android: installation is not
        required in supported browsers. Both need notification permission; offline, force-stop,
        Focus or battery restrictions can delay or block receipt.
      </p>
    </div>
  );
}
