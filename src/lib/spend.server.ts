// Server side of the combined AI + call allowance and Plexecute AI Credit. Metering never throws.
import {
  AI_CREDIT,
  aiCostUsd,
  allowanceMicro,
  callCostUsd,
  retailMicro,
  usdToMicroGbp,
  CALL_RATES_USD,
  ttsCostUsd,
  type SpendState,
} from "./spend";

type Db = any;
async function admin(): Promise<Db> {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

/** Today's US dollars per pound: stored once a day from the European Central Bank feed (frankfurter.app). */
export async function usdPerGbp(db?: Db): Promise<number | null> {
  db ??= await admin();
  const day = new Date().toISOString().slice(0, 10);
  const { data: today } = await db
    .from("fx_rates")
    .select("usd_per_gbp")
    .eq("day", day)
    .maybeSingle();
  if (today) return Number(today.usd_per_gbp);
  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=GBP&to=USD");
    if (r.ok) {
      const j = (await r.json()) as { rates?: { USD?: number } };
      const v = j.rates?.USD;
      if (v && v > 0) {
        await db.from("fx_rates").upsert({ day, usd_per_gbp: v, source: "ecb_frankfurter" });
        return v;
      }
    }
  } catch {
    /* fall back to the last stored rate */
  }
  const { data: last } = await db
    .from("fx_rates")
    .select("usd_per_gbp")
    .order("day", { ascending: false })
    .limit(1)
    .maybeSingle();
  return last ? Number(last.usd_per_gbp) : null;
}

function callRates() {
  try {
    const o = JSON.parse(process.env["SPEND_CALL_RATES_JSON"] ?? "");
    if (o && typeof o.carriagePerMin === "number" && typeof o.voicePerMin === "number") return o;
  } catch {
    /* default */
  }
  return CALL_RATES_USD;
}

/** The member's allowance period: the paid subscription's current period, else the calendar month. */
async function periodStart(db: Db, userId: string): Promise<string> {
  const { data: s } = await db
    .from("subscriptions")
    .select("current_period_start,current_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  if (s?.current_period_start) {
    const { serviceMonth } = await import("./calling");
    return serviceMonth(new Date(), new Date(s.current_period_start))
      .start.toISOString()
      .slice(0, 10);
  }
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function spendState(
  userId: string,
  db?: Db,
): Promise<SpendState & { tier: string; period: string }> {
  db ??= await admin();
  const { data: p } = await db.from("profiles").select("tier").eq("id", userId).maybeSingle();
  const tier = (p?.tier as string) ?? "free";
  const period = await periodStart(db, userId);
  const [{ data: used }, { data: credit }] = await Promise.all([
    db
      .from("spend_ledger")
      .select("provider_cost_micro")
      .eq("user_id", userId)
      .eq("period_start", period)
      .eq("funded_by", "included"),
    db.from("ai_credit_ledger").select("amount_micro").eq("user_id", userId),
  ]);
  return {
    tier,
    period,
    allowanceMicro: allowanceMicro(tier),
    usedMicro: (used ?? []).reduce(
      (s: number, r: { provider_cost_micro: number }) => s + Number(r.provider_cost_micro),
      0,
    ),
    creditMicro: (credit ?? []).reduce(
      (s: number, r: { amount_micro: number }) => s + Number(r.amount_micro),
      0,
    ),
  };
}

async function charge(
  userId: string,
  kind: "ai" | "call",
  feature: string,
  costUsd: number,
  ref: string | null,
  allowCredit: boolean,
) {
  try {
    const db = await admin();
    const { data: p } = await db.from("profiles").select("tier").eq("id", userId).maybeSingle();
    const paid = p?.tier === "pro" || p?.tier === "execute";
    if (!paid) {
      // Free: calls never run; AI is charged to credit only once the free daily token budget is exceeded.
      if (kind !== "ai") return null;
      const { FREE_AI_BUDGET } = await import("./ai-budget.server");
      const { localDayKey } = await import("./tz");
      const { data: tz } = await db
        .from("profiles")
        .select("timezone")
        .eq("id", userId)
        .maybeSingle();
      const { data: u } = await db
        .from("ai_usage")
        .select("input_tokens,output_tokens")
        .eq("user_id", userId)
        .eq("day", localDayKey(new Date(), tz?.timezone))
        .maybeSingle();
      if (
        !u ||
        (u.input_tokens <= FREE_AI_BUDGET.input && u.output_tokens <= FREE_AI_BUDGET.output)
      )
        return null;
    }
    const rate = (await usdPerGbp(db)) ?? 1.3; // only if the rate feed and history are both unavailable
    const cost = usdToMicroGbp(costUsd, rate);
    if (cost <= 0) return null;
    if (kind === "call" && ref) {
      const { data: reservation } = await db
        .from("usage_reservations")
        .select("id")
        .eq("ref", `call:${ref.split(":")[1]}`)
        .maybeSingle();
      if (reservation) {
        const { data, error } = await db.rpc("charge_reserved_call", {
          _user: userId,
          _ref: ref,
          _cost: cost,
          _feature: feature,
          _part: ref.startsWith("voice:") ? "voice" : "carriage",
        });
        if (error) throw error;
        return data as string | null;
      }
    }
    const { data } = await db.rpc("charge_spend", {
      _user: userId,
      _period: await periodStart(db, userId),
      _allowance: allowanceMicro(p?.tier),
      _cost: cost,
      _retail: retailMicro(cost),
      _kind: kind,
      _feature: feature.slice(0, 60),
      _ref: ref,
      _allow_credit: allowCredit,
    });
    return data as string | null;
  } catch (e) {
    console.error("spend metering failed", e instanceof Error ? e.message : "error");
    return null;
  }
}

export function chargeAi(
  userId: string,
  feature: string,
  model: string,
  input: number,
  output: number,
  ref: string | null = null,
) {
  return charge(userId, "ai", feature, aiCostUsd(model, input, output), ref, true);
}
export function chargeCall(
  userId: string,
  feature: string,
  seconds: number,
  part: "carriage" | "voice",
  ref: string,
) {
  return charge(userId, "call", feature, callCostUsd(seconds, part, callRates()), ref, false);
}

/** ElevenLabs voice characters for one call, inside the same shared AI-and-call allowance. */
export function chargeTts(userId: string, characters: number, logId: string) {
  return charge(
    userId,
    "call",
    "live_voice_tts",
    ttsCostUsd(characters),
    `voice:${logId}:tts`,
    false,
  );
}

/** Adds £7.50 of AI Credit exactly once per payment. */
export async function creditAiPurchase(db: Db, userId: string, paymentRef: string) {
  const { error } = await db.from("ai_credit_ledger").insert({
    user_id: userId,
    amount_micro: AI_CREDIT.valueMicro,
    reason: "purchase",
    external_ref: paymentRef,
  });
  return !error;
}
/** A provider refund removes that purchase's credit exactly once. */
export async function reverseAiPurchase(db: Db, paymentRef: string) {
  const { data: buy } = await db
    .from("ai_credit_ledger")
    .select("user_id,amount_micro")
    .eq("external_ref", paymentRef)
    .eq("reason", "purchase")
    .maybeSingle();
  if (!buy) return false;
  const { error } = await db.from("ai_credit_ledger").insert({
    user_id: buy.user_id,
    amount_micro: -Number(buy.amount_micro),
    reason: "refund",
    external_ref: paymentRef,
  });
  return !error;
}

/** Before dialling: calls need included allowance left; Execute may also use bought call time. */
export async function callSpendOk(userId: string, db?: Db): Promise<boolean> {
  db ??= await admin();
  const st = await spendState(userId, db);
  if (st.allowanceMicro === 0) return true; // admins/free never dial through paid paths
  const { callAllowed } = await import("./spend");
  const { VOICE_TOPUP } = await import("./billing");
  const { serviceWindow } = await import("./calling.server");
  const win = await serviceWindow(db, userId);
  const { data: t } = await db
    .from("entitlement_ledger")
    .select("amount")
    .eq("user_id", userId)
    .eq("capability", VOICE_TOPUP.capability)
    .gte("created_at", win.start.toISOString())
    .lt("created_at", win.end.toISOString());
  const topUp = (t ?? []).reduce((s: number, r: { amount: number }) => s + Number(r.amount), 0);
  const { data: spent } = await db
    .from("usage_reservations")
    .select("actual_topup_seconds")
    .eq("user_id", userId)
    .eq("period_start", st.period)
    .eq("settled", true);
  const left =
    topUp -
    (spent ?? []).reduce(
      (s: number, r: { actual_topup_seconds: number }) => s + r.actual_topup_seconds,
      0,
    );
  return callAllowed(st, st.tier, left);
}

export async function reserveCall(
  userId: string,
  campaignId: string,
  logId: string,
  seconds: number,
  db: Db,
) {
  const st = await spendState(userId, db);
  const { serviceWindow } = await import("./calling.server");
  const win = await serviceWindow(db, userId);
  const rate = (await usdPerGbp(db)) ?? 1.3;
  const rates = callRates();
  const perSecond = Math.ceil(usdToMicroGbp((rates.carriagePerMin + rates.voicePerMin) / 60, rate));
  const { data, error } = await db.rpc("reserve_call_usage", {
    _user: userId,
    _period: st.period,
    _start: win.start.toISOString(),
    _end: win.end.toISOString(),
    _ref: `call:${logId}`,
    _campaign: campaignId,
    _seconds: seconds,
    _micro_per_second: perSecond,
  });
  if (error) throw new Error("Call balance could not be checked.");
  return data as { id: string; seconds: number } | null;
}
