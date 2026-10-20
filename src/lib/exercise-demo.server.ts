// Verified exercise-demonstration catalogue: searched once per exact exercise variation,
// validated live, cached and reused. Videos are linked/embedded from YouTube only.
import { firecrawl, validateVideo } from "./guided-video.server";
import { DEMO_SPECS, pickDemos, type DemoCandidate } from "./exercise-demo";
import type { VideoCandidate } from "./guided-video";

type Db = any;
const REFRESH_DAYS = 30; // re-search a variation after this
const REVALIDATE_DAYS = 7; // re-check the chosen link after this
const RETRY_EMPTY_HOURS = 0.25; // when nothing suitable was found

const idOf = (url: string) =>
  url.match(
    /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/,
  )?.[1] ?? null;

export type ExerciseDemo = {
  exerciseKey: string;
  demo: (DemoCandidate & { equipment: string }) | null;
  alternates: DemoCandidate[];
  refreshedAt: string;
  source: "cache" | "live";
};

async function discover(key: string, userId: string): Promise<VideoCandidate[]> {
  const spec = DEMO_SPECS[key]!;
  const ids = new Set<string>();
  for (const q of [
    `${spec.query} youtube`,
    `${spec.query} site:youtube.com`,
    `${spec.query} tutorial youtube`,
  ]) {
    for (const p of await firecrawl(q, userId, 2, "exercise_demos")) {
      const id = idOf(p.url);
      if (id) ids.add(id);
    }
    if (ids.size >= 8) break;
  }
  const checked = await Promise.all([...ids].slice(0, 14).map(validateVideo));
  return checked.filter((x): x is VideoCandidate => !!x);
}

export async function findExerciseDemo(
  admin: Db,
  userId: string,
  key: string,
): Promise<ExerciseDemo> {
  const spec = DEMO_SPECS[key];
  if (!spec) throw new Error("No demonstration is available for this exercise.");
  const { data: row } = await admin
    .from("exercise_demo_cache")
    .select("*")
    .eq("exercise_key", key)
    .maybeSingle();
  const age = row ? Date.now() - new Date(row.refreshed_at).getTime() : Infinity;
  let cands = (row?.candidates ?? []) as VideoCandidate[];
  let picks = pickDemos(key, cands);
  const fresh = picks.length ? age < REFRESH_DAYS * 864e5 : age < RETRY_EMPTY_HOURS * 36e5;
  let source: "cache" | "live" = "cache";
  let refreshedAt: string = row?.refreshed_at ?? new Date().toISOString();

  // Re-check the top link from an older cache so a removed video is never shown.
  if (
    fresh &&
    picks.length &&
    Date.now() - new Date(picks[0]!.verifiedAt).getTime() > REVALIDATE_DAYS * 864e5
  ) {
    const ok = await validateVideo(picks[0]!.videoId);
    cands = ok
      ? cands.map((c) => (c.videoId === ok.videoId ? ok : c))
      : cands.filter((c) => c.videoId !== picks[0]!.videoId);
    picks = pickDemos(key, cands);
    await admin.from("exercise_demo_cache").update({ candidates: cands }).eq("exercise_key", key);
  }
  if (!fresh) {
    const found = await discover(key, userId);
    const merged = new Map<string, VideoCandidate>();
    for (const c of [...found, ...cands]) if (!merged.has(c.videoId)) merged.set(c.videoId, c);
    cands = [...merged.values()].slice(0, 20);
    refreshedAt = new Date().toISOString();
    await admin
      .from("exercise_demo_cache")
      .upsert({ exercise_key: key, candidates: cands, refreshed_at: refreshedAt });
    picks = pickDemos(key, cands);
    source = "live";
  }
  const top = picks[0];
  return {
    exerciseKey: key,
    demo: top ? { ...top, equipment: spec.equipment } : null,
    alternates: picks.slice(1, 3),
    refreshedAt,
    source,
  };
}
