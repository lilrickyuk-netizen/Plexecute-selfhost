// Live discovery, validation and caching of guided Yoga / Meditation videos.
// Videos are only ever linked or embedded from the original provider (YouTube); nothing is re-hosted.
import { assertAllowedOutbound } from "./security";
import {
  focusOf,
  rankChoices,
  snapMinutes,
  type Activity,
  type VideoCandidate,
  type VideoChoice,
} from "./guided-video";

type Db = any;
const CACHE_DAYS = 7;
const REVALIDATE_HOURS = 24;

const idOf = (url: string) =>
  url.match(
    /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/,
  )?.[1] ?? null;

export async function firecrawl(
  query: string,
  userId: string,
  retry: boolean | number = 2,
  feature = "wellness_videos",
): Promise<{ url: string; title?: string }[]> {
  const key = process.env["FIRECRAWL_API_KEY"];
  if (!key) throw new Error("Video search is not switched on yet.");
  const gw = key.startsWith("lovc_");
  const lk = process.env["LOVABLE_API_KEY"];
  if (gw && !lk) throw new Error("Video search is not switched on yet.");
  const r = await fetch(
    gw
      ? "https://connector-gateway.lovable.dev/firecrawl/v2/search"
      : "https://api.firecrawl.dev/v2/search",
    {
      method: "POST",
      headers: gw
        ? {
            Authorization: `Bearer ${lk}`,
            "X-Connection-Api-Key": key,
            "Content-Type": "application/json",
          }
        : { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 15 }),
    },
  );
  await (
    await import("./usage.server")
  ).recordUsage({
    userId,
    provider: "firecrawl",
    feature,
    unit: "requests",
    quantity: 1,
    ok: r.ok,
  });
  // Provider per-minute limit: wait the advised time once (capped) and retry.
  if (r.status === 429 && retry && retry !== 0) {
    const j = (await r.json().catch(() => ({}))) as { retry_after_seconds?: number };
    await new Promise((res) => setTimeout(res, Math.min(25, j.retry_after_seconds ?? 10) * 1000));
    return firecrawl(query, userId, typeof retry === "number" ? retry - 1 : false, feature);
  }
  if (!r.ok) {
    console.error("video search failed", r.status, (await r.text()).slice(0, 300));
    throw new Error("Video search is temporarily unavailable. Try again shortly.");
  }
  const j = (await r.json()) as { data?: { web?: { url: string }[] } | { url: string }[] };
  return Array.isArray(j.data) ? j.data : (j.data?.web ?? []);
}

/** Confirms a video exists, is public and playable, and reads its real length, title and channel. */
export async function validateVideo(videoId: string): Promise<VideoCandidate | null> {
  const watch = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const o = `https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`;
    assertAllowedOutbound(o);
    const or = await fetch(o);
    if (!or.ok) return null;
    const meta = (await or.json()) as { title?: string; author_name?: string };
    assertAllowedOutbound(watch);
    const html = await (
      await fetch(watch, { headers: { "Accept-Language": "en-GB,en;q=0.8" } })
    ).text();
    const secs = Number(html.match(/"lengthSeconds":"(\d+)"/)?.[1] ?? 0);
    const status = html.match(/"playabilityStatus":\{"status":"([A-Z_]+)"/)?.[1];
    if (!meta.title || (status && status !== "OK")) return null;
    // YouTube sometimes answers the watch page with a bot check; oEmbed still proves the video
    // is public and embeddable, but its length is then unknown (seconds 0), which wellness
    // matching rejects and exercise demos label as unconfirmed.
    const blocked = !secs && !status;
    if (!secs && !blocked) return null;
    return {
      videoId,
      url: watch,
      title: meta.title,
      creator: meta.author_name ?? "YouTube creator",
      platform: "YouTube",
      seconds: secs,
      embeddable: blocked ? true : /"playableInEmbed":true/.test(html),
      verifiedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function discover(activity: Activity, focus: string, minutes: number, userId: string) {
  const fo = focusOf(activity, focus)!;
  const base =
    activity === "yoga"
      ? `${minutes} minute ${fo.query} yoga`
      : `${minutes} minute guided ${fo.query} meditation`;
  const ids = new Set<string>();
  for (const q of [`${base} youtube`, `${base} for beginners site:youtube.com`]) {
    for (const p of await firecrawl(q, userId)) {
      const id = idOf(p.url);
      if (id) ids.add(id);
    }
    if (ids.size >= 10) break;
  }
  const checked = await Promise.all([...ids].slice(0, 18).map(validateVideo));
  return checked.filter((x): x is VideoCandidate => !!x);
}

async function preferences(db: Db, userId: string) {
  const { data } = await db
    .from("wellness_sessions")
    .select("video,feedback")
    .eq("user_id", userId)
    .not("feedback", "is", null)
    .order("created_at", { ascending: false })
    .limit(60);
  const rows = (data ?? []) as {
    video: { creator?: string; videoId?: string } | null;
    feedback: string;
  }[];
  const count = (fb: string) => {
    const m = new Map<string, number>();
    for (const r of rows)
      if (r.feedback === fb && r.video?.creator)
        m.set(r.video.creator, (m.get(r.video.creator) ?? 0) + 1);
    return m;
  };
  const bad = count("not_for_me");
  const good = count("helpful");
  return {
    // One "not for me" hides that video; two for a creator stops prioritising them.
    avoidVideos: rows
      .filter((r) => r.feedback === "not_for_me" && r.video?.videoId)
      .map((r) => r.video!.videoId!),
    avoidCreators: [...bad].filter(([, n]) => n >= 2).map(([c]) => c),
    likedCreators: [...good].filter(([, n]) => n >= 1).map(([c]) => c),
  };
}

/** Same path for screens, planned sessions and Coach. Cached per combination; live search only when needed. */
export async function findGuidedVideos(
  admin: Db,
  userId: string,
  input: { activity: Activity; focus: string; minutes: number },
): Promise<{ choices: VideoChoice[]; source: "cache" | "live"; refreshedAt: string }> {
  const minutes = snapMinutes(input.activity, input.minutes);
  if (!focusOf(input.activity, input.focus)) throw new Error("Unknown focus.");
  const sel = { activity: input.activity, focus: input.focus, minutes };
  const key = `${sel.activity}:${sel.focus}:${minutes}`;
  const pref = await preferences(admin, userId);
  const { data: row } = await admin
    .from("guided_video_cache")
    .select("*")
    .eq("key", key)
    .maybeSingle();
  const age = row ? Date.now() - new Date(row.refreshed_at).getTime() : Infinity;
  let cands = (row?.candidates ?? []) as VideoCandidate[];
  let source: "cache" | "live" = "cache";
  let refreshedAt: string = row?.refreshed_at ?? new Date().toISOString();

  let choices = age < CACHE_DAYS * 864e5 ? rankChoices(cands, sel, pref) : [];
  // Re-check links served from an older cache so removed videos are never shown.
  if (choices.length && age > REVALIDATE_HOURS * 36e5) {
    const ok = await Promise.all(choices.map((c) => validateVideo(c.videoId)));
    const dead = choices.filter((_, i) => !ok[i]).map((c) => c.videoId);
    if (dead.length) {
      cands = cands.filter((c) => !dead.includes(c.videoId));
      choices = rankChoices(cands, sel, pref);
    }
  }
  if (choices.length < 3) {
    const fresh = await discover(sel.activity, sel.focus, minutes, userId);
    const merged = new Map<string, VideoCandidate>();
    for (const c of [...fresh, ...cands]) if (!merged.has(c.videoId)) merged.set(c.videoId, c);
    cands = [...merged.values()].slice(0, 30);
    refreshedAt = new Date().toISOString();
    await admin.from("guided_video_cache").upsert({
      key,
      activity: sel.activity,
      focus: sel.focus,
      minutes,
      candidates: cands,
      refreshed_at: refreshedAt,
    });
    choices = rankChoices(cands, sel, pref);
    source = "live";
  }
  return { choices, source, refreshedAt };
}

/** Adds a recurring Yoga / Meditation practice as an ordinary wellness goal the planner schedules. */
export async function addPracticeGoal(
  db: Db,
  userId: string,
  p: { activity: Activity; focus: string; minutes: number; perWeek: number; time: string },
) {
  const fo = focusOf(p.activity, p.focus);
  if (!fo) throw new Error("Unknown focus.");
  const minutes = snapMinutes(p.activity, p.minutes);
  const title = `${p.activity === "yoga" ? "Yoga" : "Meditation"}: ${fo.label} · ${minutes} min`;
  const goal = {
    title,
    domain: "wellness",
    weekly_minutes: minutes * p.perWeek,
    minimum_weekly_minutes: minutes * Math.min(2, p.perWeek),
    session_minutes: minutes,
    preferred_time: p.time,
    status: "active",
  };
  const { data: existing } = await db
    .from("goals")
    .select("id")
    .eq("user_id", userId)
    .eq("domain", "wellness")
    .eq("title", title)
    .maybeSingle();
  if (existing) {
    await db.from("goals").update(goal).eq("id", existing.id);
    return { id: existing.id as string, title, created: false };
  }
  const { data, error } = await db
    .from("goals")
    .insert({ ...goal, user_id: userId, priority: 3, why: "Guided practice added from Wellness." })
    .select("id")
    .single();
  if (error || !data)
    throw new Error(
      /limit|free/i.test(error?.message ?? "")
        ? "The Free plan goal limit is reached."
        : "The practice could not be added.",
    );
  return { id: data.id as string, title, created: true };
}
