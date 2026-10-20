// Near-duplicate detection for Coach task queues: "Check Reddit replies" and "Check replies on Reddit" are one task.
const STOP = new Set([
  "the",
  "a",
  "an",
  "to",
  "on",
  "in",
  "of",
  "for",
  "and",
  "your",
  "my",
  "at",
  "with",
  "any",
  "new",
  "again",
  "r",
]);
export function taskTokens(s: string): Set<string> {
  return new Set(
    String(s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/(ies)$/, "y").replace(/(s)$/, ""))
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}
function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
}
export type TaskSig = { title: string; destination?: string | null; action?: string | null };
/** True when two tasks would have the member do the same thing in the same place. */
export function isNearDuplicate(a: TaskSig, b: TaskSig): boolean {
  const ta = taskTokens(a.title),
    tb = taskTokens(b.title);
  const titleSim = jaccard(ta, tb);
  const da = taskTokens(a.destination ?? ""),
    db = taskTokens(b.destination ?? "");
  const sameDest = da.size > 0 && db.size > 0 && jaccard(da, db) >= 0.5;
  const actSim = jaccard(
    taskTokens(`${a.title} ${a.action ?? ""}`),
    taskTokens(`${b.title} ${b.action ?? ""}`),
  );
  if (titleSim >= 0.75) return true;
  if (sameDest && (titleSim >= 0.4 || actSim >= 0.45)) return true;
  // No destination given: the destination name usually sits in the title ("Check Reddit replies").
  if (!da.size && !db.size && titleSim >= 0.5) return true;
  return false;
}
