import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  dismiss,
  enqueue,
  flush,
  isNetworkFailure,
  type Op,
  type OpKind,
  type Store,
} from "./outbox";
import { transitionPlanBlock } from "./planning.functions";
import { logWorkoutSet } from "./training.functions";
import { logFood } from "./nutrition.functions";

const KEY = "plexecute.outbox.v1";
const listeners = new Set<() => void>();
let cache: Op[] | null = null;
export const outboxStore: Store = {
  get() {
    if (cache) return cache;
    try {
      cache = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Op[];
    } catch {
      cache = [];
    }
    return cache;
  },
  set(ops) {
    cache = ops;
    localStorage.setItem(KEY, JSON.stringify(ops));
    listeners.forEach((l) => l());
  },
};
const EMPTY: Op[] = [];
export function useOutbox() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => outboxStore.get(),
    () => EMPTY,
  );
}
export const dismissOp = (id: string) => dismiss(outboxStore, id);
export const newOpId = () => crypto.randomUUID();

/** Sends now when possible; on a network failure the action is queued with the same id and replayed later. */
export async function sendOrQueue<T>(
  kind: OpKind,
  payload: Record<string, unknown>,
  id: string,
  send: () => Promise<T>,
): Promise<{ queued: true } | { queued: false; result: T }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    enqueue(outboxStore, kind, payload, id);
    return { queued: true };
  }
  try {
    return { queued: false, result: await send() };
  } catch (e) {
    if (isNetworkFailure(e, navigator.onLine)) {
      enqueue(outboxStore, kind, payload, id);
      return { queued: true };
    }
    throw e;
  }
}

/** Mounted once in the app shell: replays the outbox when the connection returns. */
export function useOutboxSync() {
  const qc = useQueryClient();
  const tr = useServerFn(transitionPlanBlock);
  const set = useServerFn(logWorkoutSet);
  const food = useServerFn(logFood);
  useEffect(() => {
    let running = false;
    const run = async () => {
      if (running || !navigator.onLine || !outboxStore.get().some((o) => o.state === "pending"))
        return;
      running = true;
      try {
        const r = await flush(
          outboxStore,
          (op) => {
            const p = op.payload as never;
            if (op.kind === "transition")
              return tr({ data: { ...(p as object), idempotencyKey: op.id } as never });
            if (op.kind === "set")
              return set({
                data: {
                  ...(p as object),
                  clientOpId: op.id,
                  clientRecordedAt: op.createdAt,
                } as never,
              });
            return food({
              data: {
                ...(p as object),
                clientOpId: op.id,
                clientRecordedAt: op.createdAt,
              } as never,
            });
          },
          () => navigator.onLine,
        );
        if (r.sent) {
          toast.success(`Synced ${r.sent} offline ${r.sent === 1 ? "change" : "changes"}.`);
          qc.invalidateQueries();
        }
        if (r.conflicts)
          toast.error(
            "Some offline changes couldn't be applied. See the note at the top of the page.",
          );
      } finally {
        running = false;
      }
    };
    run();
    window.addEventListener("online", run);
    const t = setInterval(run, 30000);
    return () => {
      window.removeEventListener("online", run);
      clearInterval(t);
    };
  }, [qc, tr, set, food]);
}

/** Cached-read helper for Today: last good copy is kept on the device. */
export function readCache<T>(key: string): T | undefined {
  try {
    const v = localStorage.getItem(`plexecute.cache.${key}`);
    return v ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
}
export function writeCache(key: string, v: unknown) {
  try {
    localStorage.setItem(`plexecute.cache.${key}`, JSON.stringify(v));
  } catch {
    /* storage full */
  }
}
