import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const run = process.env["RUN_PAID_USAGE_TESTS"] === "1" ? describe : describe.skip;
run("atomic paid usage against the real database", () => {
  let db: ReturnType<typeof createClient>;
  let userId = "";
  const start = new Date().toISOString();
  const end = new Date(Date.now() + 864e5).toISOString();
  const period = start.slice(0, 10);
  beforeAll(async () => {
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) throw new Error("Test database access unavailable");
    db = createClient(url, key, {
      auth: { persistSession: false },
      global: {
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`)
            headers.delete("Authorization");
          headers.set("apikey", key);
          return fetch(input, { ...init, headers });
        },
      },
    });
    const r = await db.auth.admin.createUser({
      email: `paid-usage-${crypto.randomUUID()}@test.plexecute.invalid`,
      password: crypto.randomUUID(),
      email_confirm: true,
    });
    if (r.error || !r.data.user) throw new Error("Could not create isolated test member");
    userId = r.data.user.id;
    const p = await db.from("profiles").update({ tier: "pro" }).eq("id", userId);
    if (p.error) throw p.error;
  });
  afterAll(async () => {
    if (!userId) return;
    const { deleteAccountJob } = await import("../src/lib/privacy.functions");
    const result = await deleteAccountJob(db, userId, async () => {});
    expect(result.ok).toBe(true);
  });
  it("two simultaneous AI requests cannot reserve the same £8", async () => {
    const results = await Promise.all(
      [1, 2].map(() =>
        db.rpc("reserve_paid_ai", {
          _user: userId,
          _period: period,
          _cost: 8000000,
          _ref: crypto.randomUUID(),
        }),
      ),
    );
    for (const r of results) expect(r.error).toBeNull();
    expect(results.filter((r) => r.data).length).toBe(1);
    for (const r of results)
      if (r.data) {
        const settled = await db.rpc("settle_paid_ai", {
          _id: r.data,
          _cost: 0,
          _feature: "test",
          _retail: 0,
        });
        expect(settled.error).toBeNull();
      }
  });
  it("Pro exceeds 20 calls and minutes until shared spend ends, then topups remain atomic", async () => {
    const rows = Array.from({ length: 21 }, () => ({
      user_id: userId,
      policy: "pro",
      max_attempts: 2,
      trigger: "call_now",
      state: "ACKNOWLEDGED",
      consumed_at: start,
      connected_seconds: 60,
      service_month_start: start,
      dedupe_key: crypto.randomUUID(),
    }));
    expect((await db.from("call_campaigns").insert(rows)).error).toBeNull();
    const campaign = await db
      .from("call_campaigns")
      .insert({
        user_id: userId,
        policy: "pro",
        max_attempts: 2,
        trigger: "call_now",
        state: "CALL_QUEUED",
        service_month_start: start,
        dedupe_key: crypto.randomUUID(),
      })
      .select("id")
      .single();
    expect(campaign.error).toBeNull();
    const args = {
      _user: userId,
      _period: period,
      _start: start,
      _end: end,
      _campaign: campaign.data?.id,
      _seconds: 3600,
      _micro_per_second: 1000,
    };
    const includedRef = `call:${crypto.randomUUID()}`;
    const included = await db.rpc("reserve_call_usage", {
      ...args,
      _seconds: 900,
      _ref: includedRef,
    });
    expect(included.error).toBeNull();
    expect(included.data?.seconds).toBe(900);
    expect(
      (await db.rpc("settle_call_usage", { _ref: includedRef, _seconds: 900 })).error,
    ).toBeNull();
    expect(
      (
        await db.rpc("charge_reserved_call", {
          _user: userId,
          _ref: `carriage:${includedRef.slice(5)}`,
          _cost: 900000,
          _feature: "test",
          _part: "carriage",
        })
      ).error,
    ).toBeNull();
    const ai = await db.rpc("reserve_paid_ai", {
      _user: userId,
      _period: period,
      _cost: 7100000,
      _ref: crypto.randomUUID(),
    });
    expect(ai.error).toBeNull();
    expect(ai.data).toBeTruthy();
    expect(
      (
        await db.rpc("settle_paid_ai", {
          _id: ai.data,
          _cost: 7100000,
          _feature: "test",
          _retail: 0,
        })
      ).error,
    ).toBeNull();
    const blocked = await db.rpc("reserve_call_usage", {
      ...args,
      _ref: `call:${crypto.randomUUID()}`,
    });
    expect(blocked.error).toBeNull();
    expect(blocked.data).toBeNull();
    // The completed campaign must return to queued state for the next isolated attempt.
    expect(
      (await db.from("call_campaigns").update({ state: "CALL_QUEUED" }).eq("id", campaign.data?.id))
        .error,
    ).toBeNull();
    expect(
      (
        await db.from("entitlement_ledger").insert({
          user_id: userId,
          capability: "execute.voice_topup_seconds",
          amount: 3600,
          reason: "voice_topup_purchase",
          external_ref: crypto.randomUUID(),
          created_at: start,
        })
      ).error,
    ).toBeNull();
    const ref = `call:${crypto.randomUUID()}`;
    const accepted = await db.rpc("reserve_call_usage", { ...args, _ref: ref });
    expect(accepted.error).toBeNull();
    expect(accepted.data?.seconds).toBe(3600);
    const second = await db
      .from("call_campaigns")
      .insert({
        user_id: userId,
        policy: "pro",
        max_attempts: 2,
        trigger: "call_now",
        state: "CALL_QUEUED",
        service_month_start: start,
        dedupe_key: crypto.randomUUID(),
      })
      .select("id")
      .single();
    const noOverspend = await db.rpc("reserve_call_usage", {
      ...args,
      _campaign: second.data?.id,
      _ref: `call:${crypto.randomUUID()}`,
    });
    expect(noOverspend.error).toBeNull();
    expect(noOverspend.data).toBeNull();
    expect((await db.rpc("settle_call_usage", { _ref: ref, _seconds: 3599 })).error).toBeNull();
    expect((await db.rpc("settle_call_usage", { _ref: ref, _seconds: 3599 })).error).toBeNull();
    const finalSecond = await db.rpc("reserve_call_usage", {
      ...args,
      _campaign: second.data?.id,
      _ref: `call:${crypto.randomUUID()}`,
    });
    expect(finalSecond.error).toBeNull();
    expect(finalSecond.data?.seconds).toBe(1);
    const read = await db
      .from("call_campaigns")
      .select("connected_seconds")
      .eq("id", campaign.data?.id)
      .single();
    expect(read.data?.connected_seconds).toBe(4499);
  });
});
