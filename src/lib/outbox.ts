/** V3 §56 offline outbox. Pure core: every queued action carries a stable id that the server uses as its
 *  idempotency key, so replays reconcile to the original record instead of duplicating it. */
export type OpKind = "transition" | "set" | "food";
export type Op = {
  id: string;
  kind: OpKind;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  state: "pending" | "conflict";
  error?: string;
};
export type Store = { get(): Op[]; set(ops: Op[]): void };

export const MAX_ATTEMPTS = 8;

export function enqueue(
  store: Store,
  kind: OpKind,
  payload: Record<string, unknown>,
  id: string,
  now = new Date(),
): Op {
  const ops = store.get();
  const existing = ops.find((o) => o.id === id);
  if (existing) return existing;
  const op: Op = { id, kind, payload, createdAt: now.toISOString(), attempts: 0, state: "pending" };
  store.set([...ops, op]);
  return op;
}

/** Network-level failures keep the op queued; anything the server rejected becomes a visible conflict. */
export function isNetworkFailure(e: unknown, online: boolean) {
  if (!online) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return (
    e instanceof TypeError ||
    /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg)
  );
}

/** Replays pending ops in creation order. Stops at the first network failure so ordering is preserved. */
export async function flush(
  store: Store,
  send: (op: Op) => Promise<unknown>,
  online: () => boolean,
) {
  let sent = 0,
    conflicts = 0;
  for (const op of [...store.get()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (op.state !== "pending") continue;
    try {
      await send(op);
      store.set(store.get().filter((o) => o.id !== op.id));
      sent++;
    } catch (e) {
      if (isNetworkFailure(e, online())) {
        store.set(
          store.get().map((o) => (o.id === op.id ? { ...o, attempts: o.attempts + 1 } : o)),
        );
        break;
      }
      const attempts = op.attempts + 1;
      store.set(
        store.get().map((o) =>
          o.id === op.id
            ? {
                ...o,
                attempts,
                state: "conflict",
                error: e instanceof Error ? e.message : "Rejected",
              }
            : o,
        ),
      );
      conflicts++;
    }
  }
  return { sent, conflicts, pending: store.get().filter((o) => o.state === "pending").length };
}

export function dismiss(store: Store, id: string) {
  store.set(store.get().filter((o) => o.id !== id));
}
