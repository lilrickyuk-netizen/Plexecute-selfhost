import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { JOB_KINDS, canReplay, summariseJobs } from "./jobs";

async function requireAdmin(context: any) {
  const { data: roles } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  if (!(roles ?? []).some((r: { role: string }) => r.role === "admin"))
    throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Queue health for admins: counts, lag and the dead-letter list (kind, error, attempts only; no member details). */
export const getJobHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await requireAdmin(context);
    const now = new Date();
    const since = new Date(now.getTime() - 7 * 864e5).toISOString();
    const [{ data: recent }, { data: open }, { data: dead }] = await Promise.all([
      db
        .from("background_jobs")
        .select("kind,status,next_attempt_at,created_at,finished_at,duration_ms")
        .gte("created_at", since)
        .limit(20000),
      db
        .from("background_jobs")
        .select("kind,status,next_attempt_at,created_at,finished_at,duration_ms")
        .in("status", ["queued", "retrying", "running"])
        .lt("created_at", since)
        .limit(5000),
      db
        .from("background_jobs")
        .select("id,kind,attempts,last_error,finished_at")
        .eq("status", "dead")
        .order("finished_at", { ascending: false })
        .limit(50),
    ]);
    const deadIds = (dead ?? []).map((d) => d.id);
    const { data: evs } = deadIds.length
      ? await db
          .from("background_job_events")
          .select("job_id,event,attempt,created_at")
          .in("job_id", deadIds)
          .order("created_at")
          .limit(1000)
      : { data: [] };
    const history = new Map<string, { event: string; attempt: number; at: string }[]>();
    for (const e of evs ?? [])
      history.set(e.job_id, [
        ...(history.get(e.job_id) ?? []),
        { event: e.event, attempt: e.attempt, at: e.created_at },
      ]);
    const summary = summariseJobs([...(recent ?? []), ...(open ?? [])], now);
    return {
      ...summary,
      labels: Object.fromEntries(Object.entries(JOB_KINDS).map(([k, v]) => [k, v.label])),
      deadList: (dead ?? []).map((d) => ({
        ...d,
        replayable: canReplay(d.kind, "dead"),
        history: history.get(d.id) ?? [],
      })),
    };
  });

export const replayDeadJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const db = await requireAdmin(context);
    const r = await (await import("./jobs.server")).replayJob(db, data.id, context.userId);
    return { status: r.status, error: r.error ?? null };
  });
