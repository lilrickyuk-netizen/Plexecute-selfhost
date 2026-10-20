/** V3 §57 glanceable surfaces contract (widgets, lock screen, Live Activities, Watch, Wear OS, complications).
 *  Pure: the same payload feeds every surface; native renderers only lay it out. */
import { summariseToday, DAY_STATUS_LABEL, type TodayBlock } from "./today";

export const GLANCE_VERSION = 1;
/** Surfaces refresh at least this often; push events can refresh sooner. */
export const GLANCE_STALE_SEC = 15 * 60;

export type GlanceAction = "start" | "complete" | "snooze";
export type Glance = {
  version: number;
  generatedAt: string;
  staleAfter: string;
  status: string;
  statusLabel: string;
  progress: { done: number; total: number; pct: number };
  next: null | {
    id: string;
    title: string;
    lockScreenTitle: string;
    startsAt: string;
    endsAt: string;
    domain: string;
    protected: boolean;
    actions: GlanceAction[];
  };
  live: null | {
    id: string;
    title: string;
    lockScreenTitle: string;
    startedAt: string;
    endsAt: string;
    actions: GlanceAction[];
  };
  complication: string;
  safetyPaused: boolean;
};

type Block = TodayBlock & { id: string; title: string; domain: string; started_at?: string | null };

const actionsFor = (status: string, paused: boolean): GlanceAction[] =>
  paused
    ? []
    : status === "started" || status === "in_progress"
      ? ["complete"]
      : ["start", "complete", "snooze"];
const hhmm = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(
    new Date(iso),
  );

/** lockScreenTitle never reveals session detail; surfaces show it unless the device is unlocked and the user allows detail. */
export function buildGlance(
  blocks: Block[],
  opts: { now?: Date; tz: string; safetyPaused?: boolean },
): Glance {
  const now = opts.now ?? new Date();
  const s = summariseToday(blocks, now.getTime());
  const paused = !!opts.safetyPaused;
  const end = (b: Block) =>
    new Date(new Date(b.starts_at).getTime() + b.duration_min * 60000).toISOString();
  const liveB =
    (s.open as Block[]).find((b) => b.status === "started" || b.status === "in_progress") ?? null;
  const nextB = s.next as Block | null;
  const complication = liveB
    ? `Now ${hhmm(end(liveB), opts.tz)}`
    : nextB
      ? `Next ${hhmm(nextB.starts_at, opts.tz)}`
      : `${s.completed.length}/${s.total} done`;
  return {
    version: GLANCE_VERSION,
    generatedAt: now.toISOString(),
    staleAfter: new Date(now.getTime() + GLANCE_STALE_SEC * 1000).toISOString(),
    status: s.status,
    statusLabel: DAY_STATUS_LABEL[s.status],
    progress: { done: s.completed.length, total: s.total, pct: s.pct },
    next: nextB
      ? {
          id: nextB.id,
          title: nextB.title,
          lockScreenTitle: "Next session",
          startsAt: nextB.starts_at,
          endsAt: end(nextB),
          domain: nextB.domain,
          protected: !!nextB.is_protected,
          actions: actionsFor(nextB.status, paused),
        }
      : null,
    live: liveB
      ? {
          id: liveB.id,
          title: liveB.title,
          lockScreenTitle: "Session in progress",
          startedAt: liveB.started_at ?? liveB.starts_at,
          endsAt: end(liveB),
          actions: actionsFor(liveB.status, paused),
        }
      : null,
    complication,
    safetyPaused: paused,
  };
}
