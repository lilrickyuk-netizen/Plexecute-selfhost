/**
 * Pro accountability calling (V3 §64/§65): phone verification, encrypted numbers, campaigns,
 * attempts, retries, provider status handling and acknowledgements. Server-only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { env, twilioConfigured, twilioCreateCall } from "@/lib/integrations.server";
import {
  PRO_ALLOWANCE,
  serviceMonth,
  proCampaignEligibility,
  proUsage,
  mapProviderStatus,
  afterFinal,
  ACK_TO_STATUS,
  type Ack,
  type CallState,
  CALL_CONSENT_VERSION,
} from "@/lib/calling";
import { inQuietHours, localDayKey, zonedParts } from "@/lib/tz";
import { marketDecision, marketReputationHold, type MarketRow } from "@/lib/call-compliance";
import {
  EXECUTE_ALLOWANCE,
  EXECUTE_CEILINGS,
  EXECUTE_REASON_COPY,
  REPUTATION as EXECUTE_REP,
  executeCampaignEligibility,
  executeRetryBlock,
  executeRetryGap,
  reputationHold,
  timedPolicyDue,
  kindAllowed,
  callTimeLimitSec,
} from "@/lib/calling";

type Db = SupabaseClient<Database>;

// ---------- number encryption (AES-GCM, key from PHONE_ENCRYPTION_KEY, base64 32 bytes) ----------
async function key() {
  const raw = env("PHONE_ENCRYPTION_KEY");
  if (!raw) throw new Error("PHONE_ENCRYPTION_KEY not set");
  let bytes: Uint8Array<ArrayBuffer> | null = null;
  try {
    const b = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    if (b.length === 32) bytes = b;
  } catch {
    /* not base64 */
  }
  // A non-base64 secret of 32+ characters is stretched with SHA-256 (platform-generated secrets).
  if (!bytes) {
    if (raw.length < 32)
      throw new Error("PHONE_ENCRYPTION_KEY must be 32 bytes base64 or a 32+ character secret");
    bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptPhone(e164: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await key(),
      new TextEncoder().encode(e164),
    ),
  );
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
  return `v1.${b64(iv)}.${b64(ct)}`;
}
export async function decryptPhone(enc: string) {
  const [, ivB, ctB] = enc.split(".");
  const d = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: d(ivB!) }, await key(), d(ctB!)),
  );
}

// ---------- configuration ----------
export function verifyConfigured() {
  return twilioConfigured() && !!env("TWILIO_VERIFY_SERVICE_SID");
}
export function encryptionConfigured() {
  return !!env("PHONE_ENCRYPTION_KEY");
}
/** Markets signed off after the §64.2 legal review, e.g. "GB". Empty means no market is cleared. */
/** Countries whose compliance manifest row is switched on and signed off (§64.2). Credentials alone never enable calling. */
export async function approvedMarkets(db: Db): Promise<string[]> {
  const { data } = await db
    .from("call_market_manifest")
    .select("country,enabled,killed,signed_off_at")
    .neq("country", "GLOBAL");
  const { data: g } = await db
    .from("call_market_manifest")
    .select("killed")
    .eq("country", "GLOBAL")
    .maybeSingle();
  if (g?.killed) return [];
  return (data ?? [])
    .filter((r) => r.enabled && !r.killed && r.signed_off_at)
    .map((r) => r.country);
}
/** Market decision for a user's verified number at this moment (kill switches, sign-off, versions, permitted hours, caps). */
export async function marketFor(
  db: Db,
  country: string | null | undefined,
  tz: string | null | undefined,
  now: Date,
) {
  const [{ data: row }, { data: g }] = await Promise.all([
    country
      ? db.from("call_market_manifest").select("*").eq("country", country).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("call_market_manifest").select("killed").eq("country", "GLOBAL").maybeSingle(),
  ]);
  return marketDecision(row as MarketRow | null, g, zonedParts(now, tz).minutes);
}
export function callingReady() {
  return twilioConfigured() && encryptionConfigured();
}

/** Yes/no readiness flags for a member's calls (never the number itself). */
export async function callReadiness(userId: string, callAt?: Date) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // The 24-hour call limit is checked for the call's own time, so Coach never promises a call that will be held.
  const at = callAt ?? new Date();
  const { data: recentCalls } = await supabaseAdmin
    .from("call_logs")
    .select("created_at")
    .eq("user_id", userId)
    .not("campaign_id", "is", null)
    .gte("created_at", new Date(at.getTime() - 864e5).toISOString())
    .order("created_at");
  const limitFreesAt = (await callLimitExempt(supabaseAdmin as unknown as Db, userId))
    ? null
    : dailyLimitFreesAt(
        (recentCalls ?? []).map((r) => r.created_at),
        at,
      );
  const [{ data: ph }, { data: p }, markets] = await Promise.all([
    supabaseAdmin
      .from("phone_numbers")
      .select("verified_at,country")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("profiles")
      .select("call_consent_version,calls_stopped_at")
      .eq("id", userId)
      .maybeSingle(),
    approvedMarkets(supabaseAdmin as unknown as Db),
  ]);
  const scheduler = !!env("CRON_SECRET");
  const marketOk = ph?.country ? markets.includes(ph.country) : markets.length > 0;
  const missing = [
    ...(!callingReady() ? ["phone_service_credentials"] : []),
    ...(!marketOk ? ["calling_country_not_switched_on_by_owner"] : []),
    ...(!scheduler ? ["call_scheduler_not_running"] : []),
    ...(!ph?.verified_at ? ["phone_not_verified"] : []),
    ...(!p?.call_consent_version ? ["call_consent_not_given"] : []),
    ...(p?.calls_stopped_at ? ["member_stopped_calls"] : []),
    ...(limitFreesAt ? ["daily_call_limit_reached"] : []),
  ];
  return {
    calls_will_ring: missing.length === 0,
    blocking: missing,
    ...(limitFreesAt ? { calls_ring_again_from: limitFreesAt } : {}),
    phone_verified: !!ph?.verified_at,
    call_consent_given: !!p?.call_consent_version,
  };
}

/** Admins (user_roles) have no daily call limit (owner decision); members keep the 12-in-24h safety limit. */
async function callLimitExempt(db: Db, userId: string) {
  const { data } = await db
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

/**
 * Calls placed in the 24 hours before `at`: when the safety limit is already used up, the ISO time the
 * oldest one drops out and calls can ring again; null when a call at `at` is within the limit.
 */
export function dailyLimitFreesAt(
  placedIso: string[],
  at: Date,
  limit = EXECUTE_CEILINGS.rolling24h,
) {
  const win = placedIso
    .map((t) => new Date(t).getTime())
    .filter((t) => t > at.getTime() - 864e5 && t <= at.getTime())
    .sort((x, y) => x - y);
  if (win.length < limit) return null;
  return new Date(win[win.length - limit]! + 864e5).toISOString();
}

/** Late by more than this, a scheduled call is recorded as missed instead of ringing late. */
export const SCHEDULED_CALL_GRACE_MS = 15 * 60000;

/**
 * Cron: place calls the member scheduled (e.g. via the Coach) once their time arrives, through the
 * normal Pro/Execute campaign path so eligibility, quiet hours, consent and allowances still apply.
 * Each row is claimed atomically, so overlapping runs never ring twice.
 */
export async function processScheduledCalls(db: Db, origin: string, now = new Date()) {
  const out = { placed: 0, held: 0, missed: 0, notPlaced: 0 };
  const { data: due } = await db
    .from("scheduled_calls")
    .select("id,user_id,call_at")
    .eq("status", "scheduled")
    .lte("call_at", now.toISOString())
    .order("call_at")
    .limit(200);
  for (const row of due ?? []) {
    const { data: claimed } = await db
      .from("scheduled_calls")
      .update({ status: "processing", processed_at: now.toISOString() })
      .eq("id", row.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    const finish = (status: string, reason: string | null, campaignId: string | null = null) =>
      db
        .from("scheduled_calls")
        .update({ status, status_reason: reason, campaign_id: campaignId })
        .eq("id", row.id);
    if (now.getTime() - new Date(row.call_at).getTime() > SCHEDULED_CALL_GRACE_MS) {
      await finish("missed_window", "not_processed_in_time");
      out.missed++;
      continue;
    }
    if (!callingReady()) {
      await finish("held", "calling_not_switched_on");
      out.held++;
      continue;
    }
    const { data: p } = await db
      .from("profiles")
      .select("tier")
      .eq("id", row.user_id)
      .maybeSingle();
    const args = {
      userId: row.user_id,
      blockId: null,
      trigger: "scheduled" as const,
      dedupe: `sched:${row.id}`,
      origin,
      now,
    };
    const r =
      p?.tier === "execute"
        ? await startExecuteCampaign(db, args)
        : await startProCampaign(db, args);
    const { data: camp } = await db
      .from("call_campaigns")
      .select("id")
      .eq("user_id", row.user_id)
      .eq("dedupe_key", `sched:${row.id}`)
      .maybeSingle();
    if (r.ok) {
      await finish("placed", null, camp?.id ?? null);
      out.placed++;
    } else {
      await finish(
        "not_placed",
        String((r as { reason?: string }).reason ?? "failed"),
        camp?.id ?? null,
      );
      out.notPlaced++;
      try {
        await tellMemberCallNotPlaced(
          db,
          row.id,
          row.user_id,
          String((r as { reason?: string }).reason ?? "failed"),
        );
      } catch (e) {
        console.error("scheduled call notice", e);
      }
    }
  }
  return out;
}

/** A call the member asked for that could not ring is never silent: Coach says so, once, with the reason. */
async function tellMemberCallNotPlaced(
  db: Db,
  scheduledId: string,
  userId: string,
  reason: string,
) {
  const copy =
    reason === "rolling_ceiling"
      ? "the safety limit of 12 calls in 24 hours had been reached"
      : (EXECUTE_REASON_COPY[reason] ?? "the call could not be placed").replace(/\.$/, "");
  const body = `I couldn't ring you for your scheduled call because ${copy.charAt(0).toLowerCase()}${copy.slice(1)}. Your plan and in-app reminders still stand.`;
  const hash = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`call_not_placed:${scheduledId}`),
    ),
  );
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(hash.slice(0, 16), (x) => x.toString(16).padStart(2, "0")).join("");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  await db.from("coach_messages").upsert(
    {
      id,
      user_id: userId,
      role: "assistant",
      mode: "COACH",
      content: body,
      tool_trace: [{ tool: "scheduled_call_not_placed", ok: true, reason }],
    } as never,
    { onConflict: "id", ignoreDuplicates: true },
  );
  const { enqueueNotification } = await import("./notify.server");
  await enqueueNotification(db as never, {
    userId,
    category: "DUE",
    intent: "scheduled_call_not_placed",
    title: "Your call couldn't ring",
    body,
    link: "/app/coach",
    kind: "system",
    dedupe: ["call_not_placed", scheduledId],
  });
}

async function twilioVerify(path: string, body: Record<string, string>) {
  const sid = env("TWILIO_ACCOUNT_SID")!,
    tok = env("TWILIO_AUTH_TOKEN")!;
  const r = await fetch(
    `https://verify.twilio.com/v2/Services/${env("TWILIO_VERIFY_SERVICE_SID")}/${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${tok}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
    },
  );
  const j = (await r.json()) as { status?: string; message?: string };
  if (!r.ok) throw new Error(`Verify failed [${r.status}]`);
  return j;
}
export async function sendVerification(e164: string) {
  await twilioVerify("Verifications", { To: e164, Channel: "sms" });
}
export async function checkVerification(e164: string, code: string) {
  const j = await twilioVerify("VerificationCheck", { To: e164, Code: code });
  return j.status === "approved";
}

// ---------- allowance ----------
export async function serviceWindow(db: Db, userId: string, now = new Date()) {
  const [{ data: sub }, { data: prof }] = await Promise.all([
    db.from("subscriptions").select("current_period_end").eq("user_id", userId).maybeSingle(),
    db.from("profiles").select("created_at").eq("id", userId).maybeSingle(),
  ]);
  const anchor = new Date(sub?.current_period_end ?? prof?.created_at ?? now.toISOString());
  return serviceMonth(now, anchor);
}
/** §5.3 trial call ceilings, counted from the provider-reported trial start. */
async function trialBlock(db: Db, userId: string, tier: "pro" | "execute") {
  const { data: sub } = await db
    .from("subscriptions")
    .select("status,current_period_start")
    .eq("user_id", userId)
    .maybeSingle();
  if (sub?.status !== "trialing") return null;
  const since = sub.current_period_start ?? new Date(Date.now() - 7 * 864e5).toISOString();
  const { data: cs } = await db
    .from("call_campaigns")
    .select("block_id,consumed_at,connected_seconds")
    .eq("user_id", userId)
    .gte("created_at", since);
  const rows = cs ?? [];
  const { trialCallBlock } = await import("@/lib/billing");
  return trialCallBlock({
    tier,
    trialing: true,
    campaigns: rows.filter((c) => c.consumed_at).length,
    occurrences: new Set(rows.map((c) => c.block_id ?? "none")).size,
    connectedSeconds: rows.reduce((t, c) => t + c.connected_seconds, 0),
  });
}
export async function usageFor(db: Db, userId: string, now = new Date()) {
  const win = await serviceWindow(db, userId, now);
  const { data, error } = await db
    .from("call_campaigns")
    .select("consumed_at,connected_seconds")
    .eq("user_id", userId)
    .eq("policy", "pro")
    .gte("service_month_start", win.start.toISOString())
    .lt("service_month_start", win.end.toISOString());
  if (error) throw new Error("Call usage could not be loaded.");
  const [{ data: topups, error: topupError }, { data: reservations, error: reservationError }] =
    await Promise.all([
      db
        .from("entitlement_ledger")
        .select("amount")
        .eq("user_id", userId)
        .eq("capability", "execute.voice_topup_seconds")
        .gte("created_at", win.start.toISOString())
        .lt("created_at", win.end.toISOString()),
      db
        .from("usage_reservations")
        .select("actual_topup_seconds")
        .eq("user_id", userId)
        .eq("period_start", win.start.toISOString().slice(0, 10))
        .eq("kind", "call")
        .eq("settled", true),
    ]);
  if (topupError || reservationError) throw new Error("Call credits could not be loaded.");
  const { spendState } = await import("./spend.server");
  const spend = await spendState(userId, db);
  const usage = {
    includedAvailable: spend.usedMicro < spend.allowanceMicro,
    topUpSeconds: (topups ?? []).reduce((s, t) => s + Number(t.amount), 0),
    topUpUsedSeconds: (reservations ?? []).reduce((s, r) => s + r.actual_topup_seconds, 0),
    campaignsUsed: (data ?? []).filter((c) => c.consumed_at).length,
    connectedSeconds: (data ?? []).reduce((s, c) => s + c.connected_seconds, 0),
  };
  return { window: win, usage, ...proUsage(usage) };
}

async function eligibility(db: Db, userId: string, now: Date) {
  const [{ data: p }, { data: phone }] = await Promise.all([
    db
      .from("profiles")
      .select("tier,quiet_start,quiet_end,timezone,call_consent_version,calls_stopped_at")
      .eq("id", userId)
      .maybeSingle(),
    db
      .from("phone_numbers")
      .select("verified_at,country,e164_enc")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (!p) throw new Error("Profile not found");
  const { currentPolicy } = await import("@/lib/safety.server");
  const pol = await currentPolicy(userId);
  const u = await usageFor(db, userId, now);
  const mk = await marketFor(db, phone?.country, p.timezone, now);
  const e0 = proCampaignEligibility({
    tier: p.tier as "free" | "pro" | "execute",
    providerReady: callingReady(),
    marketApproved: mk.ok,
    phoneVerified: !!phone?.verified_at,
    consented: p.call_consent_version === CALL_CONSENT_VERSION,
    callsStopped: !!p.calls_stopped_at,
    inQuiet: inQuietHours(now, p.quiet_start, p.quiet_end, p.timezone),
    safetyPause: pol.pauseAccountability,
    usage: u.usage,
  });
  let e =
    !e0.ok && e0.reason === "market_not_cleared" && !mk.ok ? { ...e0, reason: mk.reason } : e0;
  if (e.ok && p.tier === "pro" && (await trialBlock(db, userId, "pro")))
    e = { ok: false, reason: "trial_ceiling" } as unknown as typeof e;
  return { ...e, phone, usage: u, tier: p.tier, market: mk };
}

/** Creates a Pro campaign (idempotent per dedupe key) and places its first attempt. */
export async function startProCampaign(
  db: Db,
  a: {
    userId: string;
    blockId: string | null;
    trigger: "due" | "call_now" | "scheduled";
    dedupe: string;
    origin: string;
    now?: Date;
  },
) {
  const now = a.now ?? new Date();
  const el = await eligibility(db, a.userId, now);
  if (!el.ok) return { ok: false as const, reason: el.reason };
  if (el.tier !== "pro") return { ok: false as const, reason: "execute_policy" }; // Execute uses its own persistent policy (§64.8)
  const { data: c, error } = await db
    .from("call_campaigns")
    .insert({
      user_id: a.userId,
      block_id: a.blockId,
      policy: "pro",
      trigger: a.trigger,
      state: "CALL_QUEUED",
      max_attempts: el.market.ok && !el.market.proRetry ? 1 : PRO_ALLOWANCE.maxAttempts,
      service_month_start: el.usage.window.start.toISOString(),
      dedupe_key: a.dedupe,
    })
    .select("id")
    .single();
  if (error || !c) return { ok: false as const, reason: "duplicate" };
  return placeAttempt(db, c.id, a.origin, now);
}

type Gate = { ok: true; enc: string; secondsLeft: number } | { ok: false; reason: string };
type Campaign = Database["public"]["Tables"]["call_campaigns"]["Row"];

async function proGate(db: Db, c: Campaign, now: Date): Promise<Gate> {
  const el = await eligibility(db, c.user_id, now);
  if (!el.ok) return { ok: false, reason: el.reason };
  if (!el.phone) return { ok: false, reason: "phone_unverified" };
  return { ok: true, enc: el.phone.e164_enc, secondsLeft: el.usage.secondsLeft };
}

async function executeGate(db: Db, c: Campaign, now: Date): Promise<Gate> {
  const e = await executeEligibility(db, c.user_id, now);
  if (!e.ok) return { ok: false, reason: e.reason };
  if (c.attempts > 0) {
    const block = await retryBlockFor(
      db,
      c,
      now,
      e.attemptsLast24h,
      e.market.ok ? e.market.maxPerOccurrence : undefined,
    );
    if (block) return { ok: false, reason: block };
  }
  if (!e.enc) return { ok: false, reason: "phone_unverified" };
  return { ok: true, enc: e.enc, secondsLeft: e.secondsLeft };
}

/** Execute eligibility with 24-hour ceiling, connected-minute allowance (+ purchased top-ups) and reputation guard. */
export async function executeEligibility(db: Db, userId: string, now = new Date()) {
  const [{ data: p }, { data: phone }] = await Promise.all([
    db
      .from("profiles")
      .select("tier,quiet_start,quiet_end,timezone,call_consent_version,calls_stopped_at")
      .eq("id", userId)
      .maybeSingle(),
    db
      .from("phone_numbers")
      .select("verified_at,country,e164_enc")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (!p) throw new Error("Profile not found");
  const limitExempt = await callLimitExempt(db, userId);
  const win = await serviceWindow(db, userId, now);
  const since24 = new Date(now.getTime() - 864e5).toISOString();
  const since7 = new Date(now.getTime() - EXECUTE_REP.days * 864e5).toISOString();
  const [{ count: last24 }, { data: recent }, { data: month }, { data: topups }] =
    await Promise.all([
      db
        .from("call_logs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .not("campaign_id", "is", null)
        .gte("created_at", since24),
      db
        .from("call_logs")
        .select("connected_seconds,answered_by")
        .eq("user_id", userId)
        .not("campaign_id", "is", null)
        .gte("created_at", since7)
        .limit(200),
      db
        .from("call_campaigns")
        .select("connected_seconds")
        .eq("user_id", userId)
        .eq("policy", "execute")
        .gte("service_month_start", win.start.toISOString())
        .lt("service_month_start", win.end.toISOString()),
      db
        .from("entitlement_ledger")
        .select("amount")
        .eq("user_id", userId)
        .eq("capability", "execute.voice_topup_seconds")
        .gte("created_at", win.start.toISOString())
        .lt("created_at", win.end.toISOString()),
    ]);
  const { currentPolicy } = await import("@/lib/safety.server");
  const pol = await currentPolicy(userId);
  const used = (month ?? []).reduce((s, c) => s + c.connected_seconds, 0);
  const topUpSeconds = (topups ?? []).reduce((s, t) => s + Number(t.amount), 0);
  const mk = await marketFor(db, phone?.country, p.timezone, now);
  const answered = (recent ?? []).map((r) => ({ answered: r.connected_seconds > 0 }));
  const marketHold = mk.ok && marketReputationHold(answered, mk.minAnswerRate);
  const hold = reputationHold(answered) || marketHold;
  const e1 = executeCampaignEligibility({
    tier: p.tier as "free" | "pro" | "execute",
    providerReady: callingReady(),
    marketApproved: mk.ok,
    phoneVerified: !!phone?.verified_at,
    consented: p.call_consent_version === CALL_CONSENT_VERSION,
    callsStopped: !!p.calls_stopped_at,
    inQuiet: inQuietHours(now, p.quiet_start, p.quiet_end, p.timezone),
    safetyPause: pol.pauseAccountability,
    attemptsLast24h: limitExempt ? 0 : (last24 ?? 0),
    connectedSecondsUsed: used,
    topUpSeconds,
    reputationHold: hold,
  });
  let e: { ok: boolean; reason?: string } =
    !e1.ok && e1.reason === "market_not_cleared" && !mk.ok ? { ok: false, reason: mk.reason } : e1;
  if (e.ok && mk.ok && !limitExempt && (last24 ?? 0) >= mk.max24h)
    e = { ok: false, reason: "rolling_ceiling" };
  if (e.ok && p.tier === "execute" && (await trialBlock(db, userId, "execute")))
    e = { ok: false, reason: "trial_ceiling" };
  const secondsLeft = Math.max(0, EXECUTE_ALLOWANCE.connectedMinutes * 60 + topUpSeconds - used);
  return {
    ...e,
    reason: e.ok ? null : e.reason,
    market: mk,
    enc: phone?.e164_enc ?? null,
    secondsLeft,
    attemptsLast24h: limitExempt ? 0 : (last24 ?? 0),
    used,
    topUpSeconds,
    hold,
    window: win,
    tz: p.timezone,
    quiet: { start: p.quiet_start, end: p.quiet_end },
  } as {
    ok: boolean;
    reason: string;
    market: Awaited<ReturnType<typeof marketFor>>;
    enc: string | null;
    secondsLeft: number;
    attemptsLast24h: number;
    used: number;
    topUpSeconds: number;
    hold: boolean;
    window: { start: Date; end: Date };
    tz: string;
    quiet: { start: string; end: string };
  };
}

const OPEN_FOR_CALL = ["planned", "scheduled", "upcoming", "due", "contacting"];
/** Why an Execute campaign must stop retrying now, or null to continue. */
async function retryBlockFor(
  db: Db,
  c: Campaign,
  now: Date,
  attemptsLast24h: number,
  marketMax?: number,
): Promise<string | null> {
  const { data: p } = await db
    .from("profiles")
    .select("call_max_attempts,quiet_start,quiet_end,timezone,calls_stopped_at")
    .eq("id", c.user_id)
    .single();
  const { currentPolicy } = await import("@/lib/safety.server");
  const pol = await currentPolicy(c.user_id);
  let unresolved = !c.acknowledgement,
    inWindow = now.getTime() < new Date(c.created_at).getTime() + 60 * 60000;
  if (c.block_id) {
    const { data: b } = await db
      .from("plan_blocks")
      .select("status,starts_at,duration_min")
      .eq("id", c.block_id)
      .maybeSingle();
    const open = c.trigger === "missed" ? ["expired"] : OPEN_FOR_CALL;
    unresolved = unresolved && !!b && open.includes(b.status);
    if (b && c.trigger !== "missed")
      inWindow =
        now.getTime() < new Date(b.starts_at).getTime() + Math.max(60, b.duration_min) * 60000;
  }
  const { data: rec } = await db
    .from("call_logs")
    .select("connected_seconds")
    .eq("user_id", c.user_id)
    .not("campaign_id", "is", null)
    .gte("created_at", new Date(now.getTime() - 7 * 864e5).toISOString())
    .limit(200);
  return executeRetryBlock({
    attempts: c.attempts,
    userMax: p?.call_max_attempts ?? EXECUTE_CEILINGS.perOccurrence,
    marketMax,
    attemptsLast24h,
    unresolved,
    inWindow,
    inQuiet: p ? inQuietHours(now, p.quiet_start, p.quiet_end, p.timezone) : true,
    callsStopped: !!p?.calls_stopped_at,
    safetyPause: pol.pauseAccountability,
    reputationHold: reputationHold((rec ?? []).map((r) => ({ answered: r.connected_seconds > 0 }))),
  });
}

/** Creates an Execute campaign (idempotent per dedupe key) and places its first attempt. */
export async function startExecuteCampaign(
  db: Db,
  a: {
    userId: string;
    blockId: string | null;
    trigger: "due" | "missed" | "morning" | "evening" | "call_now" | "scheduled";
    dedupe: string;
    origin: string;
    now?: Date;
  },
) {
  const now = a.now ?? new Date();
  const e = await executeEligibility(db, a.userId, now);
  if (!e.ok) return { ok: false as const, reason: e.reason };
  const { data: p } = await db
    .from("profiles")
    .select("call_max_attempts")
    .eq("id", a.userId)
    .single();
  const { data: c, error } = await db
    .from("call_campaigns")
    .insert({
      user_id: a.userId,
      block_id: a.blockId,
      policy: "execute",
      trigger: a.trigger,
      state: "CALL_QUEUED",
      max_attempts: Math.min(p?.call_max_attempts ?? 6, EXECUTE_CEILINGS.perOccurrence),
      service_month_start: e.window.start.toISOString(),
      dedupe_key: a.dedupe,
    })
    .select("id")
    .single();
  if (error || !c) return { ok: false as const, reason: "duplicate" };
  return placeAttempt(db, c.id, a.origin, now);
}

/** Places one attempt. The campaign is debited when its first provider call is successfully created (§65). */
export async function placeAttempt(db: Db, campaignId: string, origin: string, now = new Date()) {
  const { data: c } = await db.from("call_campaigns").select("*").eq("id", campaignId).single();
  if (!c) return { ok: false as const, reason: "missing" };
  if (c.attempts >= c.max_attempts) return { ok: false as const, reason: "max_attempts" };
  // V3 §92 kill switch: hold the attempt (nothing consumed) until switched back on.
  if (!(await (await import("./flags.server")).flagOn("calls_outbound")))
    return { ok: false as const, reason: "paused_by_admin" };
  // Re-check rules at each attempt (quiet hours, stop, safety). The retry itself is already counted.
  const gate = c.policy === "execute" ? await executeGate(db, c, now) : await proGate(db, c, now);
  if (!gate.ok) {
    const state: CallState =
      gate.reason === "allowance_exhausted"
        ? "ALLOWANCE_EXHAUSTED"
        : gate.reason === "calls_stopped"
          ? "CANCELLED"
          : "RETRY_POLICY_PAUSED";
    await db
      .from("call_campaigns")
      .update({ state, stop_reason: gate.reason, next_attempt_at: null })
      .eq("id", c.id);
    return { ok: false as const, reason: gate.reason };
  }
  if (!(await (await import("./spend.server")).callSpendOk(c.user_id, db))) {
    await db
      .from("call_campaigns")
      .update({
        state: "ALLOWANCE_EXHAUSTED",
        stop_reason: "allowance_exhausted",
        next_attempt_at: null,
      })
      .eq("id", c.id);
    return { ok: false as const, reason: "allowance_exhausted" };
  }
  // Step 47: per-user settings are re-read at every attempt so changes apply immediately.
  const { data: cfg } = await db
    .from("profiles")
    .select(
      "call_allowed_kinds,call_max_minutes,call_voicemail_policy,processing_restricted,account_status",
    )
    .eq("id", c.user_id)
    .single();
  if (cfg?.processing_restricted || cfg?.account_status !== "active") {
    await db
      .from("call_campaigns")
      .update({ state: "CANCELLED", stop_reason: "processing_restricted", next_attempt_at: null })
      .eq("id", c.id);
    return { ok: false as const, reason: "processing_restricted" };
  }
  if (c.block_id) {
    const { data: b } = await db
      .from("plan_blocks")
      .select("occurrence_kind")
      .eq("id", c.block_id)
      .maybeSingle();
    if (!kindAllowed(cfg?.call_allowed_kinds, b?.occurrence_kind)) {
      await db
        .from("call_campaigns")
        .update({ state: "CANCELLED", stop_reason: "task_type_not_allowed", next_attempt_at: null })
        .eq("id", c.id);
      return { ok: false as const, reason: "task_type_not_allowed" };
    }
  }
  const attemptNo = c.attempts + 1;
  const { data: log } = await db
    .from("call_logs")
    .insert({ user_id: c.user_id, campaign_id: c.id, attempt_no: attemptNo, status: "queued" })
    .select("id")
    .single();
  if (!log) return { ok: false as const, reason: "failed" };
  const hold = await (
    await import("./spend.server")
  ).reserveCall(
    c.user_id,
    c.id,
    log.id,
    callTimeLimitSec(cfg?.call_max_minutes, gate.secondsLeft),
    db,
  );
  if (!hold) {
    await db.from("call_logs").update({ status: "failed" }).eq("id", log.id);
    return { ok: false as const, reason: "allowance_exhausted" };
  }
  await db.from("call_campaigns").update({ attempts: attemptNo }).eq("id", c.id);
  try {
    const to = await decryptPhone(gate.enc);
    const sid = await twilioCreateCall(
      to,
      `${origin}/api/public/twilio/voice?log=${log.id}`,
      `${origin}/api/public/twilio/status?log=${log.id}`,
      {
        // Async detection: the member hears Plexecute the moment they answer; voicemail is handled by the callback.
        MachineDetection: cfg?.call_voicemail_policy === "generic" ? "DetectMessageEnd" : "Enable",
        AsyncAmd: "true",
        AsyncAmdStatusCallback: `${origin}/api/public/twilio/amd?log=${log.id}`,
        AsyncAmdStatusCallbackMethod: "POST",
        TimeLimit: String(hold.seconds),
        Timeout: "30",
      },
    );
    await db.from("call_logs").update({ call_sid: sid, status: "initiated" }).eq("id", log.id);
    if (!c.consumed_at)
      await db.from("call_campaigns").update({ consumed_at: now.toISOString() }).eq("id", c.id);
    return { ok: true as const };
  } catch (e) {
    await db.rpc("settle_call_usage", { _ref: `call:${log.id}`, _seconds: 0 });
    console.error("call attempt", e);
    await db.from("call_logs").update({ status: "failed" }).eq("id", log.id);
    await db
      .from("call_campaigns")
      .update({ state: "FAILED", stop_reason: "provider_error" })
      .eq("id", c.id);
    return { ok: false as const, reason: "failed" };
  }
}

/** Provider status callback. Final no-answer/busy/voicemail outcomes schedule the single Pro courtesy retry. */
export async function handleStatus(
  db: Db,
  logId: string,
  form: Record<string, string>,
  now = new Date(),
) {
  const { data: log } = await db
    .from("call_logs")
    .select("id,campaign_id,user_id,connected_seconds,booking_id")
    .eq("id", logId)
    .maybeSingle();
  if (!log) return;
  const status = form["CallStatus"] ?? "unknown";
  const answeredBy = form["AnsweredBy"] ?? null;
  const duration = form["CallDuration"] ? Number(form["CallDuration"]) : null;
  await db
    .from("call_logs")
    .update({
      status,
      provider_status: status,
      answered_by: answeredBy,
      duration_sec: duration,
      updated_at: now.toISOString(),
    })
    .eq("id", logId);
  // §89.3: per-call attempts and billed time are measured separately from connected voice minutes.
  if (["completed", "no-answer", "busy", "failed", "canceled"].includes(status)) {
    const { recordUsage } = await import("./usage.server");
    const feature = log.campaign_id ? "accountability_call" : "test_call";
    await recordUsage([
      {
        userId: log.user_id,
        provider: "twilio_voice",
        feature,
        unit: "attempts",
        quantity: 1,
        ok: status === "completed",
      },
      {
        userId: log.user_id,
        provider: "twilio_voice",
        feature,
        unit: "billed_seconds",
        quantity: duration ?? 0,
      },
      ...(status === "completed" && log.connected_seconds > 0 && duration
        ? [
            {
              userId: log.user_id,
              provider: "twilio_voice",
              feature,
              unit: "connected_seconds" as const,
              quantity: duration,
            },
          ]
        : []),
    ]);
    if (duration)
      await (
        await import("./spend.server")
      ).chargeCall(log.user_id, feature, duration, "carriage", `carriage:${logId}`);
    const { error: settleError } = await db.rpc("settle_call_usage", {
      _ref: `call:${logId}`,
      _seconds: status === "completed" ? Math.max(0, duration ?? 0) : 0,
    });
    if (settleError) throw new Error("Call usage could not be saved.");
    if (log.booking_id)
      await (await import("./appointments.server")).bookingCallEnded(db, log.booking_id, status);
  }
  if (log.booking_id) return; // booking calls never trigger accountability retries
  if (!log.campaign_id) return;
  const { data: c } = await db
    .from("call_campaigns")
    .select("id,state,attempts,policy,connected_seconds,user_id")
    .eq("id", log.campaign_id)
    .single();
  if (!c) return;
  const final = ["completed", "no-answer", "busy", "failed", "canceled"].includes(status);
  if (!final) {
    const s = mapProviderStatus(status, answeredBy);
    if (!["HUMAN_CONNECTED", "ACKNOWLEDGED"].includes(c.state))
      await db.from("call_campaigns").update({ state: s }).eq("id", c.id);
    return;
  }
  // Connected time is metered only once the account holder was confirmed on this attempt.
  if (status === "completed" && log.connected_seconds > 0 && duration) {
    const add = Math.max(0, duration - 0);
    await db.from("call_logs").update({ connected_seconds: add }).eq("id", logId);
    // Atomic settlement above updates campaign seconds exactly once, including webhook retries.
  }
  if (["HUMAN_CONNECTED", "ACKNOWLEDGED"].includes(c.state)) return;
  const outcome: CallState =
    status === "completed"
      ? answeredBy?.startsWith("machine")
        ? "MACHINE_DETECTED"
        : "NO_ANSWER"
      : mapProviderStatus(status, answeredBy);
  let next = afterFinal("pro", c.attempts, outcome, now);
  if (c.policy === "execute") {
    const { data: full } = await db.from("call_campaigns").select("*").eq("id", c.id).single();
    const { count: last24 } = await db
      .from("call_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", c.user_id)
      .not("campaign_id", "is", null)
      .gte("created_at", new Date(now.getTime() - 864e5).toISOString());
    const why =
      ["NO_ANSWER", "BUSY", "MACHINE_DETECTED"].includes(outcome) && full
        ? await retryBlockFor(
            db,
            full,
            now,
            (await callLimitExempt(db, c.user_id)) ? 0 : (last24 ?? 0),
          )
        : "not_retryable";
    next = why
      ? { state: outcome, retryAt: null }
      : {
          state: "RETRY_SCHEDULED",
          retryAt: new Date(now.getTime() + executeRetryGap(c.attempts) * 60000),
        };
    if (why && why !== "not_retryable")
      await db.from("call_campaigns").update({ stop_reason: why }).eq("id", c.id);
  }
  await db
    .from("call_campaigns")
    .update({ state: next.state, next_attempt_at: next.retryAt?.toISOString() ?? null })
    .eq("id", c.id);
  if (!next.retryAt) {
    const { enqueueNotification } = await import("@/lib/notify.server");
    await enqueueNotification(db, {
      userId: c.user_id,
      category: "DUE",
      intent: "call_unanswered",
      title: "We couldn't reach you by phone",
      body: "Your session is still in your plan. You can start, snooze, move or skip it here.",
      link: "/app/today",
      dedupe: ["call-unanswered", c.id],
      now,
    });
  }
}

/** Marks the account holder as confirmed on this attempt (connected time starts counting). */
export async function markConnected(db: Db, logId: string) {
  const { data: log } = await db.from("call_logs").select("campaign_id").eq("id", logId).single();
  await db.from("call_logs").update({ connected_seconds: 1 }).eq("id", logId);
  if (log?.campaign_id)
    await db
      .from("call_campaigns")
      .update({ state: "HUMAN_CONNECTED", next_attempt_at: null })
      .eq("id", log.campaign_id);
}

/** Applies the user's keypad choice: execution state change with an event, or stopping calls. STOP ALL acts immediately. */
export async function applyAck(db: Db, logId: string, ack: Ack, now = new Date()) {
  const { data: log } = await db
    .from("call_logs")
    .select("id,user_id,campaign_id")
    .eq("id", logId)
    .single();
  if (!log?.campaign_id) return;
  const { data: c } = await db
    .from("call_campaigns")
    .select("id,block_id")
    .eq("id", log.campaign_id)
    .single();
  await db
    .from("call_campaigns")
    .update({ state: "ACKNOWLEDGED", acknowledgement: ack })
    .eq("id", log.campaign_id);
  await db.from("call_logs").update({ outcome: ack.toLowerCase() }).eq("id", logId);
  if (ack === "STOP_ALL_CALLS") {
    await db
      .from("profiles")
      .update({ calls_stopped_at: now.toISOString(), calls_enabled: false })
      .eq("id", log.user_id);
    await db
      .from("call_campaigns")
      .update({ state: "CANCELLED", stop_reason: "stop_all_calls", next_attempt_at: null })
      .eq("user_id", log.user_id)
      .in("state", ["CALL_QUEUED", "RETRY_SCHEDULED"]);
    await db.from("consent_records").insert({
      user_id: log.user_id,
      purpose: "accountability_calls",
      action: "withdrawn",
      policy_version: CALL_CONSENT_VERSION,
      metadata: { via: "call_keypad" },
    });
    return;
  }
  if (!c?.block_id) return;
  if (ack === "STOP_CALLING_FOR_THIS_TASK") {
    await db.from("plan_blocks").update({ call_requested: false }).eq("id", c.block_id);
    return;
  }
  if (ack === "RESCHEDULE") {
    const { enqueueNotification } = await import("@/lib/notify.server");
    await enqueueNotification(db, {
      userId: log.user_id,
      category: "DUE",
      intent: "call_reschedule",
      title: "Pick a new time",
      body: "You asked on the call to move this session. Choose a new time from Today.",
      link: "/app/today",
      blockId: c.block_id,
      dedupe: ["call-move", c.id],
      now,
    });
    return;
  }
  const to = ACK_TO_STATUS[ack];
  const { data: b } = await db.from("plan_blocks").select("status").eq("id", c.block_id).single();
  if (!to || !b) return;
  const patch: Record<string, unknown> = { status: to };
  if (to === "started") patch["started_at"] = now.toISOString();
  if (to === "snoozed") patch["starts_at"] = new Date(now.getTime() + 10 * 60000).toISOString();
  const { error } = await db
    .from("plan_blocks")
    .update(patch as never)
    .eq("id", c.block_id)
    .eq("status", b.status);
  if (!error)
    await db.from("plan_block_events").insert({
      user_id: log.user_id,
      block_id: c.block_id,
      event_type:
        ack === "START_NOW"
          ? "start"
          : ack === "SNOOZE"
            ? "snooze"
            : ack === "BLOCKED"
              ? "blocked"
              : "skip",
      from_status: b.status,
      to_status: to,
      reason_code: `call_${ack.toLowerCase()}`,
      actor_type: "call",
      source_channel: "call",
      evidence_refs: [{ call_log: logId }],
      idempotency_key: `call:${logId}:${ack}`,
    });
}

/** Cron: start due-time campaigns for sessions marked "call me", and place due retries. */
export async function processCalls(db: Db, origin: string, now = new Date()) {
  const out = { started: 0, retried: 0, skipped: 0, scheduled: {} as Record<string, number> };
  out.scheduled = await processScheduledCalls(db, origin, now);
  if (!callingReady()) return out;
  const since = new Date(now.getTime() - 10 * 60000).toISOString();
  const { data: blocks } = await db
    .from("plan_blocks")
    .select("id,user_id,starts_at")
    .eq("call_requested", true)
    .in("status", ["planned", "scheduled", "upcoming", "due", "acknowledged"])
    .gte("starts_at", since)
    .lte("starts_at", now.toISOString())
    .limit(500);
  for (const b of blocks ?? []) {
    const r = await startProCampaign(db, {
      userId: b.user_id,
      blockId: b.id,
      trigger: "due",
      dedupe: `due:${b.id}:${b.starts_at}`,
      origin,
      now,
    });
    if (r.ok) out.started++;
    else out.skipped++;
  }
  // Execute persistent policies (each only when the user switched it on).
  const { data: execs } = await db
    .from("profiles")
    .select(
      "id,timezone,call_due_enabled,call_missed_enabled,call_morning_enabled,call_morning_time,call_evening_enabled,call_evening_time,calls_stopped_at,call_consent_version",
    )
    .eq("tier", "execute")
    .is("calls_stopped_at", null)
    .not("call_consent_version", "is", null)
    .limit(5000);
  for (const p of execs ?? []) {
    const day = localDayKey(now, p.timezone);
    const mins = zonedParts(now, p.timezone).minutes;
    const go = async (
      blockId: string | null,
      trigger: "due" | "missed" | "morning" | "evening",
      key: string,
    ) => {
      const r = await startExecuteCampaign(db, {
        userId: p.id,
        blockId,
        trigger,
        dedupe: key,
        origin,
        now,
      });
      if (r.ok) out.started++;
      else out.skipped++;
    };
    if (p.call_morning_enabled && timedPolicyDue(mins, p.call_morning_time.slice(0, 5)))
      await go(null, "morning", `morning:${day}`);
    if (p.call_evening_enabled && timedPolicyDue(mins, p.call_evening_time.slice(0, 5)))
      await go(null, "evening", `evening:${day}`);
    if (p.call_due_enabled) {
      const { data: due } = await db
        .from("plan_blocks")
        .select("id,starts_at,source_type,call_requested")
        .eq("user_id", p.id)
        .in("status", ["planned", "scheduled", "upcoming", "due"])
        .gte("starts_at", since)
        .lte("starts_at", now.toISOString())
        .limit(20);
      for (const b of (due ?? []).filter(
        (b) => b.call_requested || ["goal", "makeup"].includes(b.source_type),
      ))
        await go(b.id, "due", `due:${b.id}:${b.starts_at}`);
    }
    if (p.call_missed_enabled) {
      const { data: missed } = await db
        .from("plan_blocks")
        .select("id,starts_at,source_type,call_requested")
        .eq("user_id", p.id)
        .eq("status", "expired")
        .gte("starts_at", new Date(now.getTime() - 6 * 3600e3).toISOString())
        .limit(20);
      for (const b of (missed ?? []).filter(
        (b) => b.call_requested || ["goal", "makeup"].includes(b.source_type),
      ))
        await go(b.id, "missed", `missed:${b.id}`);
    }
  }
  const { data: retries } = await db
    .from("call_campaigns")
    .select("id")
    .eq("state", "RETRY_SCHEDULED")
    .lte("next_attempt_at", now.toISOString())
    .limit(200);
  for (const c of retries ?? []) {
    const { data: claimed } = await db
      .from("call_campaigns")
      .update({ state: "CALL_QUEUED" })
      .eq("id", c.id)
      .eq("state", "RETRY_SCHEDULED")
      .select("id");
    if (!claimed?.length) continue;
    const r = await placeAttempt(db, c.id, origin, now);
    if (r.ok) out.retried++;
  }
  return out;
}

// ---------- member call setup used by Coach chat (same rules as the call settings screen) ----------
export async function startVerificationFor(userId: string, phone: string) {
  const { parseE164 } = await import("@/lib/calling");
  const parsed = parseE164(phone);
  if (!parsed) return { error: "Ask for the number in international format, like +447700900123." };
  if (!verifyConfigured() || !encryptionConfigured())
    return { error: "phone_verification_not_switched_on" };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await sendVerification(parsed.e164);
  await (
    await import("./usage.server")
  ).recordUsage({
    userId,
    provider: "twilio_verify",
    feature: "phone_verification",
    unit: "messages",
    quantity: 1,
  });
  await supabaseAdmin.from("phone_numbers").upsert(
    {
      user_id: userId,
      e164_enc: await encryptPhone(parsed.e164),
      last4: parsed.e164.slice(-4),
      country: parsed.country,
      verified_at: null,
    },
    { onConflict: "user_id" },
  );
  await supabaseAdmin
    .from("profiles")
    .update({ call_consent_version: null, call_consent_at: null })
    .eq("id", userId);
  return {
    code_sent: true,
    ending: parsed.e164.slice(-4),
    next: "Ask the member for the code from the text.",
  };
}

export async function confirmVerificationFor(
  userId: string,
  rawCode: string,
  sourceMessage: string | null,
) {
  const code = rawCode.replace(/\D/g, "");
  if (!/^\d{4,10}$/.test(code)) return { error: "invalid_code_format" };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row } = await supabaseAdmin
    .from("phone_numbers")
    .select("e164_enc")
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return { error: "start_verification_first" };
  if (!(await checkVerification(await decryptPhone(row.e164_enc), code)))
    return { error: "code_did_not_work" };
  await supabaseAdmin
    .from("phone_numbers")
    .update({ verified_at: new Date().toISOString() })
    .eq("user_id", userId);
  await supabaseAdmin.from("audit_events").insert({
    user_id: userId,
    actor_type: "user",
    action: "phone.verified",
    resource_type: "phone_number",
    outcome: "succeeded",
    metadata: { via: "coach", source_message: sourceMessage },
  });
  return { verified: true, ...(await callReadiness(userId)) };
}

export async function grantCallConsent(userId: string, sourceMessage: string | null) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("profiles")
    .update({
      call_consent_version: CALL_CONSENT_VERSION,
      call_consent_at: now,
      calls_stopped_at: null,
    })
    .eq("id", userId);
  await supabaseAdmin.from("consent_records").insert({
    user_id: userId,
    purpose: "accountability_calls",
    action: "granted",
    policy_version: CALL_CONSENT_VERSION,
    metadata: { device: "coach_chat", source_message: sourceMessage },
  });
  return { consent_recorded: true, ...(await callReadiness(userId)) };
}
