import { useEffect, useState } from "react";
import { dismissOp, useOutbox } from "@/lib/offline";

const LABEL = { transition: "Session update", set: "Workout set", food: "Food entry" } as const;

/** §56: shows offline state, queued changes and anything the server refused on sync. */
export function OfflineBanner() {
  const ops = useOutbox();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const up = () => setOnline(navigator.onLine);
    up();
    window.addEventListener("online", up);
    window.addEventListener("offline", up);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", up);
    };
  }, []);
  const pending = ops.filter((o) => o.state === "pending");
  const conflicts = ops.filter((o) => o.state === "conflict");
  if (online && !pending.length && !conflicts.length) return null;
  return (
    <div className="mb-4 space-y-2" role="status">
      {(!online || pending.length > 0) && (
        <p className="rounded-[10px] border border-border bg-raised p-3 text-sm">
          {!online ? "You're offline. Today shows your last synced plan. " : ""}
          {pending.length
            ? `${pending.length} ${pending.length === 1 ? "change is" : "changes are"} saved on this device and will sync automatically.`
            : "Changes you make will sync when you reconnect."}
        </p>
      )}
      {conflicts.map((c) => (
        <div
          key={c.id}
          className="flex items-start justify-between gap-3 rounded-[10px] border border-destructive/50 p-3 text-sm"
        >
          <span>
            {LABEL[c.kind]} from{" "}
            {new Date(c.createdAt).toLocaleString("en-GB", {
              dateStyle: "short",
              timeStyle: "short",
            })}{" "}
            couldn't be applied: {c.error}
          </span>
          <button className="shrink-0 text-xs underline" onClick={() => dismissOp(c.id)}>
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
