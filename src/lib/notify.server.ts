/**
 * Notification delivery (V3 §69/§70): enqueue with idempotent dedupe keys, then dispatch due rows
 * with retries. Push goes through the Expo Push Service adapter (device tokens kept per platform so
 * direct APNs/FCM can replace it); email through the configured transactional provider.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { env } from "@/lib/integrations.server";
import {
  type Category,
  type DeliveryChannel,
  prefsMap,
  resolveChannels,
  dedupeKey,
  quietDeferral,
  nextRetry,
  isPermanent,
  EMAIL_SUBJECT,
} from "@/lib/notify";

type Db = SupabaseClient<Database>;

export type EnqueueInput = {
  userId: string;
  category: Category;
  intent: string;
  title: string;
  body?: string | null;
  link?: string | null;
  blockId?: string | null;
  planVersionId?: string | null;
  /** 'reminder' | 'adaptive' for intervention-engine decisions; 'system' otherwise */
  kind?: "reminder" | "adaptive" | "system";
  dedupe: Array<string | number | null | undefined>;
  /** extra channels the caller's own rules allowed (legacy email reminder switch) */
  legacyEmail?: boolean;
  now?: Date;
  /** The plan item this prompt is about; re-checked just before sending so stale prompts never go. */
  ref?: { t: "block" | "commitment"; id: string; at: string; hm?: string } | null;
  /** Exact instant to deliver (queued ahead of time); defaults to now. In-app copies wait too. */
  sendAt?: Date;
};

export function pushConfigured() {
  return true; /* Expo push works without an access token; EXPO_ACCESS_TOKEN adds enhanced security. */
}
export function emailDeliveryConfigured() {
  return !!(env("RESEND_API_KEY") && env("EMAIL_FROM"));
}

/** Creates one row per channel. Returns the channels newly queued (existing dedupe keys are left untouched). */
export async function enqueueNotification(db: Db, i: EnqueueInput): Promise<DeliveryChannel[]> {
  const now = i.now ?? new Date();
  const [{ data: prefRows }, { data: prof }, { count: devices }] = await Promise.all([
    db
      .from("notification_preferences")
      .select("category,in_app,push,email")
      .eq("user_id", i.userId),
    db
      .from("profiles")
      .select("timezone,quiet_start,quiet_end,processing_restricted,account_status")
      .eq("id", i.userId)
      .maybeSingle(),
    db
      .from("push_devices")
      .select("id", { count: "exact", head: true })
      .eq("user_id", i.userId)
      .eq("status", "active"),
  ]);
  // V3 §60/§79: no nudges while use of data is paused or the account is being deleted.
  if (
    prof &&
    ((prof as { processing_restricted?: boolean }).processing_restricted ||
      (prof as { account_status?: string }).account_status !== "active")
  )
    return [];
  const pref = prefsMap(prefRows)[i.category];
  const channels = resolveChannels(i.category, pref, {
    push: (devices ?? 0) > 0,
    email: emailDeliveryConfigured(),
    legacyEmail: i.legacyEmail ?? false,
  });
  const base = dedupeKey(i.dedupe);
  const at = i.sendAt && i.sendAt.getTime() > now.getTime() ? i.sendAt : now;
  const ahead = at !== now;
  const created: DeliveryChannel[] = [];
  for (const ch of channels) {
    const defer = prof
      ? quietDeferral(at, i.category, ch, {
          start: prof.quiet_start,
          end: prof.quiet_end,
          tz: prof.timezone,
        })
      : null;
    const row = {
      user_id: i.userId,
      channel: ch,
      kind: i.kind ?? "system",
      category: i.category,
      intent: i.intent,
      title: i.title,
      body: i.body ?? null,
      link: i.link ?? null,
      block_id: i.blockId ?? null,
      plan_version_id: i.planVersionId ?? null,
      dedupe_key: `${base}:${ch}`,
      scheduled_at: (defer ?? at).toISOString(),
      status: ch === "in_app" && !ahead ? "sent" : "queued",
      sent_at: ch === "in_app" && !ahead ? now.toISOString() : null,
      next_attempt_at:
        ch === "in_app" && !ahead ? null : (ch === "in_app" ? at : (defer ?? at)).toISOString(),
      provider_result:
        defer || i.ref
          ? { ...(defer ? { deferred: "quiet_hours" } : {}), ...(i.ref ? { ref: i.ref } : {}) }
          : null,
    };
    const { data, error } = await db
      .from("notifications")
      .upsert(row, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
      .select("id");
    if (!error && data?.length) created.push(ch);
  }
  return created;
}

type SendResult =
  | { ok: true; result: Record<string, unknown> }
  | {
      ok: false;
      status: number | null;
      code?: string | null;
      error: string;
      retryAfter?: number | null;
      result?: Record<string, unknown>;
    };

/** Expo Push Service adapter. */
async function sendExpoPush(
  tokens: string[],
  n: { title: string; body: string | null; link: string | null; id: string },
): Promise<{ res: SendResult; invalid: string[] }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const tok = env("EXPO_ACCESS_TOKEN");
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  let r: Response;
  try {
    r = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers,
      body: JSON.stringify(
        tokens.map((to) => ({
          to,
          title: n.title,
          body: n.body ?? undefined,
          data: { link: n.link, notificationId: n.id },
          sound: "default",
        })),
      ),
    });
  } catch (e) {
    return { res: { ok: false, status: null, error: String(e) }, invalid: [] };
  }
  const text = await r.text();
  if (!r.ok)
    return {
      res: {
        ok: false,
        status: r.status,
        error: text.slice(0, 300),
        retryAfter: Number(r.headers.get("retry-after")) || null,
      },
      invalid: [],
    };
  const tickets = (JSON.parse(text).data ?? []) as Array<{
    status: string;
    id?: string;
    message?: string;
    details?: { error?: string };
  }>;
  const invalid = tokens.filter((_, k) => tickets[k]?.details?.error === "DeviceNotRegistered");
  const okCount = tickets.filter((t) => t.status === "ok").length;
  if (okCount > 0) return { res: { ok: true, result: { provider: "expo", tickets } }, invalid };
  const first = tickets[0];
  return {
    res: {
      ok: false,
      status: 400,
      code: first?.details?.error ?? null,
      error: first?.message ?? "Push refused",
    },
    invalid,
  };
}

async function sendResendEmail(
  to: string,
  subject: string,
  text: string,
  idem: string,
): Promise<SendResult> {
  let r: Response;
  try {
    r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idem,
      },
      body: JSON.stringify({
        from: env("EMAIL_FROM"),
        to,
        subject,
        text: `${text}\n\n—\nChange which emails you get: ${env("APP_BASE_URL") ?? ""}/app/settings#notifications`,
        headers: env("APP_BASE_URL")
          ? { "List-Unsubscribe": `<${env("APP_BASE_URL")}/app/settings#notifications>` }
          : undefined,
      }),
    });
  } catch (e) {
    return { ok: false, status: null, error: String(e) };
  }
  const body = await r.text();
  if (!r.ok)
    return {
      ok: false,
      status: r.status,
      error: body.slice(0, 300),
      retryAfter: Number(r.headers.get("retry-after")) || null,
    };
  return { ok: true, result: { provider: "resend", ...(JSON.parse(body || "{}") as object) } };
}

/** Browser / home-screen app push to each saved web subscription; expired subscriptions are retired. */
export async function sendWebDevices(
  db: Db,
  n: { id: string; user_id: string; title: string; body: string | null; link: string | null },
  devs: Array<{ id: string; token: string }>,
  previous: Array<{ id: string; ok: boolean; status: number | null; error?: string }> = [],
): Promise<SendResult> {
  if (!devs.length) return { ok: false, status: 410, code: "no_device", error: "No active device" };
  const { sendWebPush } = await import("./webpush.server");
  const devices: Array<{ id: string; ok: boolean; status: number | null; error?: string }> = [];
  let retryable = false;
  for (const d of devs) {
    const accepted = previous.find((p) => p.id === d.id && p.ok);
    if (accepted) {
      devices.push(accepted);
      continue;
    }
    let r;
    try {
      const sub = JSON.parse(d.token);
      r = await sendWebPush(sub, {
        title: n.title,
        body: n.body,
        link: n.link ?? "/app/today",
        id: n.id,
      });
    } catch {
      r = { ok: false, status: 400, gone: true, error: "invalid_subscription" };
    }
    devices.push({
      id: d.id,
      ok: r.ok,
      status: r.status,
      ...(!r.ok
        ? {
            error: r.gone
              ? "Subscription expired or invalid. Enable prompts again on this device."
              : r.status
                ? `Push service refused (${r.status})`
                : "Push service unavailable or not configured",
          }
        : {}),
    });
    if (!r.ok) {
      if (!isPermanent(r.status)) retryable = true;
      if (r.gone) {
        const { error } = await db
          .from("push_devices")
          .update({ status: "invalid" })
          .eq("user_id", n.user_id)
          .eq("id", d.id);
        if (error) throw new Error("Could not retire expired push device");
      }
    }
  }
  const result = { provider: "web_push", accepted: devices.filter((d) => d.ok).length, devices };
  if (retryable)
    return {
      ok: false,
      status: 503,
      error: "Some devices could not be reached; retrying failed devices only.",
      result,
    };
  return devices.some((d) => d.ok)
    ? { ok: true, result }
    : { ok: false, status: 410, error: devices[0]?.error ?? "No active device", result };
}

/** Sends every queued/retrying push and email row whose time has come. Safe to run concurrently: rows are claimed first. */
export async function dispatchDue(db: Db, origin: string, now = new Date(), limit = 200) {
  // §88: a switched-off channel is held (left queued), never dropped, and drains when switched back on.
  const { flagOn } = await import("./flags.server");
  const { heldChannels } = await import("./flags");
  const held = heldChannels(
    await flagOn("push_notifications"),
    await flagOn("email_notifications"),
  );
  let q = db
    .from("notifications")
    .select(
      "id,user_id,channel,category,title,body,link,attempts,dedupe_key,status,provider_result",
    )
    .in("status", ["queued", "retrying"])
    .lte("next_attempt_at", now.toISOString());
  if (held.length) q = q.not("channel", "in", `(${held.join(",")})`);
  const { data: due } = await q.order("next_attempt_at").limit(limit);
  const out = { sent: 0, retrying: 0, failed: 0, skipped: 0 };
  const emails = new Map<string, string | null>();
  for (const n of due ?? []) {
    const { data: claimed } = await db
      .from("notifications")
      .update({ status: "sending" })
      .eq("id", n.id)
      .eq("status", n.status)
      .select("id");
    if (!claimed?.length) continue;
    const attempts = n.attempts + 1;
    let res: SendResult;
    // No stale prompts: the item must still exist, be unstarted and at the same time.
    const ref = (
      n.provider_result as { ref?: { t: string; id: string; at: string; hm?: string } } | null
    )?.ref;
    if (ref) {
      const { stillValid } = await import("./push-plan");
      let cur: { starts_at: string; status?: string | null; active?: boolean | null } | null = null;
      if (ref.t === "block") {
        const { data: b } = await db
          .from("plan_blocks")
          .select("starts_at,status")
          .eq("id", ref.id)
          .maybeSingle();
        cur = b;
      } else {
        const { data: c } = await db
          .from("commitments")
          .select("active,start_time")
          .eq("id", ref.id)
          .maybeSingle();
        // Commitment times are local wall-clock: a changed time means the stored instant no longer applies.
        cur = c
          ? {
              starts_at:
                String(c.start_time ?? "").slice(0, 5) === ref.hm ? ref.at : "1970-01-01T00:00:00Z",
              active: c.active,
            }
          : null;
      }
      if (!stillValid(ref, cur, now)) {
        await db
          .from("notifications")
          .update({
            status: "suppressed",
            attempts,
            last_error: "plan_item_changed",
            next_attempt_at: null,
          })
          .eq("id", n.id);
        out.skipped++;
        continue;
      }
    }
    if (n.channel === "push") {
      const { data: devs } = await db
        .from("push_devices")
        .select("id,token,platform")
        .eq("user_id", n.user_id)
        .eq("status", "active");
      if (!devs?.length)
        res = { ok: false, status: 410, code: "no_device", error: "No active device" };
      else {
        const web = devs.filter((d) => d.platform === "web");
        const native = devs.filter((d) => d.platform !== "web");
        const previous = n.provider_result as {
          devices?: Array<{ id: string; ok: boolean; status: number | null; error?: string }>;
        } | null;
        const webRes = await sendWebDevices(db, n, web, previous?.devices);
        const r = native.length
          ? await sendExpoPush(
              native.map((d) => d.token),
              { ...n, link: n.link ? origin + n.link : null },
            )
          : { res: webRes, invalid: [] as string[] };
        if (native.length) {
          const webDetail = webRes.result ?? {};
          if (web.length && !webRes.ok && webRes.status === 503) r.res = webRes;
          else if (webRes.ok && !r.res.ok) r.res = webRes;
          else
            r.res = r.res.ok
              ? { ...r.res, result: { ...r.res.result, ...webDetail } }
              : { ...r.res, result: webDetail };
        }
        if (r.invalid.length)
          await db
            .from("push_devices")
            .update({ status: "invalid" })
            .eq("user_id", n.user_id)
            .in("token", r.invalid);
        res = r.res;
        const byPlatform = new Map<string, number>();
        for (const d of devs)
          byPlatform.set(
            d.platform ?? "unknown",
            (byPlatform.get(d.platform ?? "unknown") ?? 0) + 1,
          );
        await (
          await import("./usage.server")
        ).recordUsage(
          [...byPlatform].map(([platform, q]) => ({
            userId: n.user_id,
            provider: "expo_push",
            feature: `notify_${n.category}`,
            unit: "messages" as const,
            quantity: q,
            platform,
            ok: res.ok,
          })),
        );
      }
    } else if (n.channel === "email") {
      if (!emailDeliveryConfigured())
        res = {
          ok: false,
          status: null,
          code: "not_configured",
          error: "Email is not switched on yet",
        };
      else {
        if (!emails.has(n.user_id))
          emails.set(
            n.user_id,
            (await db.auth.admin.getUserById(n.user_id)).data.user?.email ?? null,
          );
        const to = emails.get(n.user_id);
        if (!to) res = { ok: false, status: 404, error: "No email address" };
        else {
          const text = `${n.title}\n\n${n.body ?? ""}\n\nOpen Plexecute: ${origin}${n.link ?? "/app/today"}\n\nChange which emails you get in Settings → Notifications.`;
          res = await sendResendEmail(
            to,
            EMAIL_SUBJECT[n.category as Category] ?? "Plexecute",
            text,
            n.dedupe_key,
          );
          await (
            await import("./usage.server")
          ).recordUsage({
            userId: n.user_id,
            provider: "resend",
            feature: `notify_${n.category}`,
            unit: "messages",
            quantity: 1,
            platform: "email",
            ok: res.ok,
          });
        }
      }
    } else res = { ok: true, result: {} };

    if (res.ok) {
      await db
        .from("notifications")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          attempts,
          provider_result: {
            ...((n.provider_result as object) ?? {}),
            ...res.result,
            attempted_at: now.toISOString(),
          } as never,
          last_error: null,
          next_attempt_at: null,
        })
        .eq("id", n.id);
      out.sent++;
    } else {
      const retryAt = isPermanent(res.status, res.code)
        ? null
        : nextRetry(attempts, now, res.retryAfter);
      const status = retryAt
        ? "retrying"
        : res.code === "not_configured" || res.code === "no_device"
          ? "skipped"
          : "failed";
      await db
        .from("notifications")
        .update({
          status,
          attempts,
          last_error: res.error.slice(0, 300),
          next_attempt_at: retryAt?.toISOString() ?? null,
          provider_result: {
            ...((n.provider_result as object) ?? {}),
            ...res.result,
            attempted_at: now.toISOString(),
            status: res.status,
            code: res.code ?? null,
          } as never,
        })
        .eq("id", n.id);
      if (status === "retrying") out.retrying++;
      else if (status === "skipped") out.skipped++;
      else out.failed++;
    }
  }
  return out;
}

/** WEEKLY_REVIEW: once per local week, Sunday evening, counts only (no health or body details). */
export async function queueWeeklySummaries(db: Db, now = new Date()) {
  const { weeklySummaryDue } = await import("@/lib/notify");
  const { weekKeyOf, zonedInstant, addDaysKey } = await import("@/lib/tz");
  const { data: profs } = await db.from("profiles").select("id,timezone").limit(5000);
  let queued = 0;
  for (const p of profs ?? []) {
    if (!weeklySummaryDue(now, p.timezone)) continue;
    const wk = weekKeyOf(now, p.timezone);
    const { count: exists } = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", p.id)
      .like("dedupe_key", `weekly:${wk}:%`);
    if (exists) continue;
    const from = zonedInstant(wk, 0, p.timezone).toISOString();
    const to = zonedInstant(addDaysKey(wk, 7), 0, p.timezone).toISOString();
    const { data: blocks } = await db
      .from("plan_blocks")
      .select("status")
      .eq("user_id", p.id)
      .gte("starts_at", from)
      .lt("starts_at", to)
      .not("status", "in", "(rescheduled,cancelled)");
    const total = blocks?.length ?? 0;
    const done = (blocks ?? []).filter((b) => b.status === "done").length;
    const partial = (blocks ?? []).filter((b) => b.status === "partial").length;
    const body = total
      ? `This week you completed ${done} of ${total} planned sessions${partial ? ` and partly completed ${partial}` : ""}.`
      : "Nothing was planned this week. You can plan next week from your Plan page.";
    const c = await enqueueNotification(db, {
      userId: p.id,
      category: "WEEKLY_REVIEW",
      intent: "weekly_summary",
      title: "Your week in Plexecute",
      body,
      link: "/app/progress",
      dedupe: ["weekly", wk],
      now,
    });
    if (c.length) queued++;
  }
  return queued;
}

/** Records what the user did with a notification (opened / acted / dismissed). */
export async function recordInteraction(
  db: Db,
  userId: string,
  id: string,
  interaction: "opened" | "acted" | "dismissed",
) {
  await db
    .from("notifications")
    .update({
      interaction,
      interaction_at: new Date().toISOString(),
      read_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId);
}
