import { inQuietHours, localHm, startOfLocalDay } from "@/lib/tz";
import { createFileRoute } from "@tanstack/react-router";

// Call every 5 minutes from a scheduler with header: Authorization: Bearer <CRON_SECRET>
export const Route = createFileRoute("/api/public/cron/reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const m = await import("@/lib/integrations.server");
        const secret = m.env("CRON_SECRET");
        const authHeader = request.headers.get("authorization");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let allowed = (await import("@/lib/security")).bearerMatches(authHeader, secret);
        if (!allowed) {
          // Database scheduler presents a server-only token kept in a locked table.
          const token = /^Bearer ([^\s,]+)$/.exec(authHeader ?? "")?.[1];
          if (token) {
            const { data } = await supabaseAdmin.rpc(
              "verify_cron_token" as never,
              { p_token: token } as never,
            );
            allowed = data === true;
          }
        }
        if (!allowed) {
          return new Response("Unauthorized", { status: 401 });
        }
        const origin = m.env("APP_BASE_URL") ?? new URL(request.url).origin;
        const { runTick, drainJobs } = await import("@/lib/jobs.server");
        // Single-flight per 5-minute slot. Calls run every minute from /api/public/cron/calls.
        const tick = await runTick(supabaseAdmin, "reminders", 5 * 60000, async () => {
          const { enqueueNotification, dispatchDue, queueWeeklySummaries } =
            await import("@/lib/notify.server");
          const now = new Date();
          // V3 §38 time-driven lifecycle: PLANNED/SCHEDULED -> UPCOMING -> DUE -> EXPIRED.
          const { timeStep } = await import("@/lib/execution");
          const { data: openBlocks } = await supabaseAdmin
            .from("plan_blocks")
            .select("id,user_id,status,starts_at,duration_min")
            .in("status", [
              "planned",
              "scheduled",
              "upcoming",
              "due",
              "contacting",
              "acknowledged",
              "snoozed",
            ])
            .gte("starts_at", new Date(now.getTime() - 3 * 864e5).toISOString())
            .lte("starts_at", new Date(now.getTime() + 125 * 60000).toISOString())
            .limit(2000);
          let lifecycle = 0;
          for (const ob of openBlocks ?? []) {
            const to = timeStep(ob, now);
            if (!to) continue;
            const { error: le } = await supabaseAdmin
              .from("plan_blocks")
              .update({ status: to })
              .eq("id", ob.id)
              .eq("status", ob.status);
            if (le) continue;
            lifecycle++;
            await supabaseAdmin.from("plan_block_events").insert({
              user_id: ob.user_id,
              block_id: ob.id,
              event_type: to === "expired" ? "expire" : "advance",
              from_status: ob.status,
              to_status: to,
              reason_code: "time",
              actor_type: "system",
              source_channel: "scheduler",
              idempotency_key: `time:${ob.id}:${to}:${ob.starts_at}`,
            });
          }
          const horizon = new Date(now.getTime() + 125 * 60000).toISOString();
          // V3 §39/§40: every reminder or nudge goes through the intervention engine and is logged with its reason.
          const { data: blocks } = await supabaseAdmin
            .from("plan_blocks")
            .select(
              "id,user_id,title,starts_at,duration_min,status,interruption_count,occurrence_kind,source_type",
            )
            .in("status", ["planned", "scheduled", "upcoming", "due", "snoozed"])
            .gte("starts_at", new Date(now.getTime() - 60 * 60000).toISOString())
            .lte("starts_at", horizon);
          const users = [...new Set((blocks ?? []).map((b) => b.user_id))];
          const { data: profiles } = users.length
            ? await supabaseAdmin
                .from("profiles")
                .select(
                  "id,tier,accountability_level,adaptive_daily_budget,reminders_enabled,reminder_lead_min,email_reminders,timezone,quiet_start,quiet_end,sleep_target_hours,push_muted_kinds,push_motivating,coaching_style",
                )
                .in("id", users)
            : { data: [] };
          const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
          const { toMap, reminderLeadMin } = await import("@/lib/auto-adapt");
          const { decideIntervention, INTERVENTION_POLICY_VERSION } =
            await import("@/lib/intervention");
          const { assessRecovery } = await import("@/lib/recovery-state");
          const { currentPolicy } = await import("@/lib/safety.server");
          const { localDayKey } = await import("@/lib/tz");
          const { data: permRows } = users.length
            ? await supabaseAdmin
                .from("auto_adapt_permissions")
                .select("user_id,permission,enabled")
                .in("user_id", users)
            : { data: [] };
          const permsFor = (uid: string) =>
            toMap((permRows ?? []).filter((r) => r.user_id === uid));
          const since30 = new Date(now.getTime() - 30 * 864e5).toISOString();
          const ctx = new Map<string, Awaited<ReturnType<typeof loadCtx>>>();
          async function loadCtx(uid: string, tz: string, sleepTarget: number) {
            const dayStart = startOfLocalDay(now, tz).toISOString();
            const [{ data: notes }, { data: busy }, { data: chk }, policy] = await Promise.all([
              supabaseAdmin
                .from("notifications")
                .select("block_id,kind,channel,created_at")
                .eq("user_id", uid)
                .gte("created_at", since30)
                .limit(3000),
              supabaseAdmin
                .from("plan_blocks")
                .select("id")
                .eq("user_id", uid)
                .in("status", ["started", "in_progress", "contacting"]),
              supabaseAdmin
                .from("recovery_checkins")
                .select("sleep_quality,energy,soreness,stress,ill_or_injured")
                .eq("user_id", uid)
                .eq("check_date", localDayKey(now, tz))
                .maybeSingle(),
              currentPolicy(uid),
            ]);
            // One logical intervention per block+kind, whichever channels it went to.
            const seen = new Set<string>();
            const inApp = (notes ?? []).filter(
              (n) =>
                n.kind !== "system" &&
                !seen.has(`${n.block_id}:${n.kind}`) &&
                !!seen.add(`${n.block_id}:${n.kind}`),
            );
            const adaptiveToday = inApp
              .filter((n) => n.kind === "adaptive" && n.created_at >= dayStart)
              .sort((x, y) => y.created_at.localeCompare(x.created_at));
            const nudged = new Set(
              inApp.filter((n) => n.kind === "adaptive").map((n) => n.block_id),
            );
            const remindedOnly = [
              ...new Set(
                inApp
                  .filter((n) => n.kind === "reminder" && n.block_id && !nudged.has(n.block_id))
                  .map((n) => n.block_id!),
              ),
            ];
            const { data: past } = remindedOnly.length
              ? await supabaseAdmin
                  .from("plan_blocks")
                  .select("status,started_at,starts_at")
                  .in("id", remindedOnly.slice(0, 500))
                  .lt("starts_at", now.toISOString())
              : { data: [] };
            const settled = (past ?? []).filter(
              (b) =>
                ![
                  "planned",
                  "scheduled",
                  "upcoming",
                  "due",
                  "snoozed",
                  "contacting",
                  "acknowledged",
                ].includes(b.status),
            );
            return {
              sent: new Set(inApp.map((n) => `${n.block_id}:${n.kind}`)),
              adaptiveToday: adaptiveToday.length,
              lastAdaptiveAt: adaptiveToday[0]?.created_at ?? null,
              reminderOnly: {
                n: settled.length,
                actedOn: settled.filter((b) => b.started_at || b.status === "done").length,
              },
              busy: new Set((busy ?? []).map((b) => b.id)),
              recoveryRed:
                assessRecovery({ checkin: chk ?? null, sleepTargetHours: sleepTarget }).state ===
                "RED",
              policy,
            };
          }
          let inApp = 0,
            emails = 0,
            adaptive = 0,
            declined = 0;
          for (const b of (blocks ?? []).sort((x, y) => x.starts_at.localeCompare(y.starts_at))) {
            const p = byId.get(b.user_id);
            if (!p) continue;
            if (!ctx.has(b.user_id))
              ctx.set(
                b.user_id,
                await loadCtx(b.user_id, p.timezone, Number(p.sleep_target_hours ?? 8)),
              );
            const c = ctx.get(b.user_id)!;
            const time = localHm(b.starts_at, p.timezone);
            const pp = await import("@/lib/push-plan");
            const pk = pp.pushKindForBlock(b);
            const muted = !pp.kindAllowed(pk, p.push_muted_kinds);
            for (const kind of ["reminder", "adaptive"] as const) {
              // Smart defaults: no lead warning for wake/meals/tasks; muted kinds get nothing.
              if (muted || (kind === "reminder" && !pp.STAGES[pk].prepare)) continue;
              // The start prompt covers the first minutes; the not-started check-in is the later "missed" stage.
              if (
                kind === "adaptive" &&
                pp.STAGES[pk].start &&
                now.getTime() < new Date(b.starts_at).getTime() + 15 * 60000
              )
                continue;
              const leadMin = reminderLeadMin(
                p.reminder_lead_min,
                b.interruption_count ?? 0,
                permsFor(b.user_id),
              );
              // Exact-time warning: queued ahead with its target instant (start − lead) so the
              // per-minute dispatcher sends it on time; decided as of that instant.
              const target = new Date(new Date(b.starts_at).getTime() - leadMin * 60000);
              if (kind === "reminder" && target.getTime() - now.getTime() > 6 * 60000) continue;
              const at = kind === "reminder" && target > now ? target : now;
              const d = decideIntervention({
                now: at,
                kind,
                tier: p.tier as "free" | "pro" | "execute",
                level: p.accountability_level as "off" | "reminders_only" | "adaptive",
                remindersEnabled: p.reminders_enabled,
                chosenBudget: p.adaptive_daily_budget,
                block: b,
                leadMin,
                inQuiet: inQuietHours(at, p.quiet_start, p.quiet_end, p.timezone),
                conflict: [...c.busy].some((id) => id !== b.id),
                safety: c.policy,
                recoveryRed: c.recoveryRed,
                alreadySentForBlock: c.sent.has(`${b.id}:${kind}`),
                adaptiveSentToday: c.adaptiveToday,
                lastAdaptiveAt: c.lastAdaptiveAt,
                reminderOnly: c.reminderOnly,
                emailAllowed: p.email_reminders && m.emailConfigured(),
              });
              // Only log meaningful declines (not "not yet"/"already sent") to keep the record readable.
              if (
                d.allowed ||
                ![
                  "not_yet",
                  "already_sent",
                  "not_pending",
                  "start_passed",
                  "not_open",
                  "window_passed",
                  "user_turned_off",
                  "level_reminders_only",
                  "tier_reminders_only",
                ].includes(d.reason)
              ) {
                await supabaseAdmin.from("intervention_decisions").insert({
                  user_id: b.user_id,
                  block_id: b.id,
                  kind,
                  allowed: d.allowed,
                  reason: d.reason,
                  channels: d.channels,
                  policy_version: INTERVENTION_POLICY_VERSION,
                });
                c.sent.add(`${b.id}:${kind}`);
              }
              if (!d.allowed) {
                if (d.reason !== "not_yet") declined++;
                continue;
              }
              const lead = Math.max(
                1,
                Math.round((new Date(b.starts_at).getTime() - at.getTime()) / 60000),
              );
              const copy =
                kind === "reminder"
                  ? pp.pushCopy(pk, "prepare", { title: b.title, time, minutes: lead })
                  : {
                      title: `You haven't started ${b.title.slice(0, 60)} yet`,
                      body: "Start now or move it?",
                    };
              const { title, body } = copy;
              const created = await enqueueNotification(supabaseAdmin, {
                userId: b.user_id,
                category: kind === "reminder" ? "UPCOMING" : "DUE",
                intent: kind === "reminder" ? "session_reminder" : "due_nudge",
                kind,
                title,
                body,
                link: pp.pushLink(pk, { blockId: b.id }),
                blockId: b.id,
                dedupe: [kind, b.id, b.starts_at],
                ref: { t: "block", id: b.id, at: b.starts_at },
                legacyEmail: d.channels.includes("email"),
                now,
                sendAt: at,
              });
              if (!created.length) continue;
              if (kind === "reminder") inApp++;
              else {
                adaptive++;
                c.adaptiveToday++;
                c.lastAdaptiveAt = now.toISOString();
              }
              if (created.includes("email")) emails++;
            }
          }
          const calls = 0; // Execute calls now run as campaigns in processCalls (V3 §64.8).
          const proCalls = await (
            await import("@/lib/calling.server")
          ).processCalls(supabaseAdmin, origin, now);
          const rewards = await (
            await import("@/lib/reward.server")
          ).processRewards(supabaseAdmin, now);
          const prompts = await (
            await import("@/lib/push-schedule.server")
          ).queuePlanPrompts(supabaseAdmin, now);
          const weekly = await queueWeeklySummaries(supabaseAdmin, now);
          const delivery = await dispatchDue(supabaseAdmin, origin, now);
          return {
            lifecycle,
            inApp,
            adaptive,
            declined,
            emails,
            calls,
            proCalls,
            rewards,
            weekly,
            prompts,
            delivery,
          };
        });
        // Retries of payment events and support emails whose backoff has elapsed.
        const retried = await drainJobs(supabaseAdmin);
        // Member standing instructions ("keep going until I reach my goal"): next week's plan, session calls, meals. Hourly.
        const standing = await runTick(supabaseAdmin, "standing_orders", 60 * 60000, async () =>
          (await import("@/lib/standing-orders.server")).runAllStandingOrders(),
        );
        // Goal Missions: proactive notes (max one per mission a day) and stage moves from real data. Hourly.
        const missions = await runTick(supabaseAdmin, "missions", 60 * 60000, async () =>
          (await import("@/lib/mission.server")).scanMissions(supabaseAdmin),
        );
        return Response.json(
          { tick, retried, standing, missions },
          { status: tick.status === "dead" ? 500 : 200 },
        );
      },
    },
  },
});

function toMin(hm: string) {
  const [h, mm] = hm.split(":").map(Number);
  return h! * 60 + mm!;
}
